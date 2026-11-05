import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";
import { createServer } from "vite";
import { AppsStudioRuntime } from "../apps/desktop/src/apps-studio-runtime.ts";

// Synthetic owner and a fresh private directory. Never uses a production account or database.
const output = await mkdtemp(path.join(os.tmpdir(), "mycellios-apps-acceptance-"));
const runtime = new AppsStudioRuntime(path.join(output, "projects"));
const scope = { owner: "fixture", space: "fixture", server: "https://fixture.invalid" };
const root = path.resolve("apps/web");
const fontPackage = await realpath("node_modules/@fontsource-variable/geist");
process.env.RAKAZO_PROJECT_LOCAL = "1";
process.chdir(root);
const server = await createServer({
  root,
  configFile: path.join(root, "vite.config.ts"),
  server: { host: "127.0.0.1", port: 0, fs: { allow: [path.resolve(root, "../.."), fontPackage] } },
  plugins: [
    {
      name: "isolated-apps-acceptance",
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (req.url !== "/__apps_fixture") return next();
          const html = await server.transformIndexHtml(
            req.url,
            '<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/e2e/fixtures/apps-preview.tsx"></script></body></html>',
          );
          res.setHeader("content-type", "text/html");
          res.end(html);
        });
      },
    },
  ],
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch(
    existsSync(chromium.executablePath()) ? {} : { channel: "msedge" },
  );
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.setDefaultTimeout(60_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.exposeFunction("studioFixture", (input) => runtime.request(scope, input));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__apps_fixture`);
  await page.getByRole("button", { name: "Abrir estudio", exact: true }).click();
  assert((await page.getByRole("dialog").boundingBox()).width >= 900, "The desktop studio must not inherit the small default modal width");
  await page.getByLabel("Tema del vídeo").fill("Hábitos sencillos para ahorrar agua en casa");
  await page.getByRole("button", { name: "Crear proyecto", exact: true }).click();
  if (process.argv.includes("--codex")) {
    await page.getByRole("button", { name: "Generar guion", exact: true }).click();
    await page
      .getByLabel("Título", { exact: true })
      .first()
      .waitFor({ timeout: 8 * 60_000 });
  } else {
    await page.getByRole("button", { name: "Escribir guion", exact: true }).click();
    for (let i = 0; i < 6; i++) {
      await page
        .getByLabel("Título", { exact: true })
        .nth(i)
        .fill(`Ahorra agua · ${i + 1}`);
      await page
        .getByLabel("Narración", { exact: true })
        .nth(i)
        .fill(
          "Cierra el grifo cuando no lo necesites. Un hábito sencillo ayuda a evitar el desperdicio diario.",
        );
    }
    await page.getByRole("button", { name: "Guardar guion", exact: true }).click();
  }
  await page.getByRole("button", { name: "Preparar voz e imágenes", exact: true }).click();
  await page
    .getByRole("button", { name: "He revisado la voz y las seis imágenes", exact: true })
    .waitFor();
  assert.equal(await page.locator("audio").count(), 6);
  await page
    .locator("audio")
    .first()
    .evaluate(
      (audio) =>
        new Promise((resolve, reject) => {
          if (audio.readyState >= 1) return resolve(true);
          audio.onloadedmetadata = () => resolve(true);
          audio.onerror = () => reject(new Error("Audio decode failed"));
        }),
    );
  assert(
    await page
      .locator("audio")
      .first()
      .evaluate((audio) => audio.duration > 0),
  );
  await page.screenshot({ path: path.join(output, "desktop-review.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: path.join(output, "mobile-review.png"), fullPage: true });
  await page.setViewportSize({ width: 1200, height: 900 });
  // Synthetic acceptance, not a recorded human artistic/commercial approval.
  await page
    .getByRole("button", { name: "He revisado la voz y las seis imágenes", exact: true })
    .click();
  await page.getByRole("button", { name: "Crear vídeo", exact: true }).click();
  await page
    .getByRole("heading", { name: "Vídeo listo", exact: true })
    .waitFor({ timeout: 8 * 60_000 });
  await page.locator("video").evaluate(
    (video) =>
      new Promise((resolve, reject) => {
        if (video.readyState >= 1) return resolve(true);
        video.onloadedmetadata = () => resolve(true);
        video.onerror = () => reject(new Error("Video decode failed"));
      }),
  );
  assert(
    await page
      .locator("video")
      .evaluate(
        (video) => video.duration > 1 && video.videoWidth === 720 && video.videoHeight === 1280,
      ),
  );
  assert.equal(await page.getByRole("link", { name: "Descargar MP4" }).count(), 1);
  await page.screenshot({ path: path.join(output, "video-ready.png"), fullPage: true });
  await page.reload();
  await page.getByRole("button", { name: "Abrir estudio", exact: true }).click();
  await page.getByRole("button", { name: /Hábitos sencillos/ }).click();
  await page.getByRole("button", { name: "Abrir vídeo guardado" }).click();
  await page.getByRole("link", { name: "Descargar MP4" }).waitFor();
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(output, "result.json"),
    JSON.stringify(
      {
        passed: true,
        actualVoice: true,
        actualFfmpeg: true,
        actualCodex: process.argv.includes("--codex"),
        persistence: true,
        mobileWidth: 390,
        humanApproval: false,
        projects: await runtime.request(scope, { action: "list" }),
      },
      null,
      2,
    ),
  );
  console.log(`Apps acceptance passed. Evidence: ${output}`);
} finally {
  await browser?.close();
  await server.close();
}
