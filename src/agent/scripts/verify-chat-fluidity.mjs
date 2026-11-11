import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import { createServer } from "vite";

process.env.RAKAZO_PROJECT_LOCAL = "1";
const configured = process.argv.find(arg => arg.startsWith("--output="))?.slice(9);
const output = path.resolve(configured ?? "build/chat-flow-proof");
await mkdir(output, { recursive: true });
const root = path.resolve("apps/web");
process.chdir(root);
const server = await createServer({ root, configFile: path.join(root, "vite.config.ts"),
  server: { host: "127.0.0.1", port: 0 }, plugins: [{ name: "isolated-chat-fluidity", configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (!req.url?.startsWith("/__chat_flow")) return next();
      const html = await server.transformIndexHtml(req.url, '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/e2e/fixtures/chat-fluidity.tsx"></script></body></html>');
      res.setHeader("content-type", "text/html"); res.end(html);
    });
  } }] });
let browser;
const proof = { kind: "real-components-synthetic-events", scenarios: [], benchmarks: {}, limitations: ["No live model or OAuth provider", "No installed Desktop acceptance", "Development browser timings are not production/model latency"] };
try {
  await server.listen();
  const executablePath = process.env.WORKSPACE_UI_CHROMIUM ?? (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);
  browser = await chromium.launch(executablePath ? { executablePath } : existsSync(chromium.executablePath()) ? {} : { channel: "chrome" });
  const base = `http://127.0.0.1:${server.httpServer.address().port}/__chat_flow`;
  const errors = [];
  const consoleErrors = [];
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: "no-preference" });
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
  await page.route("**/rpc/**", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ json: [] }) }));
  const open = async (query = "") => {
    await page.goto(base + query);
    await expect(page.locator("textarea")).toBeVisible();
    await page.waitForFunction(() => !!window.__chatFlow);
  };
  const send = async text => {
    await page.locator("textarea").fill(text);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByTestId("pending-message")).toContainText(text);
    await expect(page.locator("textarea")).toHaveValue("");
  };
  await open();
  await send("A message shown before the server acknowledges it");
  assert.equal(await page.evaluate(() => window.__chatFlow.metrics().sends), 1);
  await page.screenshot({ path: path.join(output, "pending-desktop.png") });
  await page.evaluate(() => window.__chatFlow.acknowledge(true));
  await expect(page.getByTestId("pending-message")).toHaveCount(0);
  await expect(page.getByText("A message shown before the server acknowledges it", { exact: true })).toHaveCount(1);
  proof.scenarios.push("immediate pending row with delayed HTTP; SSE-before-HTTP has one bubble");
  await send("Acknowledged before its event");
  await page.evaluate(() => window.__chatFlow.acknowledge(false));
  await expect(page.getByText("Acknowledged before its event", { exact: true })).toHaveCount(1);
  await expect(page.getByTestId("pending-message")).toHaveCount(0);
  proof.scenarios.push("HTTP-before-SSE preserves one message and exact durable sequence");
  await send("Keep this draft on failure");
  await page.evaluate(() => window.__chatFlow.reject());
  await expect(page.getByTestId("pending-message")).toHaveCount(0);
  await expect(page.locator("textarea")).toHaveValue("Keep this draft on failure");
  proof.scenarios.push("rejected send removes local row and restores its draft");
  await open();
  await send("Pending in the first conversation only");
  await page.evaluate(() => window.__chatFlow.changeThread());
  await expect(page.getByTestId("pending-message")).toHaveCount(0);
  await page.evaluate(() => window.__chatFlow.acknowledge(true));
  await expect(page.getByText("Pending in the first conversation only", { exact: true })).toHaveCount(0);
  proof.scenarios.push("navigation and late acknowledgement do not leak into another chat");
  await open();
  await send("Private account draft");
  await page.evaluate(() => window.__chatFlow.changeScope());
  await expect(page.getByTestId("pending-message")).toHaveCount(0);
  proof.scenarios.push("account/Space change hides another scope's pending send");

  for (const [mode, query] of [["immediate", "?immediate"], ["frame", ""]]) {
    await open(query);
    proof.benchmarks[mode] = await page.evaluate(() => window.__chatFlow.burst());
    await expect(page.getByText(proof.benchmarks[mode].finalText.trim(), { exact: true })).toHaveCount(1);
  }
  assert.equal(proof.benchmarks.immediate.events, proof.benchmarks.frame.events);
  assert.ok(proof.benchmarks.frame.paints < proof.benchmarks.immediate.paints, "presentation must coalesce actual progress events");
  proof.scenarios.push("every event reduced; identical complete reply with fewer presentation commits");

  for (const [name, width, height, theme, reducedMotion] of [
    ["mobile-light", 390, 844, "light", "no-preference"],
    ["mobile-dark-reduced", 390, 844, "dark", "reduce"],
  ]) {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion });
    await open();
    await page.evaluate(theme => document.documentElement.setAttribute("data-theme", theme), theme);
    await send("A quick mobile message");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    if (reducedMotion === "reduce") assert.equal(await page.getByTestId("pending-message").evaluate(el => getComputedStyle(el).animationName), "none");
    await page.screenshot({ path: path.join(output, `${name}.png`) });
    await page.evaluate(() => window.__chatFlow.acknowledge(true));
    const chat = page.getByTestId("transcript");
    await expect.poll(() => chat.evaluate(el => Math.round(el.scrollHeight - el.scrollTop - el.clientHeight))).toBe(0);
    await chat.evaluate(el => { el.scrollTop = 500; });
    await page.getByRole("button", { name: "Jump to latest" }).waitFor({ state: "visible" });
    await page.evaluate(() => window.__chatFlow.emit({ type: "thread.progress", payload: { text: "Streaming while reading history", streaming: true } }));
    await expect.poll(() => chat.evaluate(el => el.scrollTop)).toBe(500);
    proof.scenarios.push(`${name}: no overflow; pending feedback; follow-tail respects history`);
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(consoleErrors, []);
  proof.passed = true;
  await writeFile(path.join(output, "verification.json"), JSON.stringify(proof, null, 2));
  console.log(JSON.stringify(proof, null, 2));
} finally {
  await browser?.close(); await server.close();
}
