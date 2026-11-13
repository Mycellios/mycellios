// Real signed browser workers + complete pinned model. Isolated PG, fictional
// grants/invoices and no supplier credentials or requests. Not physical-PC proof.
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes, generateKeyPairSync } from "node:crypto";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import postgres from "postgres";
import { MeshDatabase } from "../src/storage/database.js";
import { EconomicLedger } from "../src/economy/economic-ledger.js";
import { ContributionCreditWallet, contributionCreditSchemaSql } from "../src/economy/contribution-credit-wallet.js";
import { expiringPromotionSchemaSql } from "../src/economy/promotional-credits.js";
import { ManagedPurchases, managedPurchasesSchemaSql } from "../src/economy/managed-purchases.js";
import { browserInferenceCreditsSchemaSql } from "../src/economy/browser-inference-credits.js";
import { eventDemoSchemaSql } from "../src/economy/event-demo-schema.js";
import { WorkerAdmissionAuthority } from "../src/coordinator/worker-admission.js";
import { MobileComputeHub } from "../src/coordinator/mobile-compute-hub.js";
import { BrowserInference } from "../src/coordinator/browser-inference.js";
import { ManagedGateway } from "../src/coordinator/managed-gateway.js";
import { EventDemo } from "../src/coordinator/event-demo.js";
import { mountEventDemo } from "../src/coordinator/event-demo-routes.js";
import { ApiAccessManager } from "../src/coordinator/api-access.js";
import { browserTextModel } from "../src/contracts/browser-text.js";
import { eventDemoConfigSchema, eventDemoBudget } from "../src/core/event-demo-config.js";

