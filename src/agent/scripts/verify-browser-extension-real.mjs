#!/usr/bin/env node
// Real Chromium check of the Mycellios Chrome extension's tab work (specs/agent-chrome-tabs).
//
// It loads a temporary copy of apps/browser-extension into Playwright's Chromium, serves local
// fixture pages on 127.0.0.1 and drives the extension's own functions (tabs-bridge.js) from an
// extension page, so every Chrome API is the real one: scripting, tab groups, downloads, the
// debugger (real input and screenshots) and permissions. The person's answers to the panel's
// questions are scripted. The copy differs from the shipped extension only in its manifest: the
// optional permissions are granted up front and 127.0.0.1 is a host permission, because Chrome's
// own permission prompts cannot be clicked by automation. It contacts no Mycellios server, signs
// in to nothing and runs no model, so it does not qualify a real Mico in a person's Chrome.
//
// Usage: node scripts/verify-browser-extension-real.mjs [--headed] [--output=report.json]
//   [--playwright=<path to playwright/index.mjs>] when the package is not resolvable from here.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, "../apps/browser-extension");
const headed = process.argv.includes("--headed");
const output = process.argv.find((arg) => arg.startsWith("--output="))?.slice(9);
const playwrightPath = process.argv.find((arg) => arg.startsWith("--playwright="))?.slice(13);
const playwrightSpecifier = playwrightPath ? pathToFileURL(playwrightPath).href : "playwright";
const { chromium } = await import(playwrightSpecifier);

const FIXTURES = {
  "/form": `<!doctype html><title>Login</title>
    <form id="login" action="/signed-in" method="get">
      <label for="user">User</label><input id="user" name="user">
      <label for="pw">Password</label><input id="pw" name="pw" type="password">
      <button type="submit">Sign in</button>
    </form>`,
  "/signed-in": `<!doctype html><title>Welcome</title><p id="done">Signed in</p>`,
  // A button that ignores synthetic events, as some sites do.
  "/trusted": `<!doctype html><title>Trusted</title>
    <button id="go">Only people</button><p id="out"></p>
    <label for="q">Search</label><input id="q">
    <script>
      document.getElementById("go").addEventListener("click", (event) => {
        document.getElementById("out").textContent = event.isTrusted ? "trusted click" : "ignored synthetic click";
      });
    </script>`,
  "/checkout": `<!doctype html><title>Checkout</title>
    <form onsubmit="event.preventDefault()">
      <label for="cc">Card number</label><input id="cc" autocomplete="cc-number">
      <button type="submit">Pay now</button>
    </form>`,
  "/download": `<!doctype html><title>Files</title><a id="file" href="/file.txt">Download report</a>`,
};

const server = createServer((request, response) => {
  const path = new URL(request.url, "http://127.0.0.1").pathname;
  if (path === "/file.txt") {
    response.writeHead(200, {
      "content-type": "text/plain",
      "content-disposition": 'attachment; filename="report.txt"',
    });
    response.end("report");
    return;
  }
  const page = FIXTURES[path];
  response.writeHead(page ? 200 : 404, { "content-type": "text/html; charset=utf-8" });
  response.end(page ?? "not found");
});
await new Promise((ready) => server.listen(0, "127.0.0.1", ready));
const origin = `http://127.0.0.1:${server.address().port}`;

