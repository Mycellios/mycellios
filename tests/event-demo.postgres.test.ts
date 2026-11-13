import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";
import Fastify from "fastify";
import { MeshDatabase } from "../src/storage/database.js";
import { EconomicLedger } from "../src/economy/economic-ledger.js";
import { ContributionCreditWallet, contributionCreditSchemaSql } from "../src/economy/contribution-credit-wallet.js";
import { expiringPromotionSchemaSql } from "../src/economy/promotional-credits.js";
import { managedPurchasesSchemaSql, ManagedPurchases } from "../src/economy/managed-purchases.js";
import { browserInferenceCreditsSchemaSql } from "../src/economy/browser-inference-credits.js";
import { eventDemoSchemaSql, eventDemoAccessSql } from "../src/economy/event-demo-schema.js";
import { ApiAccessManager } from "../src/coordinator/api-access.js";
import { ManagedGateway } from "../src/coordinator/managed-gateway.js";
import { EventDemo } from "../src/coordinator/event-demo.js";
import { mountEventDemo } from "../src/coordinator/event-demo-routes.js";
import { eventDemoConfigSchema } from "../src/core/event-demo-config.js";
import type { MobileComputeHub } from "../src/coordinator/mobile-compute-hub.js";
import type { BrowserInference } from "../src/coordinator/browser-inference.js";

