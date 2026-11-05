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
  await page.getByRole("button", { name: "Review API", exact: true }).waitFor();
  for (const [name, width, height, theme] of [["desktop", 1280, 800, "light"], ["mobile", 390, 844, "light"], ["mobile-dark", 390, 844, "dark"]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(theme => document.documentElement.setAttribute("data-theme", theme), theme);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const add = page.getByRole("button", { name: "New task", exact: true });
    assert.equal(await add.isVisible(), true);
    await page.screenshot({ path: path.join(output, `${name}.png`), animations: "disabled" });
  }
  await page.getByRole("button", { name: "Review API", exact: true }).click();
  assert.equal(await page.getByTestId("active-task").textContent(), "task-one");
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await page.getByRole("textbox", { name: "New task", exact: true }).fill("New independent task");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page.getByRole("button", { name: "New independent task", exact: true }).waitFor();
  assert.match(await page.getByTestId("active-task").textContent(), /^mico-task:mico-fixture:/);
  await page.screenshot({ path: path.join(output, "created-task.png") });
  await page.getByRole("button", { name: "Main chat", exact: true }).click();
  assert.equal(await page.getByTestId("active-task").textContent(), "Main chat");
  await page.getByRole("button", { name: "Work", exact: true }).click();
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
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.locator('[data-slot="dialog-content"]').evaluate(root => { for (const node of [root, ...root.querySelectorAll('*')]) if (node instanceof HTMLElement) node.scrollTop = 0; });
  await page.screenshot({ path: path.join(output, "workflow-mobile.png"), animations: "disabled" });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForFunction(() => document.querySelector('[role="dialog"]')?.getBoundingClientRect().width > 1000);
  assert.ok((await page.getByRole("dialog").boundingBox()).width > 1000, "desktop workflow editor must use the available width");
  assert.ok((await page.getByLabel("Workflow canvas").boundingBox()).width > 700, "desktop graph must remain visible beside its properties");
  await page.screenshot({ path: path.join(output, "workflow-desktop.png"), animations: "disabled" });
  assert.deepEqual(errors, []);
  const result = { passed: true, fixtureOnly: true, productionAccess: false, screenshots: output, checks: ["desktop and mobile overflow", "light and dark theme", "select private task", "create in the existing Mico", "return to main chat", "change Mico concurrency", "save and execute visual workflow", "stop workflow", "no browser errors"] };
  await writeFile(path.join(output, "result.json"), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
} finally { await browser?.close(); await server.close(); }