// The extension copy: shipped files plus a QA page that exposes the bridge to this script.
const work = mkdtempSync(join(tmpdir(), "mycellios-extension-qa-"));
const extension = join(work, "extension");
cpSync(source, extension, { recursive: true });
const manifest = JSON.parse(readFileSync(join(extension, "manifest.json"), "utf8"));
manifest.permissions = [...new Set([...manifest.permissions, ...manifest.optional_permissions])];
manifest.host_permissions = [...manifest.host_permissions, "http://127.0.0.1/*"];
delete manifest.optional_permissions;
writeFileSync(join(extension, "manifest.json"), JSON.stringify(manifest, null, 2));
writeFileSync(
  join(extension, "qa.html"),
  '<!doctype html><meta charset="utf-8"><script type="module" src="qa.js"></script>',
);
writeFileSync(
  join(extension, "qa.js"),
  `import * as bridge from "./tabs-bridge.js";
   const answers = [];
   const asked = [];
   const ui = {
     ask: async (question) => { asked.push({ kind: "site", ...question }); return "always"; },
     confirm: async (question) => { asked.push(question); return answers.shift() ?? "deny"; },
     actAllowed: async () => true,
   };
   globalThis.qa = { bridge, ui, answers, asked };`,
);

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok), ...(detail === undefined ? {} : { detail }) });
  process.stdout.write(
    `${ok ? "PASS" : "FAIL"} ${name}${ok || detail === undefined ? "" : ` ${JSON.stringify(detail)}`}\n`,
  );
};