const root = process.cwd(), url = process.env.MYCELLIOS_REFERRAL_TEST_POSTGRES_URL;
assert.ok(url, "Use only the explicitly supplied isolated PostgreSQL fixture");
const schema = "demo_browser_" + randomBytes(5).toString("hex"), sql = postgres(url, { max: 2, onnotice: () => {} });
const directory = mkdtempSync(join(tmpdir(), "mycellios-demo-model-")), output = resolve("event-demo-model-proof");
await mkdir(output, { recursive: true });
let db: MeshDatabase | undefined, admission: MeshDatabase | undefined, browser: any, vite: any, hub: MobileComputeHub | undefined;
const app = Fastify({ logger: false });
try {
  await sql.unsafe(`CREATE SCHEMA ${schema}`);
  const source = readFileSync(join(root, "src/storage/database.ts"), "utf8");
  for (const table of ["economic_contribution_evidence", "economic_accounts", "pricing_policies", "economic_settlements",
    "economic_ledger_entries", "economic_settlement_receipts", "node_ownership", "economic_node_reputation", "api_accounts", "api_keys", "api_usage"]) {
    const ddl = source.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\n      \\);`))?.[0]; assert.ok(ddl);
    await sql.unsafe(`SET search_path TO ${schema}; ` + ddl.replace(/\bINTEGER\b/g, "BIGINT"));
  }
  await sql.unsafe(`SET search_path TO ${schema}; CREATE TABLE schema_meta(version integer); INSERT INTO schema_meta VALUES(33);
    CREATE TABLE api_operator_funded_usage(usage_id text);` + contributionCreditSchemaSql + expiringPromotionSchemaSql
    + managedPurchasesSchemaSql + browserInferenceCreditsSchemaSql + eventDemoSchemaSql);
  db = await MeshDatabase.openPostgres(url, schema); admission = await MeshDatabase.open(":memory:");
  const wallet = new ContributionCreditWallet(db, new EconomicLedger(db, { receiptSigning: { keyId: "test-only",
    privateKey: generateKeyPairSync("ed25519").privateKey } }), true); await wallet.initialize();
  const api = new ApiAccessManager(db, { starterTokens: 0, requestsPerMinute: 100, maxConcurrent: 10, maxActiveKeys: 1 }, {}, true);
  await app.register(websocket);
  app.addContentTypeParser("application/octet-stream", { parseAs: "buffer" }, (_req, body, done) => done(null, body));
  hub = new MobileComputeHub({ admissionAuthority: new WorkerAdmissionAuthority(admission), expertArtifactsPath: join(directory, "artifacts") });
  hub.attach(app); await hub.textHub.enable(app, join(root, ".cache/browser-text-models"));
  const config = eventDemoConfigSchema.parse({ id: "test-only-event", title: "Isolated browser model qualification",
    startsAt: Date.now() - 1000, endsAt: Date.now() + 3_600_000, model: "mycellios/managed/antseed/deepseek-v4-flash",
    cookieSecret: randomBytes(32).toString("base64url"), presenterSecret: randomBytes(32).toString("base64url"),
    publicOrigin: "http://127.0.0.1:5198" });
  const inference = new BrowserInference(db, wallet, api, hub, [{ kind: "text", model: "mycellios-browser/gpt2-demo",
    artifactId: browserTextModel.files["model.onnx"].sha256, costMicrounitsPerToken: 1, maxOutputTokens: 8 }], 1_000_000, eventDemoBudget(config));
  await inference.initialize();
  let syntheticProviderCalls = 0;
  const purchases = new ManagedPurchases(db, wallet, 1_000_000, 10_000_000, eventDemoBudget(config)); await purchases.initialize();
  const gateway = new ManagedGateway(db, purchases, api, { provider: "fictional-test", ensureFresh: async () => {}, catalog: () => [],
    quote: () => ({ maximumUsd: "0.001", maximumMicrounits: 1040, expiresAt: Date.now() + 60_000, body: { max_tokens: 256 } }),
    execute: async () => { syntheticProviderCalls++; return { receiptId: "fictional-receipt", usd: "0.0001", inputTokens: 1, outputTokens: 1,
      response: { id: "fictional-response", model: config.model, choices: [{ index: 0, message: { role: "assistant", content: "Isolated chat works. No supplier was called." }, finish_reason: "stop" }] } }; },
  }, 100_000);
  const service = new EventDemo(config, db, wallet, api, gateway, inference, hub); await service.initialize(); mountEventDemo(app, service);
  await app.listen({ host: "127.0.0.1", port: 5197 });
  const { createServer } = await import("../src/agent/node_modules/vite/dist/node/index.js");
  const { chromium, expect } = await import("../src/agent/node_modules/@playwright/test/index.mjs");
  process.env.RAKAZO_PROJECT_LOCAL = "1"; process.env.MYCELLIOS_BROWSER_COORDINATOR = "http://127.0.0.1:5197";
  const webRoot = join(root, "src/agent/apps/web");
  process.chdir(webRoot); // Lingui resolves its own config from the workspace, as the deployed build does.
  vite = await createServer({ root: webRoot, configFile: join(webRoot, "vite.config.ts"),
    optimizeDeps: { entries: [join(webRoot, "e2e/fixtures/event-demo.tsx")] }, server: { host: "127.0.0.1", port: 5198, strictPort: true },
    plugins: [{ name: "isolated-real-demo", configureServer(server) { server.middlewares.use(async (req, res, next) => {
      if (!req.url?.startsWith("/__event_demo_real")) return next();
      const html = await server.transformIndexHtml(req.url, '<!doctype html><html lang="en" data-theme="light"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/e2e/fixtures/event-demo.tsx"></script></body></html>');
      res.setHeader("content-type", "text/html"); res.end(html);
    }); } }],
  }); await vite.listen();
  const executablePath = process.env.WORKSPACE_UI_CHROMIUM ?? (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);
  browser = await chromium.launch(executablePath ? { executablePath } : {});
  const first = await browser.newContext({ viewport: { width: 390, height: 844 } }), second = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const contributor = await first.newPage(), buyer = await second.newPage();
  const errors: string[] = []; contributor.on("pageerror", error => errors.push(error.message)); buyer.on("pageerror", error => errors.push(error.message));
  const entry = "http://127.0.0.1:5198/__event_demo_real";
  await contributor.goto(entry); await expect(contributor.getByRole("textbox", { name: "Message Mico", exact: true })).toBeEnabled();
  await contributor.getByRole("button", { name: "Start contribution", exact: true }).click();
  await expect(contributor.getByText("Your browser is available to the network.", { exact: true })).toBeVisible({ timeout: 60_000 });
  await buyer.goto(entry); await expect(buyer.getByRole("textbox", { name: "Message Mico", exact: true })).toBeEnabled();
  await buyer.getByRole("button", { name: "Start contribution", exact: true }).click();
  await expect(buyer.getByText("Your browser is available to the network.", { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => hub!.availableContributors("text").length, { timeout: 60_000 }).toBe(2);
  const before = await service.network(config.presenterSecret); assert.equal(before.connected, 2); assert.equal(before.inferences, 0);
  assert.equal(syntheticProviderCalls, 0);
  await buyer.getByText("Your browser in the network", { exact: true }).click();
  await buyer.getByRole("button", { name: /Test the network/ }).click();
  await expect(buyer.getByRole("button", { name: "Real inference completed", exact: true })).toBeVisible({ timeout: 120_000 });
  const after = await service.network(config.presenterSecret);
  assert.equal(after.inferences, 1); assert.ok(after.earnedMicrounits > 0);
  const rows = await db.raw.prepare(`SELECT p.account_id AS buyer,c.account_id AS contributor,p.total_microunits,
    p.fee_microunits,c.amount_microunits FROM economic_managed_purchases p JOIN economic_browser_inference_credits c ON c.usage_id=p.usage_id`).all();
  assert.equal(rows.length, 1); assert.notEqual(rows[0]!.buyer, rows[0]!.contributor);
  assert.equal(Number(rows[0]!.total_microunits), Number(rows[0]!.fee_microunits) + Number(rows[0]!.amount_microunits));
  await contributor.screenshot({ path: join(output, "real-contributor.png") }); await buyer.screenshot({ path: join(output, "real-buyer.png") });
  await buyer.getByRole("textbox", { name: "Message Mico", exact: true }).fill("Test-only private question");
  await buyer.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(buyer.getByText("Isolated chat works. No supplier was called.", { exact: true })).toBeVisible(); assert.equal(syntheticProviderCalls, 1);
  const present = await first.newPage(); await present.setViewportSize({ width: 1360, height: 900 });
  await present.goto(entry + "?present=1#view=" + config.presenterSecret);
  await expect(present.getByText("Verified inference", { exact: true })).toBeVisible();
  assert.equal(await present.getByText("Test-only private question", { exact: true }).count(), 0);
  await expect(present.getByRole("img", { name: "Scan to open Mycellios on your phone", exact: true })).toBeVisible();
  await present.screenshot({ path: join(output, "real-presenter.png") });
  await contributor.getByRole("button", { name: "Pause contribution", exact: true }).click();
  await buyer.getByRole("button", { name: "Pause contribution", exact: true }).click();
  await expect.poll(() => hub!.listWorkers().length, { timeout: 10_000 }).toBe(0);
  assert.deepEqual(errors, []);
  const proof = { verified: true, isolatedPostgres: true, fictionalCredits: true, supplierRequests: 0,
    realSignedBrowserWorkers: 2, realCompleteModel: browserTextModel.id, crossBrowserInference: true,
    fullIndependentTokenVerification: true, realLedgerDebitAndEarn: true, buyerAndContributorDifferent: true,
    normalManagedAccountingWithFictionalSupplier: true, pauseDisconnectedAll: true, physicalMultiPc: false,
    inferences: after.inferences, earnedMicrounits: after.earnedMicrounits };
  await writeFile(join(output, "qualification.json"), JSON.stringify(proof, null, 2)); console.log(JSON.stringify(proof));
} finally {
  await browser?.close(); await vite?.close(); hub?.close(); await app.close();
  await db?.close(); await admission?.close(); await sql.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await sql.end();
}
