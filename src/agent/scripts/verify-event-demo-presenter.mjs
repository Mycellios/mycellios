import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import { createServer } from "vite";
process.env.RAKAZO_PROJECT_LOCAL = "1";
const output = path.resolve(process.argv.find(v => v.startsWith("--output="))?.slice(9) ?? "event-presenter-proof");
await mkdir(output, { recursive: true });
const root = path.resolve("apps/web"); process.chdir(root);
const server = await createServer({ root, configFile: path.join(root, "vite.config.ts"),
  optimizeDeps: { entries: [path.join(root, "e2e/fixtures/event-demo-presenter.tsx")] },
  server: { host: "127.0.0.1", port: 0 }, plugins: [{ name: "isolated-mycelium-presenter",
    configureServer(server) { server.middlewares.use(async (req, res, next) => {
      if (!req.url?.startsWith("/__mycelium_presenter")) return next();
      const html = await server.transformIndexHtml(req.url, '<!doctype html><html lang="en" data-theme="light"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/e2e/fixtures/event-demo-presenter.tsx"></script></body></html>');
      res.setHeader("content-type", "text/html"); res.end(html);
    }); },
  }] });
let browser;
try {
  await server.listen(); browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage(), errors = [], requests = [];
  page.on("pageerror", e => errors.push(e.message));
  let count = 0, unavailable = false;
  await context.route("**/mobile/v1/demo/test-only-event/**", async route => {
    assert.equal(route.request().method(), "GET"); assert.ok(route.request().url().endsWith("/network"));
    requests.push(route.request().method());
    if (unavailable) return route.fulfill({ status: 503, json: { error: { code: "fixture-offline" } } });
    return route.fulfill({ json: { open: true, joined: 50, maxGuests: 50, at: Date.now(), inferences: 0, earnedMicrounits: 0,
      inviteUrl: "https://example.invalid/agent/demo/test-only-event", connected: Math.floor(count / 3),
      devices: Array.from({ length: count }, (_, i) => ({ number: i + 1, present: true, connected: i % 3 === 2,
        working: false, kind: i % 3 ? "mobile" : "computer", earnedMicrounits: 0, inferences: 0 })) } });
  });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__mycelium_presenter#view=fixture-only`);
  await expect(page.getByTestId("demo-present-count")).toHaveText("0", { timeout: 30000 });
  await expect(page.getByText("No one is connected right now.", { exact: true })).toBeVisible();
  count = 1; await expect(page.locator(".mycelium-peer")).toHaveCount(1);
  await expect.poll(() => page.locator(".mycelium-peer").evaluate(node => getComputedStyle(node).opacity)).toBe("1");
  const first = await page.locator(".mycelium-peer").getAttribute("style");
  count = 15; await expect(page.getByTestId("demo-present-count")).toHaveText("15");
  await expect(page.locator(".mycelium-peer").first()).toHaveAttribute("style", first);
  assert.equal(await page.locator(".mycelium-peer").count(), 15);
  assert.equal(await page.locator(".mycelium-branch").count(), 27);
  await page.getByRole("button", { name: "Pause animation", exact: true }).click();
  await expect(page.locator(".mycelium-scene")).toHaveAttribute("data-motion", "paused");
  assert.equal(await page.locator(".mycelium-work").count(), 0, "Idle ready browsers must not simulate inference traffic");
  await page.screenshot({ path: path.join(output, "mycelium-15-desktop.png"), fullPage: true });
  await page.getByRole("button", { name: "Resume animation", exact: true }).click();
  await expect(page.locator(".mycelium-scene")).toHaveAttribute("data-motion", "running");
  count = 50; await expect(page.getByTestId("demo-present-count")).toHaveText("50");
  await page.screenshot({ path: path.join(output, "mycelium-50-desktop.png"), fullPage: true, animations: "disabled" });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const motion = await page.locator(".mycelium-peer").first().evaluate(node => getComputedStyle(node).animationName);
  assert.equal(motion, "none");
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.ok(await page.locator(".event-demo-qr").getByRole("img").count());
  await page.screenshot({ path: path.join(output, "mycelium-mobile.png"), fullPage: true });
  unavailable = true; await expect(page.getByTestId("demo-present-count")).toHaveText("—");
  await expect(page.locator(".mycelium-peer")).toHaveCount(0);
  unavailable = false; count = 0; await expect(page.getByTestId("demo-present-count")).toHaveText("0");
  await expect(page.getByText("No one is connected right now.", { exact: true })).toBeVisible();
  assert.deepEqual(errors, []);
  const proof = { realPresenter: true, fixturesOnly: true, supplierSpend: false, states: [0, 1, 15, 50, "offline", 0],
    stablePositions: true, noIdleTrafficAnimation: true, pauseResume: true, reducedMotion: true, mobileBodyOverflow: false, requests: requests.length };
  await writeFile(path.join(output, "qualification.json"), JSON.stringify(proof, null, 2)); console.log(JSON.stringify(proof));
} finally { await browser?.close(); await server.close(); }