const context = await chromium.launchPersistentContext(join(work, "profile"), {
  headless: !headed,
  channel: "chromium",
  acceptDownloads: true,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
try {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  const extensionId = new URL(worker.url()).host;
  const qa = await context.newPage();
  await qa.goto(`chrome-extension://${extensionId}/qa.html`);
  await qa.waitForFunction(() => globalThis.qa);

  const open = async (path) => {
    const page = await context.newPage();
    await page.goto(`${origin}${path}`);
    const tab = await qa.evaluate(async (url) => {
      const [found] = await chrome.tabs.query({ url });
      return `t${found.id}`;
    }, `${origin}${path}`);
    return { page, tab };
  };
  const run = (fn, ...args) => qa.evaluate(fn, args);
  const mico = { name: "Ada", color: "pink" };
  const refsOf = (text) =>
    Object.fromEntries([...text.matchAll(/- \S+ "([^"]*)" \[(e\d+)\]/g)].map((m) => [m[1], m[2]]));

  // 1. Listing and reading.
  const trusted = await open("/trusted");
  const list = await run(async () => qa.bridge.listTabs());
  check(
    "lists shared tabs with titles and addresses",
    list.tabs?.some((tab) => tab.title === "Trusted"),
    list,
  );
  const snap = await run(async ([tab]) => qa.bridge.snapshotTab(tab, qa.ui.ask), trusted.tab);
  const trustedRefs = refsOf(snap.page?.text ?? "");
  check("reads a page with refs", trustedRefs["Only people"] && trustedRefs.Search, snap);

  // 2. Real input: a button that ignores synthetic clicks responds to the Mico's click.
  const clicked = await run(
    async ([tab, ref, who]) =>
      qa.bridge.actTab({ op: "act", tab, actions: [{ kind: "click", ref }], mico: who }, qa.ui),
    trusted.tab,
    trustedRefs["Only people"],
    mico,
  );
  check(
    "a click is a real click (isTrusted) through the debugger",
    (await trusted.page.textContent("#out")) === "trusted click",
    clicked,
  );
  check("the click is reported as done", clicked.acted?.steps?.[0]?.ok === true, clicked);
  const groups = await run(async () => chrome.tabGroups.query({}));
  check(
    "the working tab joins a group named after the Mico, in its color",
    groups.some((group) => group.title === "Ada" && group.color === "pink"),
    groups,
  );
  const overlay = await trusted.page.evaluate(
    () =>
      document.documentElement.lastElementChild?.shadowRoot === null &&
      document.documentElement.lastElementChild?.tagName,
  );
  check("the page shows the Mico's overlay (closed shadow root)", overlay === "DIV", overlay);

  const typed = await run(
    async ([tab, ref, who]) =>
      qa.bridge.actTab(
        { op: "act", tab, actions: [{ kind: "fill", ref, text: "laptop 16 GB" }], mico: who },
        qa.ui,
      ),
    trusted.tab,
    trustedRefs.Search,
    mico,
  );
  check(
    "fill types real text into a field",
    (await trusted.page.inputValue("#q")) === "laptop 16 GB" && typed.acted?.steps?.[0]?.ok,
    typed,
  );

  // 3. Screenshot without the overlay.
  const shot = await run(async ([tab]) => qa.bridge.screenshotTab(tab, qa.ui.ask), trusted.tab);
  check(
    "takes a JPEG screenshot of the tab",
    shot.screenshot?.data?.startsWith("/9j/"),
    shot.error ?? "ok",
  );
  check(
    "the overlay is shown again after the screenshot",
    await trusted.page.evaluate(
      () => document.documentElement.lastElementChild?.style.display !== "none",
    ),
  );

  // 4. The person comes first: their own click makes the Mico wait.
  await trusted.page.mouse.click(5, 5);
  const yielded = await run(
    async ([tab, who]) =>
      qa.bridge.actTab(
        { op: "act", tab, actions: [{ kind: "scroll", direction: "down" }], mico: who },
        qa.ui,
      ),
    trusted.tab,
    mico,
  );
  check("yields when the person just used the tab", yielded.error === "person_active", yielded);
  await trusted.page.waitForTimeout(3_200);

  // 5. Passwords and sign-in always ask; a refusal types nothing.
  const login = await open("/form");
  const loginSnap = await run(async ([tab]) => qa.bridge.snapshotTab(tab, qa.ui.ask), login.tab);
  const loginRefs = refsOf(loginSnap.page?.text ?? "");
  await run(async () => {
    qa.asked.length = 0;
    qa.answers.push("deny");
  });
  const refused = await run(
    async ([tab, ref, who]) =>
      qa.bridge.actTab(
        { op: "act", tab, actions: [{ kind: "fill", ref, text: "hunter2" }], mico: who },
        qa.ui,
      ),
    login.tab,
    loginRefs.Password,
    mico,
  );
  check(
    "asks before typing a password and types nothing when declined",
    refused.acted?.steps?.[0]?.note === "declined by the person: password field" &&
      (await login.page.inputValue("#pw")) === "",
    refused,
  );
  await run(async () => {
    qa.asked.length = 0;
    qa.answers.push("allow", "allow");
  });
  const signedIn = await run(
    async ([tab, user, pw, who]) =>
      qa.bridge.actTab(
        {
          op: "act",
          tab,
          mico: who,
          actions: [
            { kind: "fill", ref: user, text: "ada" },
            { kind: "fill", ref: pw, text: "hunter2" },
            { kind: "key", ref: pw, key: "Enter" },
          ],
        },
        qa.ui,
      ),
    login.tab,
    loginRefs.User,
    loginRefs.Password,
    mico,
  );
  await login.page.waitForURL(/signed-in/, { timeout: 5_000 }).catch(() => {});
  const askedKinds = await run(async () => qa.asked.map((question) => question.kind));
  check(
    "asks for the password and again for the sign-in",
    askedKinds.join(",") === "password,sign_in",
    askedKinds,
  );
  check(
    "Enter in the form really signs in after both answers",
    login.page.url().includes("/signed-in"),
    signedIn,
  );
  check(
    "the page after the actions is reported, with the secret hidden",
    !JSON.stringify(signedIn).includes("hunter2"),
  );

  // 6. Payment details always ask.
  const checkout = await open("/checkout");
  const payRefs = refsOf(
    (await run(async ([tab]) => qa.bridge.snapshotTab(tab, qa.ui.ask), checkout.tab)).page?.text ??
      "",
  );
  await run(async () => {
    qa.asked.length = 0;
    qa.answers.push("deny");
  });
  const card = await run(
    async ([tab, ref, who]) =>
      qa.bridge.actTab(
        { op: "act", tab, actions: [{ kind: "fill", ref, text: "4111111111111111" }], mico: who },
        qa.ui,
      ),
    checkout.tab,
    payRefs["Card number"],
    mico,
  );
  check(
    "asks before entering card details",
    card.acted?.steps?.[0]?.note === "declined by the person: payment details" &&
      (await checkout.page.inputValue("#cc")) === "",
    card,
  );

  // 7. Downloads started by a Mico are held until the person decides.
  const files = await open("/download");
  const fileRefs = refsOf(
    (await run(async ([tab]) => qa.bridge.snapshotTab(tab, qa.ui.ask), files.tab)).page?.text ?? "",
  );
  for (const [answer, expected] of [
    ["deny", "cancelled"],
    ["allow", "kept"],
  ]) {
    await run(async ([value]) => {
      qa.asked.length = 0;
      qa.answers.push(value);
    }, answer);
    const download = await run(
      async ([tab, ref, who]) =>
        qa.bridge.actTab({ op: "act", tab, actions: [{ kind: "click", ref }], mico: who }, qa.ui),
      files.tab,
      fileRefs["Download report"],
      mico,
    );
    const states = await run(async () =>
      (await chrome.downloads.search({ filenameRegex: "report" })).map((item) => item.state),
    );
    check(
      `a download is held and ${expected} as the person decides`,
      download.acted?.downloads?.[0] === expected,
      { download, states },
    );
  }

  // 8. Opening pages: new tabs only, refused sites never.
  const opened = await run(
    async ([url, who]) =>
      qa.bridge.navigateTab({ op: "navigate", url, newTab: true, mico: who }, qa.ui),
    `${origin}/form?from=mico`,
    mico,
  );
  check(
    "opens a page in a new tab and reports where it ended",
    opened.navigated?.url === `${origin}/form`,
    opened,
  );
  const notMine = await run(
    async ([tab, url, who]) =>
      qa.bridge.navigateTab({ op: "navigate", url, tab, mico: who }, qa.ui),
    checkout.tab.replace(/\d+$/, (id) => String(Number(id) + 1000)),
    `${origin}/form`,
    mico,
  );
  check(
    "never navigates a tab that is not its own",
    ["tab_gone", "tab_not_working"].includes(notMine.error),
    notMine,
  );
  const vault = await run(
    async ([who]) =>
      qa.bridge.navigateTab(
        { op: "navigate", url: "https://www.mycellios.com/agent/app", newTab: true, mico: who },
        qa.ui,
      ),
    mico,
  );
  check("refuses to open Mycellios itself", vault.error === "refused_site", vault);

  // 9. Ending the work: overlays go, the person's own tabs leave the group, debugging stops.
  await run(async () => qa.bridge.releaseWorking());
  const after = await run(async ([tab]) => {
    const own = await chrome.tabs.get(Number(tab.slice(1)));
    // getTargets() also counts Playwright's own connection, so ask Chrome whether this extension
    // still holds the tab: detaching fails when it does not.
    const attached = await chrome.debugger.detach({ tabId: own.id }).then(
      () => true,
      () => false,
    );
    return { grouped: own.groupId !== -1, attached };
  }, trusted.tab);
  check(
    "the person's own tab leaves the group and is no longer debugged",
    !after.grouped && !after.attached,
    after,
  );
  check(
    "the overlay is removed from the page",
    await trusted.page.evaluate(
      () => !document.documentElement.lastElementChild?.matches?.("div[style*='2147483647']"),
    ),
  );
} catch (error) {
  check("the run finished without an unexpected error", false, String(error?.stack ?? error));
} finally {
  await context.close().catch(() => {});
  server.close();
  rmSync(work, { recursive: true, force: true });
}

const failed = results.filter((result) => !result.ok);
const report = {
  passed: failed.length === 0,
  total: results.length,
  failed: failed.length,
  results,
};
if (output) writeFileSync(output, JSON.stringify(report, null, 2));
process.stdout.write(
  `${report.passed ? "PASSED" : "FAILED"}: ${results.length - failed.length}/${results.length}\n`,
);
process.exit(report.passed ? 0 : 1);
