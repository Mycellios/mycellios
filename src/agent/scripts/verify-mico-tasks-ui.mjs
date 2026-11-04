import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";
import { createServer } from "vite";

// Only a loopback component fixture, with synthetic RPCs and no account or backend.
process.env.RAKAZO_PROJECT_LOCAL = "1";
process.env.SCREEN_PROXY_SECRET = randomBytes(32).toString("hex");
const root = path.resolve("apps/web");
process.chdir(root);
const output = await mkdtemp(path.join(tmpdir(), "mycellios-task-ui-"));
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
  assert.deepEqual(errors, []);
  const result = { passed: true, fixtureOnly: true, productionAccess: false, screenshots: output, checks: ["desktop and mobile overflow", "light and dark theme", "select private task", "create in the existing Mico", "return to main chat", "no browser errors"] };
  await writeFile(path.join(output, "result.json"), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
} finally { await browser?.close(); await server.close(); }
