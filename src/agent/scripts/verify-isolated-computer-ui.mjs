import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import { createServer } from "vite";

process.env.RAKAZO_PROJECT_LOCAL = "1";
const output = path.resolve(process.argv.find(arg => arg.startsWith("--output="))?.slice(9) ?? "isolated-computer-proof");
await mkdir(output, { recursive: true });
const root = path.resolve("apps/web"); process.chdir(root);
const server = await createServer({ root, envFile: false, configFile: path.join(root, "vite.config.ts"),
  optimizeDeps: { entries: [path.join(root, "e2e/fixtures/isolated-computer.tsx")] },
  server: { host: "127.0.0.1", port: 0 }, plugins: [{ name: "isolated-computer-qualification", configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (req.url?.split("?")[0] !== "/__isolated_computer") return next();
      const html = await server.transformIndexHtml(req.url, '<!doctype html><html lang="en" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/e2e/fixtures/isolated-computer.tsx"></script></body></html>');
      res.setHeader("content-type", "text/html"); res.end(html);
    });
  } }] });
let browser;
try {
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch(existsSync("/usr/bin/chromium") ? { executablePath: "/usr/bin/chromium" } : {});
  const page = await browser.newPage({ viewport: { width: 1000, height: 740 } });
  const errors = [], unexpected = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) { unexpected.push(url.origin); return route.abort(); }
    if (url.pathname.endsWith("/rpc/skills/list")) return route.fulfill({ json: { json: [] } });
    if (/\/(?:api\/)?rpc\//.test(url.pathname) || /^\/(?:api|mobile|v1)\//.test(url.pathname)) {
      unexpected.push(url.pathname); return route.abort();
    }
    if (url.pathname === "/novnc/isolated-fixture") return route.fulfill({ contentType: "text/html; charset=utf-8", body: '<!doctype html><meta charset="utf-8"><title>Synthetic isolated screen</title><body style="background:#1e2421;color:#fff;font:16px system-ui;padding:32px">Synthetic screen for Ada — no real computer</body>' });
    return route.continue();
  });
  const base = origin + "/__isolated_computer";
  await page.goto(base);
  const isolated = page.getByRole("button", { name: "In the cloud", exact: true });
  await expect(isolated).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Your PC", exact: true })).toBeDisabled();
  assert.deepEqual(await page.evaluate(() => window.__isolatedFixture.calls), []);
  await page.getByRole("button", { name: "In the cloud, shared", exact: true }).click();
  await expect(page.getByText("It works on a Mycellios server computer that it shares with your other Micos in this space. It cannot see your PC.", { exact: true })).toBeVisible();
  await isolated.click();
  await page.screenshot({ path: path.join(output, "computer-isolation-desktop.png"), animations: "disabled" });
  await page.getByRole("button", { name: "Open synthetic screen", exact: true }).click();
  await expect(page.getByTitle("Bot screen", { exact: true })).toBeVisible();
  await expect(page.getByTitle("Bot screen", { exact: true })).toHaveCSS("pointer-events", "none");
  await expect(page.getByTitle("Bot screen", { exact: true })).toHaveAttribute("sandbox", "allow-scripts allow-pointer-lock");
  await page.getByRole("button", { name: "Take control", exact: true }).click();
  await expect(page.getByTitle("Bot screen", { exact: true })).toHaveCSS("pointer-events", "auto");
  await page.screenshot({ path: path.join(output, "computer-isolation-takeover.png"), animations: "disabled" });
  await page.getByRole("button", { name: "Release control", exact: true }).click();
  await expect(page.getByTitle("Bot screen", { exact: true })).toHaveCSS("pointer-events", "none");
  assert.deepEqual(await page.evaluate(() => window.__isolatedFixture.calls), ["mode:team", "mode:isolated", "preview", "take-control", "release"]);
  for (const blocked of ["1", "approval"]) {
    await page.goto(base + `?blocked=${blocked}`);
    await page.getByRole("button", { name: "Open synthetic screen", exact: true }).click();
    await expect(page.getByRole("button", { name: "Take control", exact: true })).toHaveCount(0);
    assert.deepEqual(await page.evaluate(() => window.__isolatedFixture.calls), ["preview"]);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + "?lang=es");
  await expect(page.getByRole("button", { name: "Servidor, solo este Mico", exact: true })).toBeVisible();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const lightBackground = await page.locator("main").evaluate(element => getComputedStyle(element).backgroundColor);
  await page.screenshot({ path: path.join(output, "computer-isolation-mobile-es.png"), animations: "disabled" });
  await page.evaluate(() => { document.documentElement.classList.add("dark"); document.documentElement.dataset.theme = "dark"; });
  await expect(page.locator("main")).not.toHaveCSS("background-color", lightBackground);
  const darkForeground = await page.locator("main").evaluate(element => getComputedStyle(element).color);
  await expect(page.getByRole("button", { name: "Servidor, solo este Mico", exact: true })).toHaveCSS("color", darkForeground);
  await page.screenshot({ path: path.join(output, "computer-isolation-mobile-dark.png"), animations: "disabled" });
  await page.goto(base);
  await page.getByRole("button", { name: "Open synthetic screen", exact: true }).click();
  await page.getByRole("button", { name: "Take control", exact: true }).click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const info = await page.getByTestId("computer-chrome-info").boundingBox();
  const actions = await page.getByTestId("computer-chrome-actions").boundingBox();
  assert(info && actions && info.y + info.height <= actions.y, "mobile computer identity must not overlap its controls");
  await page.screenshot({ path: path.join(output, "computer-isolation-mobile-control.png"), animations: "disabled" });
  assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
  const proof = { passed: true, actualControls: true, actualComputerOverlay: true, syntheticScreen: true, explicitTakeoverAndRelease: true,
    blockedRunCannotTakeOver: true, distinctLightAndDarkThemes: true, noAutomaticComputeOrConsent: true, externalRequests: 0, paidInferenceCalls: 0, productionAccess: false };
  await writeFile(path.join(output, "qualification.json"), JSON.stringify(proof, null, 2)); console.log(JSON.stringify(proof));
} finally { await browser?.close(); await server.close(); }
