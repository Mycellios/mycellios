import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import { createServer } from "vite";

process.env.RAKAZO_PROJECT_LOCAL = "1";
const output = path.resolve(process.argv.find((arg) => arg.startsWith("--output="))?.slice(9) ?? "build/compact-micos-proof");
await mkdir(output, { recursive: true });
const root = path.resolve("apps/web");
process.chdir(root);
const server = await createServer({ root, configFile: path.join(root, "vite.config.ts"), server: { host: "127.0.0.1", port: 0 },
  plugins: [{ name: "compact-micos-fixture", configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (!req.url?.startsWith("/__compact_micos")) return next();
      const html = await server.transformIndexHtml(req.url, '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/e2e/fixtures/compact-micos.tsx"></script></body></html>');
      res.setHeader("content-type", "text/html"); res.end(html);
    });
  } }] });
let browser;
const proof = { kind: "actual-avatar-components-with-synthetic-values", scenarios: [], limitations: ["No installed native binary qualification"] };
try {
  await server.listen();
  const executablePath = process.env.WORKSPACE_UI_CHROMIUM ?? (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);
  browser = await chromium.launch(executablePath ? { executablePath } : existsSync(chromium.executablePath()) ? {} : { channel: "chrome" });
  const page = await browser.newPage({ viewport: { width: 900, height: 950 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__compact_micos`);
  const list = page.getByRole("region", { name: "Conversation list" });
  await expect(list.locator("[data-mico-compact]")).toHaveCount(6);
  await expect(list.locator('[data-mico-eye-source="bloub-0.6.4"]')).toHaveCount(6);
  await page.evaluate(async () => {
    const urls = [...new Set([...document.querySelectorAll("svg image")].map((el) => el.getAttribute("href")))];
    await Promise.all(urls.map((url) => new Promise((resolve, reject) => { const image = new Image(); image.onload = resolve; image.onerror = reject; image.src = url; })));
  });
  for (let i = 0; i < 6; i++) {
    const box = await page.getByTestId(`mico-${i}`).locator(":scope > svg").boundingBox();
    assert.equal(box.width, 36); assert.equal(box.height, 36);
  }
  proof.scenarios.push("six eyeless bodies and independent original eye pads at 36px");
  await page.getByRole("button", { name: "All red", exact: true }).click();
  const red = [];
  for (let i = 0; i < 6; i++) red.push(await page.getByTestId(`mico-${i}`).locator(":scope > svg").screenshot({ animations: "disabled" }));
  const eyeSources = await list.locator("[data-mico-eye-source] image").evaluateAll((els) => els.map((el) => el.getAttribute("href")));
  await page.getByRole("button", { name: "All blue", exact: true }).click();
  for (let i = 0; i < 6; i++) {
    const blue = await page.getByTestId(`mico-${i}`).locator(":scope > svg").screenshot({ animations: "disabled" });
    assert.ok(!blue.equals(red[i]), `body ${i} must visibly recolor`);
  }
  assert.deepEqual(await list.locator("[data-mico-eye-source] image").evaluateAll((els) => els.map((el) => el.getAttribute("href"))), eyeSources);
  proof.scenarios.push("all six bodies visibly change red to blue while original eye artwork stays identical");
  await page.getByRole("button", { name: "Individual colors", exact: true }).click();
  const ids = await list.locator("filter").evaluateAll((els) => els.map((el) => el.id));
  assert.equal(new Set(ids).size, 6);
  const compatibility = page.getByRole("region", { name: "Compatibility" });
  await expect(compatibility.locator('[data-mico-avatar="flat"]')).toHaveCount(2);
  await expect(compatibility.locator("img")).toHaveCount(1);
  proof.scenarios.push("explicit flat/custom eyes, other animal shapes, legacy velvet and uploaded photos remain available");
  for (const theme of ["dark", "light"]) {
    await page.evaluate((value) => document.documentElement.setAttribute("data-theme", value), theme);
    await page.screenshot({ path: path.join(output, `${theme}-36px.png`) });
  }
  await page.getByTestId("mico-0").hover();
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(await page.getByRole("region", { name: "Working" }).locator(".rakazo-compact-mico-eye").first().evaluate((el) => getComputedStyle(el).animationName), "none");
  await page.setViewportSize({ width: 390, height: 900 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: path.join(output, "mobile-reduced.png") });
  proof.scenarios.push("dark/light, mobile width and reduced motion preserve readable stationary bodies");
  assert.deepEqual(errors, []);
  proof.passed = true;
  await writeFile(path.join(output, "verification.json"), JSON.stringify(proof, null, 2));
  console.log(JSON.stringify(proof));
} finally { await browser?.close(); await server.close(); }
