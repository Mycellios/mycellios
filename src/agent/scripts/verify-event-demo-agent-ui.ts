// Actual SessionApp + API + PostgreSQL + job executor. Scripted model; zero suppliers.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { createServer as socketServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import EmbeddedPostgres from "embedded-postgres";
import { serve } from "@hono/node-server";
import { createServer } from "vite";
import { chromium, expect } from "@playwright/test";
import { sealEventAgentTicket } from "../../core/event-demo-agent-ticket.js";

process.env.RAKAZO_PROJECT_LOCAL = "1";
process.env.RAKAZO_ALLOW_DEV_SECRETS = "1";
process.env.CONTENT_ENCRYPTION = "off";
process.env.RAKAZO_LIVE_MODEL_CATALOG = "off";
process.env.AGENT_RUNTIME = "scripted";
process.env.SANDBOX_PROVIDER = "fake";
process.env.WAKEUP_DRIVER = "memory";
process.env.CLOUD_AGENT_PROVIDER = "emulator";
process.env.ANALYTICS_PROVIDER = "none";
process.env.LOG_LEVEL = "off";
const directory = await mkdtemp(path.join(tmpdir(), "event-agent-ui-"));
const output = path.resolve(process.argv.find(v => v.startsWith("--output="))?.slice(9) ?? "event-demo-proof");
await mkdir(output, { recursive: true });
const socket = socketServer(); await new Promise<void>(r => socket.listen(0, "127.0.0.1", r));
const port = (socket.address() as { port: number }).port; await new Promise<void>(r => socket.close(() => r()));
const password = randomBytes(24).toString("hex"), key = randomBytes(32).toString("hex");
await writeFile(path.join(directory, "bridge-key"), key);
process.env.MYCELLIOS_EVENT_DEMO_AGENT_SECRET_FILE = path.join(directory, "bridge-key");
const pg = new EmbeddedPostgres({ databaseDir: path.join(directory, "pg"), port, user: "postgres", password,
  persistent: true, initdbFlags: ["--encoding=UTF8", "--locale=C"], autoRehydrateSymlinks: true, onLog: () => {}, onError: () => {} });