const url = process.env.MYCELLIOS_REFERRAL_TEST_POSTGRES_URL;
describe.skipIf(!url)("bounded event guests on isolated PostgreSQL, no supplier charges", () => {
  const schema = "demo_test_" + randomBytes(5).toString("hex"), role = schema + "_native";
  const sql = postgres(url!, { max: 2, onnotice: () => {} });
  let db: MeshDatabase, wallet: ContributionCreditWallet, api: ApiAccessManager, service: EventDemo;
  let now: number;
  const config = () => eventDemoConfigSchema.parse({ id: "test-only-event", title: "Test only", startsAt: now - 1000,
    endsAt: now + 3_600_000, model: "mycellios/managed/antseed/deepseek-v4-flash", cookieSecret: "a".repeat(43),
    presenterSecret: "b".repeat(43), publicOrigin: "https://demo.invalid" });
  const provider = { provider: "fictional-test", ensureFresh: vi.fn(async () => {}), catalog: () => [],
    quote: vi.fn(() => ({ maximumUsd: "0.001", maximumMicrounits: 1041, expiresAt: Date.now() + 60_000,
      body: { max_tokens: 256 }, fundingCostBasisPoints: 2 })),
    execute: vi.fn(async () => ({ receiptId: "test-receipt-" + randomUUID(), usd: "0.0001", inputTokens: 10,
      outputTokens: 5, response: { id: "test-only", model: config().model,
        choices: [{ index: 0, message: { role: "assistant", content: "Test only response" }, finish_reason: "stop" }] } })),
  };
  const browser = { models: () => [{ kind: "text", model: "mycellios-browser/test-only" }],
    bind: vi.fn(async () => ({ linked: true })), quote: vi.fn(() => ({ creditsMicrounits: 20, token: "fictional-quote" })),
    execute: vi.fn(async () => ({ status: "completed" })), unbind: vi.fn() };
  const hub = { listWorkers: vi.fn(() => []), isFundedInferenceActive: vi.fn(() => false) };
  beforeAll(async () => {
    await sql.unsafe(`CREATE SCHEMA ${schema}`);
    const source = readFileSync(new URL("../src/storage/database.ts", import.meta.url), "utf8");
    for (const table of ["economic_contribution_evidence", "economic_accounts", "pricing_policies", "economic_settlements",
      "economic_ledger_entries", "economic_settlement_receipts", "node_ownership", "economic_node_reputation", "api_accounts", "api_keys", "api_usage"]) {
      const ddl = source.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\n      \\);`))?.[0];
      if (!ddl) throw new Error("Missing canonical DDL: " + table);
      await sql.unsafe(`SET search_path TO ${schema}; ` + ddl.replace(/\bINTEGER\b/g, "BIGINT"));
    }
    await sql.unsafe(`SET search_path TO ${schema}; CREATE TABLE schema_meta(version integer); INSERT INTO schema_meta VALUES(33);
      CREATE TABLE api_operator_funded_usage(usage_id text);` + contributionCreditSchemaSql + expiringPromotionSchemaSql
      + managedPurchasesSchemaSql + browserInferenceCreditsSchemaSql + eventDemoSchemaSql);
    await sql.unsafe(`CREATE ROLE ${role} NOLOGIN; CREATE ROLE ${role}_guest NOLOGIN;
      GRANT USAGE ON SCHEMA ${schema} TO ${role},${role}_guest; SET search_path TO ${schema}; ` + eventDemoAccessSql(role));
    db = await MeshDatabase.openPostgres(url!, schema);
    wallet = new ContributionCreditWallet(db, new EconomicLedger(db, { receiptSigning: {
      keyId: "test-only", privateKey: generateKeyPairSync("ed25519").privateKey } }), true);
    await wallet.initialize();
    api = new ApiAccessManager(db, { starterTokens: 0, requestsPerMinute: 100, maxConcurrent: 10, maxActiveKeys: 1 }, {}, true);
  });
  beforeEach(async () => {
    await db.raw.exec(`TRUNCATE economic_demo_guests,economic_demo_campaigns,economic_browser_inference_credits,
      economic_browser_contributors,economic_managed_purchases,economic_promotion_allocations,economic_credit_replays,
      economic_credit_transfers,api_contribution_funded_usage,economic_credit_holds,economic_promotional_grants,api_keys,
      api_usage,api_accounts,economic_settlement_receipts,economic_ledger_entries,economic_settlements,
      economic_contribution_evidence,economic_accounts CASCADE`);
    vi.clearAllMocks(); now = Date.now();
    const purchases = new ManagedPurchases(db, wallet, 10_000_000); await purchases.initialize();
    const gateway = new ManagedGateway(db, purchases, api, provider, 200_000);
    service = new EventDemo(config(), db, wallet, api, gateway, browser as unknown as BrowserInference,
      hub as unknown as MobileComputeHub, () => now);
    await service.initialize();
  });
  afterAll(async () => { await db?.close(); await sql.unsafe(`DROP SCHEMA ${schema} CASCADE; DROP ROLE ${role}; DROP ROLE ${role}_guest`); await sql.end(); });
  const enter = (nonce = randomBytes(32).toString("base64url")) => service.enter(nonce, "mobile");
  const chat = () => ({ key: randomUUID(), messages: [{ role: "user", content: "Una pregunta de prueba" }] });
  it("admits exactly the first 50 concurrent browser identities and conserves the 10 Credit grant ceiling", async () => {
    const results = await Promise.allSettled(Array.from({ length: 65 }, () => enter()));
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(50);
    expect(results.filter(r => r.status === "rejected").every(r => (r as PromiseRejectedResult).reason.message === "demo_full")).toBe(true);
    expect(await db.raw.prepare("SELECT COUNT(*) AS count,SUM(amount_microunits) AS total FROM economic_promotional_grants").get())
      .toEqual({ count: 50, total: 10_000_000 });
    expect((await api.listKeys((results.find(r => r.status === "fulfilled") as PromiseFulfilledResult<Awaited<ReturnType<typeof enter>>>).value.guest.accountId))).toHaveLength(0);
    expect((await service.metadata()).full).toBe(true); expect(provider.execute).not.toHaveBeenCalled();
  });
  it("replays simultaneous enrollment and a lost cookie as one identity, grant and scoped session", async () => {
    const nonce = randomBytes(32).toString("base64url");
    const results = await Promise.all(Array.from({ length: 20 }, () => enter(nonce)));
    expect(new Set(results.map(r => r.token)).size).toBe(1);
    expect((await service.metadata()).joined).toBe(1);
    expect(await service.session(await service.authenticate(results[0]!.token))).toMatchObject({ creditsMicrounits: 200_000, earnedMicrounits: 0 });
    await expect(service.authenticate(config().presenterSecret)).rejects.toThrow("demo_session_required");
    await expect(service.authenticate(results[0]!.token + "x")).rejects.toThrow("demo_session_required");
  });
  it("reserves the conservative maximum, charges the actual full cost +4% once and preserves the response", async () => {
    const { guest } = await enter(); const input = chat();
    provider.execute.mockImplementationOnce(async () => {
      expect((await wallet.summary("account", guest.accountId)).reservedMicrounits).toBe(1041);
      return { receiptId: "test-only-actual-cost", usd: "0.0001", inputTokens: 10, outputTokens: 5,
        response: { id: "test-only", model: config().model, choices: [{ index: 0, message: { role: "assistant", content: "Test only response" }, finish_reason: "stop" }] } };
    });
    const result = await service.chat(guest, input);
    expect(result).toMatchObject({ status: "completed", response: { mycellios: { creditsMicrounits: 105, serviceFeeMicrounits: 4, fundingCostMicrounits: 1 } } });
    expect(await service.session(guest)).toMatchObject({ creditsMicrounits: 199895, reservedMicrounits: 0 });
    expect(await service.chat(guest, input)).toEqual(result); expect(await service.recover(guest, input.key)).toEqual(result);
    expect(provider.execute).toHaveBeenCalledOnce();
    await expect(service.chat(guest, { ...input, messages: [{ role: "user", content: "Changed" }] })).rejects.toThrow("idempotency_conflict");
  });
  it("never reissues a supplier call or invents a refund when the result or charge is uncertain", async () => {
    const { guest } = await enter(), input = chat(); provider.execute.mockRejectedValueOnce(new Error("fictional timeout"));
    expect(await service.chat(guest, input)).toMatchObject({ status: "pending_reconciliation" });
    expect(await service.chat(guest, input)).toMatchObject({ status: "pending_reconciliation" });
    expect((await service.session(guest)).reservedMicrounits).toBe(1041);
    expect(provider.execute).toHaveBeenCalledOnce();
  });
  it("expires guest admission and new work without changing the normal verified-account welcome gate", async () => {
    const { guest } = await enter(); now = config().endsAt + 1;
    await expect(enter()).rejects.toThrow("demo_closed"); await expect(service.chat(guest, chat())).rejects.toThrow("demo_closed");
    expect((await service.session(guest)).creditsMicrounits).toBe(0);
    expect(provider.execute).not.toHaveBeenCalled();
    expect(await db.raw.prepare("SELECT COUNT(*) AS count FROM economic_promotional_grants WHERE issued_by='welcome-v1'").get()).toEqual({ count: 0 });
  });
  it("keeps the presenter read capability separate, private and free of prompts, accounts and proofs", async () => {
    const { guest, token } = await enter();
    await expect(service.network(token)).rejects.toThrow("demo_view_required");
    const view = await service.network(config().presenterSecret);
    expect(view.devices).toEqual([{ number: 1, kind: "mobile", present: true, connected: false, working: false, earnedMicrounits: 0, inferences: 0 }]);
    expect(JSON.stringify(view)).not.toContain(guest.accountId); expect(JSON.stringify(view)).not.toContain(token);
  });
  it("binds only the cookie-owned guest and keeps pause resumable without permanent worker revocation", async () => {
    const { guest } = await enter(), worker = randomUUID();
    await service.link(guest, worker, "w".repeat(43));
    expect(browser.bind).toHaveBeenCalledWith(guest.accountId, worker, "w".repeat(43));
    await service.unlink({ ...guest, workerId: worker }); expect(browser.unbind).not.toHaveBeenCalled();
    await service.link(guest, worker, "w".repeat(43)); expect(browser.bind).toHaveBeenCalledTimes(2);
  });
  it("has no paid GET or automatic browser task: quotes do not invoke inference", async () => {
    const { guest } = await enter(); service.networkQuote(guest);
    expect(browser.execute).not.toHaveBeenCalled(); expect(provider.execute).not.toHaveBeenCalled();
    await expect(service.networkTest(guest, randomUUID(), 1)).rejects.toThrow("demo_request_too_large");
    expect(browser.execute).not.toHaveBeenCalled();
  });
  it("keeps the event lifetime budget separate from ordinary daily limits and preserves the global funded ceiling", async () => {
    const first = await enter(), second = await enter();
    await api.getOrCreateAccount("ordinary-test-user");
    await db.raw.prepare(`INSERT INTO economic_promotional_grants
      (id,account_id,issued_by,reason,amount_microunits,created_at,expires_at) VALUES ('ordinary-test','ordinary-test-user','test','fictional',200000,?,?)`)
      .run(now, now + 3_600_000);
    const policy = { campaignId: config().id, maximumMicrounits: 2000, startsAt: config().startsAt, endsAt: config().endsAt };
    const purchases = new ManagedPurchases(db, wallet, 1000, 10_000, policy); await purchases.initialize();
    const reserve = (accountId: string, maximumUsd: string, manager = purchases) => db.transaction(async () => {
      const usage = await api.beginUsage(accountId, null, { model: config().model, messages: [] }, true);
      return manager.reserve({ usageId: usage.id, accountId, key: randomUUID(), digest: "test-digest", provider: "fictional-test", model: config().model, maximumUsd });
    });
    await reserve(first.guest.accountId, "0.001"); // 1040: above normal daily limit, inside the separate event budget.
    await expect(reserve(second.guest.accountId, "0.001")).rejects.toThrow("managed_operator_budget_exceeded");
    await reserve("ordinary-test-user", "0.0005"); // 520: event work does not consume ordinary daily allowance.
    await expect(reserve("ordinary-test-user", "0.0005")).rejects.toThrow("managed_operator_budget_exceeded");
    const capped = new ManagedPurchases(db, wallet, 1000, 1600, policy); await capped.initialize();
    await expect(reserve(second.guest.accountId, "0.0001", capped)).rejects.toThrow("managed_operator_budget_exceeded");
    expect((await service.session(first.guest)).reservedMicrounits).toBe(1040);
    expect((await service.session(second.guest)).reservedMicrounits).toBe(0);
  });
  it("rejects mutated campaign budgets rather than changing grants on a restart", async () => {
    const replacement = new EventDemo({ ...config(), maxGuests: 49 }, db, wallet, api, {} as never, undefined, hub as unknown as MobileComputeHub);
    await expect(replacement.initialize()).rejects.toThrow("demo_campaign_configuration_changed");
  });
  it("denies untrusted database roles and exposes event records only through the private native policy", async () => {
    await enter();
    await expect(sql.begin(async tx => {
      await tx.unsafe(`SET LOCAL ROLE ${role}_guest; SET LOCAL search_path TO ${schema}`);
      return tx.unsafe("SELECT * FROM economic_demo_guests");
    })).rejects.toThrow(/permission denied/);
    const rows = await sql.begin(async tx => {
      await tx.unsafe(`SET LOCAL ROLE ${role}; SET LOCAL search_path TO ${schema}`);
      return tx.unsafe("SELECT ordinal FROM economic_demo_guests");
    });
    expect(rows).toMatchObject([{ ordinal: 1 }]);
  });
  it("enforces cookie scope, Origin, guest/model isolation, bounded bodies and presenter authorization over HTTP", async () => {
    const app = Fastify(); mountEventDemo(app, service); const base = "/mobile/v1/demo/" + config().id;
    const payload = { nonce: randomBytes(32).toString("base64url") };
    try {
      expect((await app.inject({ method: "POST", url: base + "/enter", payload })).statusCode).toBe(403);
      const joined = await app.inject({ method: "POST", url: base + "/enter", headers: { origin: config().publicOrigin }, payload });
      expect(joined.statusCode).toBe(200);
      const cookie = String(joined.headers["set-cookie"]); expect(cookie).toContain("HttpOnly; SameSite=Strict"); expect(cookie).toContain("; Secure"); expect(cookie).toContain("Path=" + base + ";");
      const headers = { origin: config().publicOrigin, cookie: cookie.split(";")[0]! };
      expect((await app.inject({ method: "GET", url: base + "/session", headers })).json()).toMatchObject({ creditsMicrounits: 200000 });
      expect((await app.inject({ method: "GET", url: base + "/session" })).statusCode).toBe(401);
      expect((await app.inject({ method: "POST", url: base + "/chat", headers, payload: { ...chat(), model: "unauthorized" } })).statusCode).not.toBe(200);
      expect((await app.inject({ method: "POST", url: base + "/chat", headers, payload: { ...chat(), accountId: "victim" } })).statusCode).not.toBe(200);
      expect((await app.inject({ method: "POST", url: base + "/chat", headers, payload: { key: randomUUID(), messages: [{ role: "user", content: "x".repeat(33000) }] } })).statusCode).toBe(413);
      expect((await app.inject({ method: "GET", url: base + "/network", headers })).statusCode).toBe(401);
      expect((await app.inject({ method: "GET", url: base + "/network", headers: { authorization: "DemoView " + config().presenterSecret } })).statusCode).toBe(200);
      expect(provider.execute).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
});
