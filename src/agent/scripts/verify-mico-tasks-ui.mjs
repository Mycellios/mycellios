import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";
import { createServer } from "vite";

// Only a loopback component fixture, with synthetic RPCs and no account or backend.
process.env.RAKAZO_PROJECT_LOCAL = "1";
process.env.SCREEN_PROXY_SECRET = randomBytes(32).toString("hex");
const root = path.resolve("apps/web");
process.chdir(root);
const output = process.env.MICO_ACCEPTANCE_OUTPUT ? path.resolve(process.env.MICO_ACCEPTANCE_OUTPUT) : await mkdtemp(path.join(tmpdir(), "mycellios-task-ui-"));
await mkdir(output, { recursive: true });
const server = await createServer({ root, configFile: path.join(root, "vite.config.ts"),
  server: { host: "127.0.0.1", port: 0, strictPort: false },
  plugins: [{ name: "private-task-acceptance", configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (req.url !== "/__task_acceptance") return next();
      const html = await server.transformIndexHtml(req.url, '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/e2e/fixtures/mico-task-preview.tsx"></script></body></html>');
      res.setHeader("content-type", "text/html"); res.end(html);
    });
  } }],
});
let browser;
try {
  await server.listen();
  const address = server.httpServer.address();
  const url = `http://127.0.0.1:${address.port}/__task_acceptance`;
  browser = await chromium.launch({ ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
    : existsSync(chromium.executablePath()) ? {} : { channel: "chrome" }) });
  const page = await browser.newPage();
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(url);
  const reviewTab = () => page.locator('[data-thread-tab="task-one"] button:not([aria-label])');
  await reviewTab().waitFor({ timeout: 90_000 });
  const picker = () => page.locator('[data-slot="popover-content"]');
  const chevron = () => page.getByRole("button", { name: /^Conversations/ });
  const openPicker = async () => {
    await chevron().click();
    await picker().waitFor();
  };
  const active = () => page.getByTestId("active-task").textContent();
  const tabIds = () => page.locator("[data-thread-tab]").evaluateAll(nodes => nodes.map(node => node.getAttribute("data-thread-tab")));
  const storedTabs = () => page.evaluate(() => JSON.parse(localStorage.getItem("mycellios:open-task-tabs:fixture") ?? "{}").ids ?? []);
  const tab = (id) => page.locator(`[data-thread-tab="${id}"]`);
  const menu = () => page.locator('[role="menu"]');
  const openTabMenu = async (id) => { await tab(id).click({ button: "right" }); await menu().waitFor(); };
  const noOverflow = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);

  for (const [name, width, height, theme] of [["desktop", 1280, 800, "light"], ["desktop-dark", 1280, 800, "dark"], ["mobile", 390, 844, "light"], ["mobile-dark", 390, 844, "dark"]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(theme => document.documentElement.setAttribute("data-theme", theme), theme);
    await noOverflow();
    assert.equal(await page.locator('button[aria-label="New conversation"]').isVisible(), true);
    await page.screenshot({ path: path.join(output, `${name}.png`), animations: "disabled" });
    await openPicker();
    await noOverflow();
    await page.screenshot({ path: path.join(output, `${name}-picker.png`), animations: "disabled" });
    await page.keyboard.press("Escape");
    await picker().waitFor({ state: "hidden" });
  }
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  await page.setViewportSize({ width: 1280, height: 800 });
  await reviewTab().click();
  assert.equal(await active(), "task-one");
  // The status mark is part of the tab's accessible name.
  assert.equal(await reviewTab().getAttribute("aria-current"), "page");
  assert.match(await page.getByRole("button", { name: /Review API/ }).first().textContent(), /Review API/);

  // Status marks on tabs; the picker keeps New conversation first, open threads by activity with
  // their mark and time, kind labels, and the Archived group last.
  assert.equal(await tab("task-one").locator("[data-thread-status]").getAttribute("data-thread-status"), "working");
  await openPicker();
  const rows = await picker().locator("button:not([aria-label])").allTextContents();
  assert.deepEqual(rows.slice(0, 2), ["New conversation", "Main chat"]);
  assert.ok(rows.some(row => row.startsWith("Daily digestRoutine")) && rows.some(row => row.startsWith("Check supplier pricesDelegated")), rows.join(" | "));
  assert.ok(rows.at(-1).startsWith("Old budget"), rows.join(" | "));
  const marks = await picker().locator("[data-thread-status]").evaluateAll(nodes => nodes.map(node => node.getAttribute("data-thread-status")));
  for (const mark of ["working", "unread", "waiting", "failed", "queued"]) assert.ok(marks.includes(mark), `${mark} in ${marks}`);
  assert.ok(await picker().locator("time[data-thread-time]").count() >= 6);
  const archived = picker().getByRole("group", { name: "Archived", exact: true });
  assert.equal(await archived.locator("button:not([aria-label])").count(), 1);
  // Choosing an archived conversation restores it and opens its tab.
  await archived.locator("button:not([aria-label])").first().click();
  await page.waitForFunction(() => document.querySelector('[data-testid="active-task"]')?.textContent === "task-archived");
  assert.ok((await storedTabs()).includes("task-archived"));

  // Archive closes the tab; the picker then lists the conversation under Archived.
  await openTabMenu("task-two");
  await menu().getByRole("menuitem", { name: "Archive" }).click();
  await tab("task-two").waitFor({ state: "detached" });
  await openPicker();
  assert.ok((await picker().getByRole("group", { name: "Archived" }).textContent()).includes("A task with a deliberately long"));
  await page.keyboard.press("Escape");
  await picker().waitFor({ state: "hidden" });

  // + opens a draft tab; nothing is created until the first message, and the draft survives a reload.
  const before = await storedTabs();
  await page.locator('button[aria-label="New conversation"]').click();
  assert.equal(await active(), "Draft");
  await tab("new-conversation").waitFor();
  const message = page.getByRole("textbox", { name: "Start a new conversation with Existing Mico" });
  await message.fill("Plan the spring trip\nWith hotels and trains");
  await page.screenshot({ path: path.join(output, "draft-tab.png"), animations: "disabled" });
  await page.reload();
  await tab("new-conversation").waitFor();
  await tab("new-conversation").locator("button:not([aria-label])").click();
  assert.equal(await message.inputValue(), "Plan the spring trip\nWith hotels and trains");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="active-task"]')?.textContent?.startsWith("mico-task:mico-fixture:"));
  const created = await active();
  assert.equal(await tab("new-conversation").count(), 0);
  assert.equal(await tab(created).locator("button:not([aria-label])").textContent(), "Plan the spring trip");
  assert.equal((await storedTabs()).length, before.length + 1);
  await page.screenshot({ path: path.join(output, "created-task.png"), animations: "disabled" });

  // A tab's menu: open, close actions, then rename, archive and delete; delete waits while it works.
  await openTabMenu(created);
  assert.deepEqual(await menu().getByRole("menuitem").allTextContents(),
    ["Open", "Close tab", "Close other tabs", "Close tabs to the right", "Rename conversation", "Archive", "Delete"]);
  assert.equal(await menu().getByRole("menuitem", { name: "Delete" }).getAttribute("data-disabled"), "");
  await page.screenshot({ path: path.join(output, "tab-menu.png"), animations: "disabled" });
  await page.keyboard.press("Escape");
  await menu().waitFor({ state: "hidden" });

  // Delete hides the tab at once; Undo puts it back in the same place.
  const order = await tabIds();
  await openTabMenu("task-archived");
  await menu().getByRole("menuitem", { name: "Delete" }).click();
  await tab("task-archived").waitFor({ state: "detached" });
  const toast = page.locator("[data-sonner-toast]").filter({ hasText: "Old budget deleted" });
  await toast.waitFor();
  await page.screenshot({ path: path.join(output, "delete-undo.png"), animations: "disabled" });
  await toast.getByRole("button", { name: "Undo" }).click();
  await tab("task-archived").waitFor();
  assert.deepEqual(await tabIds(), order);

  // A conversation the Mico starts joins the end of the tabs without taking focus.
  const shown = await active();
  await page.getByRole("button", { name: "Mico starts a task", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-thread-tab^="mico-started-"]'));
  assert.equal(await active(), shown);
  const stored = await storedTabs();
  assert.ok(stored.at(-1).startsWith("mico-started-"), stored.join(","));

  // Keyboard: Delete closes a focused tab; Ctrl+Shift+O starts a conversation; Alt+Shift+Up steps back.
  const startedId = stored.at(-1);
  await tab(startedId).locator("button:not([aria-label])").focus();
  await page.keyboard.press("Delete");
  await tab(startedId).waitFor({ state: "detached" });
  await page.keyboard.press("Control+Shift+O");
  await page.waitForFunction(() => document.querySelector('[data-testid="active-task"]')?.textContent === "Draft");
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Alt+Shift+ArrowUp");
  await page.waitForFunction(() => document.querySelector('[data-testid="active-task"]')?.textContent !== "Draft");

  // Below 200 px the row becomes a switcher with the current title.
  await page.getByRole("button", { name: "Narrow header", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("nav[data-tabs-layout]")?.getAttribute("data-tabs-layout") === "compact");
  await page.screenshot({ path: path.join(output, "compact.png"), animations: "disabled" });
  await page.getByRole("button", { name: "Narrow header", exact: true }).click();

  // On a phone, Delete asks first and offers no Undo.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  // A phone shows one readable tab; the others stay in the picker.
  await chevron().waitFor({ timeout: 60_000 });
  await openPicker();
  await picker().locator("button:not([aria-label])").filter({ hasText: "Old budget" }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="active-task"]')?.textContent === "task-archived");
  assert.equal(await page.locator("[data-thread-tab]").count(), 1);
  await openTabMenu("task-archived");
  await menu().getByRole("menuitem", { name: "Delete" }).click();
  await page.getByText("Delete this conversation?", { exact: true }).waitFor();
  await noOverflow();
  await page.screenshot({ path: path.join(output, "mobile-delete-confirm.png"), animations: "disabled" });
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await openTabMenu("task-archived");
  await page.screenshot({ path: path.join(output, "mobile-dark-tab-menu.png"), animations: "disabled" });
  await page.keyboard.press("Escape");
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));

  // Back to the main chat and on to the Mico's other work surfaces.
  await page.setViewportSize({ width: 1280, height: 800 });
  await openPicker();
  await picker().getByRole("button", { name: "Main chat", exact: true }).click();
  assert.equal(await active(), "Main chat");
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await page.getByRole("combobox", { name: "Simultaneous tasks", exact: true }).selectOption("2");
  assert.equal(await page.getByRole("combobox", { name: "Simultaneous tasks" }).inputValue(), "2");
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await page.getByRole("button", { name: "Cancel task", exact: true }).click();
  await page.getByText("Cancelled", { exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Workflows", exact: true }).click();
  await page.getByRole("textbox", { name: "Workflow name" }).fill("Synthetic workflow");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Run: Start", exact: true }).click();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await page.getByText("cancelled", { exact: true }).waitFor();
  await noOverflow();
  await page.locator('[data-slot="dialog-content"]').evaluate(root => { for (const node of [root, ...root.querySelectorAll('*')]) if (node instanceof HTMLElement) node.scrollTop = 0; });
  await page.screenshot({ path: path.join(output, "workflow-mobile.png"), animations: "disabled" });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForFunction(() => document.querySelector('[role="dialog"]')?.getBoundingClientRect().width > 1000);
  assert.ok((await page.getByRole("dialog").boundingBox()).width > 1000, "desktop workflow editor must use the available width");
  assert.ok((await page.getByLabel("Workflow canvas").boundingBox()).width > 700, "desktop graph must remain visible beside its properties");
  await page.screenshot({ path: path.join(output, "workflow-desktop.png"), animations: "disabled" });
  assert.deepEqual(errors, []);
  const result = { passed: true, fixtureOnly: true, productionAccess: false, screenshots: output, checks: [
    "desktop and mobile overflow", "light and dark theme", "select private task", "status marks on tabs and picker rows",
    "picker kind labels, activity order with times and archived group last", "restore an archived conversation into its tab",
    "draft tab creates nothing until the first message and keeps its text across a reload", "first message creates the conversation in the draft's place",
    "tab menu with close, rename, archive and delete; delete disabled while working", "archive closes the tab",
    "delete hides the tab with Undo that restores its place", "Mico-started conversation opens as a background tab",
    "Delete key, Ctrl+Shift+O and Alt+Shift+Up", "compact switcher below 200 px", "phone delete asks first",
    "return to main chat", "change Mico concurrency", "save and execute visual workflow", "stop workflow", "no browser errors"] };
  await writeFile(path.join(output, "result.json"), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
} finally { await browser?.close(); await server.close(); }