let handles: Awaited<ReturnType<typeof import("../apps/api/src/app.js").createApp>> | undefined;
let http: ReturnType<typeof serve> | undefined, vite: Awaited<ReturnType<typeof createServer>> | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const diagnostics: unknown[] = [];
try {
  await pg.initialise(); await pg.start();
  process.env.DATABASE_URL = `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`;
  process.env.DATABASE_MIGRATION_URL = process.env.DATABASE_URL;
  await promisify(execFile)(process.execPath, [path.resolve("node_modules/prisma/build/index.js"), "db", "push", "--config", "packages/db/prisma.config.ts"],
    { env: process.env, maxBuffer: 1024 * 1024 });
  const origin = "http://127.0.0.1:5196", event = "test-only-event", model = "mycellios/managed/antseed/deepseek-v4-flash";
  const { createApp } = await import("../apps/api/src/app.js");
  const modelReads: string[] = [];
  handles = await createApp({ dataDir: directory, webOrigin: origin, authUrl: origin + "/api/auth",
    agentRuntime: "scripted", wakeupDriver: "memory", sandboxProvider: "fake", signupsEnabled: "false",
    modelConnectionFetch: async (input, init) => {
      const req = new Request(input, init); modelReads.push(req.method + " " + new URL(req.url).pathname);
      assert.equal(req.method, "GET", "No supplier or paid POST is allowed in this fixture");
      if (req.url.endsWith("/account/economy")) return Response.json({ object: "economic_account", asset: "MYC_MICROCREDITS",
        balanceMicrounits: 200000, availableMicrounits: 200000, lifetimeMicrounits: 0, settledJobs: 0,
        promotionalGrantedMicrounits: 200000, contributionFundingSupported: true, environment: "sandbox" });
      if (req.url.endsWith("/models")) return Response.json({ data: [{ id: model, name: "DeepSeek V4 Flash", modality: "text", processing: "external",
        context_length: 32768, max_output_tokens: 1024, recommended: true,
        pricing: { currency: "credits", unit: "token", input: "0.000001", output: "0.000001", serviceFeeBasisPoints: 400 } }] });
      throw new Error("Unexpected fixture transport: " + new URL(req.url).pathname);
    },
  });
  http = serve({ fetch: handles.app.fetch, port: 0, hostname: "127.0.0.1" });
  await new Promise<void>(r => http!.listening ? r() : http!.once("listening", r));
  process.env.API_PROXY_TARGET = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
  const root = path.resolve("apps/web");
  process.chdir(root);
  vite = await createServer({ root, configFile: path.join(root, "vite.config.ts"), server: { host: "127.0.0.1", port: 5196, strictPort: true } });
  await vite.listen();
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const errors: string[] = [], rpcFailures: unknown[] = [];
  const page = await context.newPage();
  page.on("pageerror", e => errors.push(e.message));
  page.on("response", r => { if (r.url().includes("/rpc/") && r.status() >= 400) rpcFailures.push({ path: new URL(r.url()).pathname, status: r.status() }); });
  await context.addInitScript(() => { localStorage.setItem("rakazo.uiLocale", "en"); localStorage.setItem("mycellios.uiLocaleConfirmed", "en"); });
  const guest = randomUUID(), endsAt = Date.now() + 3600_000;
  // Only the native admission authority is a fixture here; Agent auth/RPC/database/UI are real.
  await context.route("**/mobile/v1/demo/test-only-event/**", route => {
    const suffix = new URL(route.request().url()).pathname.split(event)[1];
    if (suffix === "/session") return route.fulfill({ json: { open: true, endsAt, creditsMicrounits: 200000, guest: { number: 1, name: "Invitado 01" } } });
    if (suffix === "/agent-ticket") return route.fulfill({ json: { ticket: sealEventAgentTicket(key, {
      event, guest, accountId: `demo:${event}:${guest}`, origin, issuedAt: Date.now(), endsAt, name: "Invitado 01", model,
      apiKey: "myc_live_abcdefghij_" + "a".repeat(43),
    }) } });
    throw new Error("Unexpected native fixture route: " + suffix);
  });
  await page.goto(origin + "/demo/" + event);
  await expect(page).toHaveURL(/\/app\/[^/]+$/, { timeout: 60_000 });
  const composer = page.getByRole("combobox", { name: "Message Mico", exact: true });
  await expect(composer).toBeVisible({ timeout: 60_000 });
  await expect(composer).toBeEnabled();
  await expect(page.getByTestId("mycellios-micos")).toHaveAttribute("data-balance-status", "ready");
  await expect(page.getByTestId("mycellios-micos")).toContainText("0.2");
  assert.equal(await page.getByText("Your own Mico. No registration.", { exact: true }).count(), 0);
  const token = await page.evaluate(() => JSON.parse(sessionStorage.getItem("mycellios:event-agent-tab")!));
  assert.equal(token.id, event);
  assert.ok((await context.cookies()).some(c => c.name.includes("mycellios-agent-demo") && c.httpOnly));
  await page.screenshot({ path: path.join(output, "normal-agent-desktop.png") });
  await composer.fill("quote markdown fixture demo-normal");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText("list-a", { exact: true })).toBeVisible({ timeout: 60_000 });
  await page.reload(); await expect(page.getByText("list-a", { exact: true })).toBeVisible({ timeout: 60_000 });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: path.join(output, "normal-agent-mobile.png") });
  assert.deepEqual(errors, []);
  const proof = { realAgentPanel: true, realAgentApi: true, realDatabase: true, realJobExecutor: true,
    normalThreadPersistence: true, temporaryCookie: true, registrationRequired: false, nativeAdmission: "separately qualified",
    model: "scripted fixture", supplierSpend: false, modelReads, rpcFailures };
  await writeFile(path.join(output, "qualification.json"), JSON.stringify(proof, null, 2));
  console.log(JSON.stringify(proof));
} catch (error) {
  const page = browser?.contexts()[0]?.pages()[0];
  if (page) { await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
    diagnostics.push({ url: page.url(), text: (await page.locator("body").innerText()).slice(0, 10000) }); }
  diagnostics.push({ error: String(error) }); throw error;
}
finally {
  await writeFile(path.join(output, "diagnostics.json"), JSON.stringify(diagnostics, null, 2));
  await browser?.close(); await vite?.close();
  http?.closeAllConnections();
  await new Promise<void>(r => http ? http.close(() => r()) : r());
  await handles?.stop(); await pg.stop();
}
