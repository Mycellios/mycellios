import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import { createServer } from "vite";
process.env.RAKAZO_PROJECT_LOCAL = "1";
const output = path.resolve(process.argv.find(v => v.startsWith("--output="))?.slice(9) ?? "event-demo-proof");
await mkdir(output, { recursive: true });
const root = path.resolve("apps/web"); process.chdir(root);
const server = await createServer({ root, configFile: path.join(root, "vite.config.ts"),
  optimizeDeps: { entries: [path.join(root, "e2e/fixtures/event-demo.tsx")] }, server: { host: "127.0.0.1", port: 0 },
  plugins: [{ name: "isolated-event-demo", enforce: "pre",
    resolveId(source, importer) {
      if (importer?.replaceAll("\\", "/").endsWith("/pages/demo/use-demo-contribution.ts") && source.endsWith("/mobile/runtime"))
        return path.join(root, "e2e/fixtures/event-demo-runtime.ts");
    },
    configureServer(server) { server.middlewares.use(async (req, res, next) => {
      if (!req.url?.startsWith("/__event_demo")) return next();
      const html = await server.transformIndexHtml(req.url, '<!doctype html><html lang="en" data-theme="light"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/e2e/fixtures/event-demo.tsx"></script></body></html>');
      res.setHeader("content-type", "text/html"); res.end(html);
    }); },
  }] });
let browser;
try {
  await server.listen();
  const executablePath = process.env.WORKSPACE_UI_CHROMIUM ?? (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);
  browser = await chromium.launch(executablePath ? { executablePath } : {});
  const context = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  const errors = [], requests = []; let joined = false, linked = false, paid = 0, recoveries = 0;
  context.on("page", p => p.on("pageerror", e => errors.push(e.message)));
  const metadata = { id: "test-only-event", title: "Synthetic event", open: true, full: false,
    startsAt: Date.now() - 1000, endsAt: Date.now() + 3600000, maxGuests: 50, joined: 1, grantMicrounits: 200000,
    model: "mycellios/managed/antseed/deepseek-v4-flash", modelName: "DeepSeek V4 Flash", provider: "Mycellios",
    processing: "external", browserInference: true, inviteUrl: "https://example.invalid/agent/demo/test-only-event" };
  const session = () => ({ guest: { number: 1, name: "Test guest" }, open: true, endsAt: metadata.endsAt,
    creditsMicrounits: paid ? 199895 : 200000, earnedMicrounits: 0, reservedMicrounits: paid && !recoveries ? 1041 : 0 });
  const result = { status: "completed", response: { choices: [{ message: { content: "Synthetic response, no paid inference." } }] } };
  await context.route("**/mobile/v1/demo/test-only-event**", async route => {
    const req = route.request(), url = new URL(req.url()), suffix = url.pathname.replace("/mobile/v1/demo/test-only-event", "");
    requests.push({ method: req.method(), suffix });
    let value;
    if (!suffix) value = metadata;
    else if (suffix === "/session") { if (!joined) return route.fulfill({ status: 401, json: { error: { code: "demo_session_required" } } }); value = session(); }
    else if (suffix === "/enter") { joined = true; value = session(); }
    else if (suffix === "/contribute") { linked = true; value = { linked: true }; }
    else if (suffix === "/pause") { linked = false; value = { linked: false }; }
    else if (suffix === "/network-quote") value = { maximumMicrounits: 20, modelName: "Test-only small model" };
    else if (suffix === "/chat") { paid++; return route.fulfill({ contentType: "text/event-stream", body: ': connection dropped in synthetic fixture\n\n' }); }
    else if (suffix.startsWith("/chat/")) { recoveries++; value = result; }
    else if (suffix === "/network") value = { ...metadata, at: Date.now(), joined: 15, connected: linked ? 1 : 0,
      earnedMicrounits: 0, inferences: 0, devices: Array.from({ length: 15 }, (_, i) => ({ number: i + 1,
        kind: i % 4 ? "mobile" : "computer", present: true, connected: linked && i === 0, working: false, earnedMicrounits: 0, inferences: 0 })) };
    else throw Error("Unexpected demo fixture route: " + suffix);
    return route.fulfill({ json: value });
  });
  await context.route(/\/(?:api\/)?rpc\//, route => { throw Error("Guest attempted normal account RPC: " + route.request().url()); });
  const base = `http://127.0.0.1:${server.httpServer.address().port}/__event_demo`;
  const page = await context.newPage(); await page.goto(base);
  await expect(page.getByRole("textbox", { name: "Message Mico", exact: true })).toBeEnabled();
  assert.equal(requests.filter(r => r.suffix === "/enter").length, 1);
  assert.equal(paid, 0); await page.screenshot({ path: path.join(output, "guest-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: path.join(output, "guest-mobile.png") });
  await page.getByRole("button", { name: "Start contribution", exact: true }).click();
  await expect(page.getByText("Your browser is available to the network.", { exact: true })).toBeVisible();
  assert.equal(paid, 0);
  const present = await context.newPage(); await present.goto(base + "?present=1#view=" + "v".repeat(43));
  await expect(present.getByText("Available for inference", { exact: true })).toBeVisible();
  await expect(present.getByRole("img", { name: "Scan to open Mycellios on your phone", exact: true })).toBeVisible();
  await present.screenshot({ path: path.join(output, "presenter-desktop.png") });
  assert.equal(await present.getByText("Synthetic response, no paid inference.", { exact: true }).count(), 0);
  await page.getByRole("button", { name: "Pause contribution", exact: true }).click();
  await expect(page.getByRole("button", { name: "Start contribution", exact: true })).toBeVisible();
  await expect(present.getByText("Available for inference", { exact: true })).toHaveCount(0);
  await page.getByRole("textbox", { name: "Message Mico", exact: true }).fill("Private synthetic question");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByRole("button", { name: "Check response", exact: true })).toBeEnabled();
  await page.reload();
  await expect(page.getByRole("button", { name: "Check response", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Check response", exact: true }).click();
  await expect(page.getByText("Synthetic response, no paid inference.", { exact: true })).toBeVisible();
  assert.equal(paid, 1); assert.equal(recoveries, 1);
  assert.equal(requests.filter(r => r.suffix === "/enter").length, 1);
  await page.screenshot({ path: path.join(output, "guest-recovered.png") });
  assert.deepEqual(errors, []);
  const proof = { verified: true, realComponents: true, syntheticGuestsAndWallet: true, simulatedWorker: true,
    physicalInference: false, supplierSpend: false, normalAccountRpc: false, noPaidActivation: true,
    reloadGrantIdempotency: true, readOnlyPaidResponseRecovery: true, presenterHasNoPrivateChat: true, screenshots: 4 };
  await writeFile(path.join(output, "qualification.json"), JSON.stringify(proof, null, 2)); console.log(JSON.stringify(proof));
} finally { await browser?.close(); await server.close(); }
