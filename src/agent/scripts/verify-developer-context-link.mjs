import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import { createServer } from "vite";

process.env.RAKAZO_PROJECT_LOCAL = "1";
const output = path.resolve(process.argv.find(arg => arg.startsWith("--output="))?.slice(9) ?? "build/developer-context-link");
await mkdir(output, { recursive: true });
const root = path.resolve("apps/web");
process.chdir(root);
const server = await createServer({ root, configFile: path.join(root, "vite.config.ts"), server: { host: "127.0.0.1", port: 0 },
  plugins: [{ name: "developer-link-fixture", configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (!req.url?.startsWith("/__developer_link")) return next();
      const html = await server.transformIndexHtml(req.url, '<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/e2e/fixtures/developer-context-link.tsx"></script></body></html>');
      res.setHeader("content-type", "text/html"); res.end(html);
    });
  } }] });
let browser;
try {
  await server.listen();
  browser = await chromium.launch(existsSync(chromium.executablePath()) ? {} : { channel: "chrome" });
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  const context = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"], viewport: { width: 1180, height: 350 } });
  await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const page = await context.newPage(), errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(origin + "/__developer_link?token=must-not-copy#private");
  const button = page.getByTestId("developer-context-link");
  await expect(page.getByLabel("Modo desarrollador")).toBeVisible();
  await expect(button).toHaveCount(0);
  await page.getByLabel("Modo desarrollador").check();
  await expect(button).toHaveAccessibleName("Copiar enlace de depuración");
  const lightBackground = await page.locator("main").evaluate(el => getComputedStyle(el).backgroundColor);
  await page.locator("header").screenshot({ path: path.join(output, "header-light.png") });
  const before = page.url();
  await button.click();
  await expect(button).toHaveAccessibleName("Enlace de depuración copiado");
  const copied = new URL(await page.evaluate(() => navigator.clipboard.readText()));
  assert.equal(copied.origin, origin); assert.equal(copied.pathname, "/app/fixture-mico");
  assert.deepEqual(Object.fromEntries(copied.searchParams), { noticeSpace: "fixture-space", threadId: "fixture-thread-1", runId: "fixture-run-1" });
  assert.equal(page.url(), before);
  await page.getByRole("button", { name: "Nueva conversación" }).click();
  await button.focus(); await page.keyboard.press("Enter");
  await expect(button).toHaveAccessibleName("Enlace de depuración copiado");
  const nested = new URL(await page.evaluate(() => navigator.clipboard.readText()));
  assert.equal(nested.searchParams.get("task"), "fixture-thread-2");
  assert.equal(nested.searchParams.get("runId"), "fixture-run-2");
  await page.reload(); await expect(button).toBeVisible();
  await page.getByRole("button", { name: "Cambiar tema" }).click();
  assert.notEqual(await page.locator("main").evaluate(el => getComputedStyle(el).backgroundColor), lightBackground);
  await page.locator("header").screenshot({ path: path.join(output, "header-dark.png") });
  await page.setViewportSize({ width: 390, height: 350 });
  await page.locator("header").screenshot({ path: path.join(output, "header-mobile.png") });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.getByLabel("Modo desarrollador").uncheck(); await expect(button).toHaveCount(0);
  await page.reload(); await expect(button).toHaveCount(0);
  assert.deepEqual(errors, []);
  const proof = { component: "DeveloperContextLink", realClipboard: true, keyboardCopy: true, currentContext: true, developerGate: true, preferencePersists: true, noNavigation: true, noExternalNetwork: true, screenshots: ["header-light.png", "header-dark.png", "header-mobile.png"], limitations: ["Isolated production component fixture; no installed Desktop or paid inference"] };
  await writeFile(path.join(output, "proof.json"), JSON.stringify(proof, null, 2));
  console.log(JSON.stringify(proof));
} finally { await browser?.close(); await server.close(); }
