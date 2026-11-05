// Run after build-local-preview.mjs through the shared local scheduler.
// Exercises the real addon bundle in a clean browser without accounts or models.
import assert from "node:assert/strict";
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

const root = path.resolve("../../outputs/apps-local/renderer");
const receipt = JSON.parse(await readFile(path.resolve("../../outputs/apps-local/install.json"), "utf8"));
const host = path.resolve("../../outputs/apps-local", receipt.rendererStage);
const html = await readFile(path.join(host, "index.html"), "utf8");
const hostStyles = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="(\/agent\/assets\/[^"<>]+\.css)"[^>]*>/g)].map((match) => match[0]).join("");
assert(hostStyles, "Prepare the actual installed host styles before addon qualification.");
const server = http.createServer(async (request, response) => {
  try {
    if (["/apps-preview.js", "/apps-preview.css"].includes(request.url)) {
      response.setHeader("content-type", request.url.endsWith(".css") ? "text/css" : "text/javascript");
      response.end(await readFile(path.join(root, request.url.slice(1))));
    } else if (request.url.startsWith("/agent/assets/") && !request.url.includes("..")) {
      response.setHeader("content-type", request.url.endsWith(".css") ? "text/css" : "application/octet-stream");
      response.end(await readFile(path.join(host, request.url.slice("/agent/".length))));
    } else {
      response.setHeader("content-type", "text/html");
      response.end(`<html><head>${hostStyles}<link rel="stylesheet" href="/apps-preview.css"></head><body><aside data-testid="bots-sidebar"><div class="app-drag">Sidebar</div></aside><textarea aria-label="Draft">Keep this draft</textarea><script type="module" src="/apps-preview.js"></script></body></html>`);
    }
  } catch {
    response.statusCode = 500;
    response.end("Fixture asset unavailable");
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.rakazoDesktop = {
      appsStudio: { request: async () => ({ projects: [] }) },
    };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/agent/app/fixture`);
  await page.getByRole("button", { name: "Apps", exact: true }).click();
  await page.getByRole("button", { name: "Abrir estudio" }).waitFor();
  await page.getByRole("button", { name: "Cerrar Apps", exact: true }).click();
  assert.equal(await page.getByLabel("Draft", { exact: true }).inputValue(), "Keep this draft");
  assert.deepEqual(errors, []);
  console.log("Local addon: menu, catalog, close and draft preservation passed.");
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
