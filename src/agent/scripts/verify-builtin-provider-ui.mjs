import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import { createServer } from "vite";

process.env.RAKAZO_PROJECT_LOCAL = "1";
const output = path.resolve(process.argv.find(arg => arg.startsWith("--output="))?.slice(9) ?? "builtin-provider-proof");
await mkdir(output, { recursive: true });
const root = path.resolve("apps/web"); process.chdir(root);
const server = await createServer({ root, envFile: false, configFile: path.join(root, "vite.config.ts"), optimizeDeps: { entries: [path.join(root, "e2e/fixtures/builtin-provider.tsx")] }, server: { host: "127.0.0.1", port: 0 }, plugins: [{
  name: "isolated-builtin-provider", configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (!req.url?.startsWith("/__builtin_provider")) return next();
      const html = await server.transformIndexHtml(req.url, '<!doctype html><html lang="en" data-theme="light"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/e2e/fixtures/builtin-provider.tsx"></script></body></html>');
      res.setHeader("content-type", "text/html"); res.end(html);
    });
  },
}] });
let browser;
try {
  await server.listen();
  const executablePath = process.env.WORKSPACE_UI_CHROMIUM ?? (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);
  browser = await chromium.launch(executablePath ? { executablePath } : {});
  const page = await browser.newPage({ viewport: { width: 1000, height: 680 } });
  const errors = [], unexpectedRpc = [], externalRequests = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1") { externalRequests.push(url.origin); return route.abort(); }
    return route.continue();
  });
  await page.route("**/api/auth/capabilities", route => route.fulfill({ json: {
    sso: { name: "Mycellios", availability: "available" }, mycelliosAccount: true, passwordAuth: false, passwordReset: false, resetUrl: null,
  } }));
  await page.route(/\/(?:api\/)?rpc\//, route => { unexpectedRpc.push(route.request().url()); return route.abort(); });
  const base = `http://127.0.0.1:${server.httpServer.address().port}/__builtin_provider`;
  async function open(query = "") {
    await page.goto(base + query);
    await page.getByRole("button", { name: "Model", exact: true }).click();
    const providers = page.getByRole("group", { name: "Providers", exact: true });
    await expect(providers.getByRole("button").first()).toHaveAttribute("aria-label", "Mycellios");
    await expect(providers.getByRole("button", { name: "ChatGPT", exact: true })).toBeVisible();
    await providers.getByRole("button", { name: "Mycellios", exact: true }).click();
    return providers;
  }
  const providers = await open();
  await expect(page.getByRole("button", { name: "Use my credits", exact: true })).toBeEnabled();
  await expect(page.getByText("No matching models", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Disconnect", exact: true })).toHaveCount(0);
  await page.screenshot({ path: path.join(output, "unconfigured-light.png") });
  await providers.getByRole("button", { name: "ChatGPT", exact: true }).click();
  await expect(page.getByRole("option", { name: "ChatGPT", exact: true })).toBeVisible();
  await open("?connected=1");
  await expect(page.getByRole("option", { name: "Fixture credit model (Mycellios)", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Use my credits", exact: true })).toHaveCount(0);
  await page.screenshot({ path: path.join(output, "connected-light.png") });
  await page.evaluate(() => { document.documentElement.classList.add("dark"); document.documentElement.dataset.theme = "dark"; });
  await page.screenshot({ path: path.join(output, "connected-dark.png") });
  for (const connected of [false, true]) {
    await page.goto(base + `?personal=1${connected ? "&connected=1" : ""}`);
    await page.getByRole("button", { name: "Model", exact: true }).click();
    await expect(page.getByRole("option", { name: "Fixture personal model (OpenCode Go)", exact: true })).toBeVisible();
    await page.screenshot({ path: path.join(output, `personal-provider-${connected ? "connected" : "unconnected"}.png`) });
    await page.getByRole("button", { name: "Explore models with my credits", exact: true }).click();
    await expect(page.getByRole("button", { name: "Explore models with my credits", exact: true })).toHaveCount(0);
    if (connected) await expect(page.getByRole("option", { name: "Fixture credit model (Mycellios)", exact: true })).toBeVisible();
    else await expect(page.getByRole("button", { name: "Use my credits", exact: true })).toBeVisible();
    assert.equal(await page.evaluate(() => window.fixtureModelSaves), 0);
    await page.screenshot({ path: path.join(output, `personal-credit-exploration-${connected ? "connected" : "unconnected"}.png`) });
  }
  await page.goto(base + "?desktop=1");
  await page.getByRole("button", { name: "Model", exact: true }).click();
  const desktopProviders = page.getByRole("group", { name: "Providers", exact: true });
  await expect(desktopProviders.getByRole("button", { name: "OpenCode", exact: true })).toBeVisible();
  await expect(desktopProviders.getByRole("button", { name: "ChatGPT", exact: true })).toHaveCount(0);
  assert.equal(await page.evaluate(() => window.fixtureModelSaves), 0);
  await page.setViewportSize({ width: 390, height: 720 });
  await open();
  await expect(page.getByRole("button", { name: "Use my credits", exact: true })).toBeVisible();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: path.join(output, "unconfigured-narrow.png") });
  await page.goto(base + "?personal=1&connected=1");
  await page.getByRole("button", { name: "Model", exact: true }).click();
  await expect(page.getByRole("button", { name: "Explore models with my credits", exact: true })).toBeVisible();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: path.join(output, "personal-provider-narrow.png") });
  assert.equal(await page.evaluate(() => window.fixtureModelSaves), 0);
  assert.deepEqual(errors, []); assert.deepEqual(unexpectedRpc, []); assert.deepEqual(externalRequests, []);
  const proof = { verified: true, realComponents: true, syntheticAccount: true, nativeProviderPreserved: true, desktopEngineScoped: true, builtinAlwaysVisible: true, creditExplorationDoesNotSaveOrConnect: true, paidInference: false, liveIdentityOrWallet: false, screenshots: 9 };
  await writeFile(path.join(output, "qualification.json"), JSON.stringify(proof, null, 2)); console.log(JSON.stringify(proof));
} finally { await browser?.close(); await server.close(); }
