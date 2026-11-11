import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import { createServer } from "vite";

process.env.RAKAZO_PROJECT_LOCAL = "1";
const root = path.resolve("apps/web");
const configured = process.argv.find(arg => arg.startsWith("--output="))?.slice(9);
const output = configured ? path.resolve(configured) : await mkdtemp(path.join(tmpdir(), "mycellios-workspace-ui-"));
await mkdir(output, { recursive: true });
process.chdir(root);
const server = await createServer({ root, configFile: path.join(root, "vite.config.ts"), server: { host: "127.0.0.1", port: 0 }, plugins: [{
  name: "isolated-workspace-ui", configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      const fixture = { "/__workspace_fixture": "workspace-sync-preview", "/__settings_fixture": "settings-preview" }[req.url?.split("?")[0]];
      if (!fixture) return next();
      const html = await server.transformIndexHtml(req.url, `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/e2e/fixtures/${fixture}.tsx"></script></body></html>`);
      res.setHeader("content-type", "text/html"); res.end(html);
    });
  },
}] });
let browser;
try {
  await server.listen();
  const executablePath = process.env.WORKSPACE_UI_CHROMIUM ?? (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);
  browser = await chromium.launch(executablePath ? { executablePath } : existsSync(chromium.executablePath()) ? {} : { channel: "chrome" });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__workspace_fixture`);
  const rail = page.getByTestId("workspace-rail");
  await expect(page.getByRole("textbox", { name: "What would you like done?" })).toBeEnabled();
  await page.getByRole("textbox", { name: "What would you like done?" }).fill("Synthetic task draft");
  await page.screenshot({ path: path.join(output, "tasks-desktop.png"), animations: "disabled" });
  await rail.getByRole("button", { name: "More", exact: true }).click();
  const menu = page.getByRole("menu", { name: "More", exact: true });
  const before = await menu.boundingBox();
  await page.getByRole("menuitemcheckbox", { name: "Pin Usage", exact: true }).click();
  await expect(menu).toBeVisible();
  assert.ok(Math.abs((await menu.boundingBox()).y - before.y) < 2, "unpinning must not move the open menu");
  await page.screenshot({ path: path.join(output, "rail-pins.png"), animations: "disabled" });
  await page.getByRole("menuitemcheckbox", { name: "Pin Usage", exact: true }).click();
  await page.keyboard.press("Escape");

  await rail.getByRole("button", { name: "Workflows", exact: true }).click();
  await page.getByRole("button", { name: "Add trigger", exact: true }).click();
  await page.getByRole("button", { name: "Add node", exact: true }).click();
  await page.getByRole("menuitem", { name: "Condition", exact: true }).click();
  await page.getByRole("combobox", { name: "Condition", exact: true }).selectOption("contains");
  await page.getByRole("textbox", { name: "Compare with", exact: true }).fill("ready");
  await page.getByRole("button", { name: "Save workflow", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__workspaceFixture.calls.filter(call => call.path === "workflows/create").length)).toBe(1);
  assert.ok(await page.evaluate(() => window.__workspaceFixture.calls.find(call => call.path === "workflows/create").input.graph.nodes.some(node => node.kind === "condition" && node.condition.operator === "contains" && node.condition.value === "ready")));
  await page.screenshot({ path: path.join(output, "workflow-condition.png"), animations: "disabled" });

  await rail.getByRole("button", { name: "Routines", exact: true }).click();
  await expect(page.getByTestId("routine-workspace")).toContainText("Fixture reminder");
  await page.screenshot({ path: path.join(output, "routine-canvas.png"), animations: "disabled" });
  await rail.getByRole("button", { name: "Schedule", exact: true }).click();
  await expect(page.getByTestId("schedule-workspace")).toBeVisible();
  await page.getByRole("button", { name: "Month", exact: true }).click();
  await expect(page.getByTestId("schedule-workspace")).toHaveAttribute("data-view", "month");
  await page.screenshot({ path: path.join(output, "schedule-month.png"), animations: "disabled" });
  const quotaTrigger = rail.getByTestId("provider-quota-trigger");
  await quotaTrigger.hover();
  await expect(page.getByTestId("provider-quota-panel")).toBeVisible();
  await quotaTrigger.click();
  await expect(page.getByTestId("provider-quota-panel")).toBeHidden();
  await expect(page.getByRole("combobox", { name: "Usage period" })).toBeVisible();
  await page.getByRole("combobox", { name: "Usage period" }).selectOption("7");
  await page.screenshot({ path: path.join(output, "usage-dashboard.png"), animations: "disabled" });
  await rail.getByRole("button", { name: "Marketplace", exact: true }).click();
  await expect(page.getByTestId("marketplace-apps")).toContainText("GitHub");
  await page.getByRole("navigation", { name: "Marketplace sections" }).getByRole("button", { name: "Skills", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Skills", exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(output, "marketplace-skills.png"), animations: "disabled" });
  await rail.getByRole("button", { name: "Help", exact: true }).click();
  await expect(page.getByTestId("help-menu")).toContainText("Help and resources");
  await page.keyboard.press("Escape");
  for (const [name, width, height, theme] of [["mobile-light", 390, 844, "light"], ["mobile-dark", 390, 844, "dark"]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(theme => document.documentElement.setAttribute("data-theme", theme), theme);
    await page.getByRole("navigation", { name: "Fixture pages" }).getByRole("button", { name: "tasks", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "What would you like done?" })).toHaveValue("Synthetic task draft");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: path.join(output, `${name}.png`), animations: "disabled" });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__settings_fixture`);
  await page.getByRole("combobox", { name: "Open chats in" }).click();
  await page.getByRole("option", { name: "Floating windows", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Open chats in" })).toHaveText("Floating windows");
  await page.getByRole("button", { name: "Open floating chat" }).click();
  await expect.poll(() => page.evaluate(() => window.__settingsFixture.calls.some(call => call.botId === "fixture-mico"))).toBe(true);
  await expect(page.getByRole("img", { name: "Scan to open Mycellios on your phone" })).toBeVisible();
  await page.screenshot({ path: path.join(output, "dock-and-mobile-code.png"), animations: "disabled" });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: path.join(output, "settings-mobile.png"), animations: "disabled" });
  const micos = page.getByTestId("mico-preferences-preview");
  await expect(micos.getByRole("combobox", { name: "Messages while Investigación works" })).toBeHidden();
  await micos.getByRole("button", { name: "Customize by Mico" }).click();
  await micos.getByRole("textbox", { name: "Search Micos", exact: true }).fill("investigacion");
  await expect(micos.getByRole("combobox", { name: "Messages while Mico 1 works", exact: true })).toHaveCount(0);
  await micos.getByRole("combobox", { name: "Messages while Investigación works" }).click();
  await page.getByRole("option", { name: "Current task", exact: true }).click();
  await expect(micos.getByRole("combobox", { name: "Messages while Investigación works" })).toHaveText("Current task");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await micos.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, "mico-preferences-mobile.png"), animations: "disabled" });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: path.join(output, "mico-preferences-desktop.png"), animations: "disabled" });
  assert.deepEqual(errors, []);
  const result = { passed: true, realAccount: false, modelsCalled: false, microphoneUsed: false,
    checks: ["task draft retained across workspaces", "stable pin menu", "condition node saved through the real client", "routine canvas", "calendar modes", "usage filters", "unified marketplace", "help menu", "mobile light/dark layout", "dock floating mode and scoped opening", "mobile QR canvas", "settings mobile layout"] };
  await writeFile(path.join(output, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  console.log(`Workspace screenshots: ${output}`);
} catch (error) {
  if (browser) await browser.contexts()[0]?.pages()[0]?.screenshot({ path: path.join(output, "failure.png"), fullPage: true }).catch(() => {});
  throw error;
} finally { await browser?.close(); await server.close(); }
