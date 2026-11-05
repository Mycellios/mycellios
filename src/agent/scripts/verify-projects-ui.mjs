import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";
import { createServer } from "vite";
process.env.RAKAZO_PROJECT_LOCAL = "1";
const root = path.resolve("apps/web"); process.chdir(root);
const preview = process.argv.includes("--serve");
const output = await mkdtemp(path.join(tmpdir(), "mycellios-projects-ui-"));
const server = await createServer({ root, configFile: path.join(root, "vite.config.ts"), server: { host: "127.0.0.1", port: 0 }, plugins: [{
  name: "isolated-projects-ui", configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (req.url !== "/__projects_fixture") return next();
      const html = await server.transformIndexHtml(req.url, '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/e2e/fixtures/projects-preview.tsx"></script></body></html>');
      res.setHeader("content-type", "text/html"); res.end(html);
    });
  },
}] });
let browser;
try {
  await server.listen();
  if (preview) {
    console.log(`Local UI fixture only: http://127.0.0.1:${server.httpServer.address().port}/__projects_fixture?demo=1`);
    await new Promise(resolve => { process.once("SIGINT", resolve); process.once("SIGTERM", resolve); });
    process.exitCode = 0;
  } else {
  browser = await chromium.launch(existsSync(chromium.executablePath()) ? {} : { channel: "chrome" });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__projects_fixture`);
  assert.equal(await page.getByRole("region", { name: "Projects" }).count(), 0);
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page.getByRole("textbox", { name: "Project name" }).fill("Example app");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  for (const title of ["Improve login", "Test payments"]) {
    await page.getByRole("button", { name: "New conversation in Example app" }).click();
    await page.getByRole("textbox", { name: "Conversation title" }).fill(title);
    await page.getByRole("button", { name: "Create conversation", exact: true }).click();
    await page.getByTestId("active-conversation").filter({ hasText: title }).waitFor();
    await page.locator("textarea").fill(`Draft for ${title}`);
  }
  await page.getByRole("button", { name: "Improve login", exact: true }).click();
  assert.equal(await page.locator("textarea").inputValue(), "Draft for Improve login");
  await page.getByRole("button", { name: "Test payments", exact: true }).click();
  assert.equal(await page.locator("textarea").inputValue(), "Draft for Test payments");
  for (const [name, width, height, theme] of [["desktop", 1280, 800, "light"], ["mobile", 390, 844, "light"], ["mobile-dark", 390, 844, "dark"]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(theme => document.documentElement.setAttribute("data-theme", theme), theme);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: path.join(output, `${name}.png`), animations: "disabled" });
    if (width < 600) {
      await page.getByRole("button", { name: "Open navigation" }).click();
      await page.screenshot({ path: path.join(output, `${name}-navigation.png`), animations: "disabled" });
      await page.getByRole("button", { name: "Test payments", exact: true }).click();
    }
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole("button", { name: "Personal assistant", exact: true }).click();
  assert.equal(await page.locator("textarea").inputValue(), "");
  assert.deepEqual(errors, []);
  const result = { passed: true, fixtureOnly: true, productionAccess: false, screenshots: output,
    checks: ["projects hidden before creation", "create project", "two conversations on one existing Mico", "switch conversations", "draft separation", "return to ordinary chat", "desktop/mobile overflow", "light/dark", "no browser errors"] };
  await writeFile(path.join(output, "result.json"), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
  }
} finally { await browser?.close(); await server.close(); }
