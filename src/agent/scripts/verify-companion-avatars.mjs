import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import { createServer } from "vite";

process.env.RAKAZO_PROJECT_LOCAL = "1";
const output = path.resolve(process.argv.find(arg => arg.startsWith("--output="))?.slice(9) ?? "build/companion-avatar-proof");
const root = path.resolve("apps/web");
await mkdir(output, { recursive: true });
process.chdir(root);
const server = await createServer({ root, configFile: path.join(root, "vite.config.ts"),
  base: "/agent/", cacheDir: path.join(root, "node_modules/.vite-companion-proof"), server: { host: "127.0.0.1", port: 0 } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch(existsSync(chromium.executablePath()) ? {} : { channel: "msedge" });
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  const page = await browser.newPage({ viewport: { width: 760, height: 260 } });
  const errors = [], requests = [], imageTypes = new Set();
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
  page.on("response", response => {
    if (/\.(png|webp)(?:\?|$)/.test(response.url())) imageTypes.add(response.headers()["content-type"]);
  });
  await page.goto(`${origin}/agent/e2e/fixtures/companion-avatars.html`);
  await expect(page.locator("main")).toHaveAttribute("data-ready", "true", { timeout: 60_000 });
  const avatars = await page.locator("img[data-avatar]").evaluateAll(async elements => Promise.all(elements.map(async img => {
    if (!img.getAttribute("src")?.startsWith("data:image/png")) return { valid: false };
    await img.decode();
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 64;
    const context = canvas.getContext("2d"); context.drawImage(img, 0, 0, 64, 64);
    const pixels = context.getImageData(0, 0, 64, 64).data;
    let painted = 0, colored = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] > 40) painted++;
      if (pixels[i + 3] > 40 && Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) - Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) > 20) colored++;
    }
    return { valid: true, painted, colored };
  })));
  assert.equal(avatars.length, 4);
  for (const avatar of avatars) { assert.equal(avatar.valid, true); assert.ok(avatar.painted > 500); assert.ok(avatar.colored > 100); }
  assert.ok(imageTypes.has("image/webp"));
  assert.deepEqual(errors, []);
  assert.ok(requests.every(request => new URL(request).origin === origin));
  await page.screenshot({ path: path.join(output, "avatars.png"), fullPage: true });
  const proof = { kind: "real-browser-avatar-rasterization", appBase: "/agent/", avatars, imageTypes: [...imageTypes], errors,
    limits: ["Synthetic avatar choices, no account or RPC writes", "Desktop image headers qualified separately", "Not a physical installed-window capture"] };
  await writeFile(path.join(output, "proof.json"), JSON.stringify(proof, null, 2));
  console.log(JSON.stringify(proof));
} finally { await browser?.close(); await server.close(); }
