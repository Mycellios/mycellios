import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { generateKeyPairSync } from "node:crypto";
import postgres from "postgres";
import { MeshDatabase } from "../src/storage/database.js";
import { EconomicLedger } from "../src/economy/economic-ledger.js";
import { ContributionCreditWallet, contributionCreditSchemaSql } from "../src/economy/contribution-credit-wallet.js";
import { expiringPromotionSchemaSql } from "../src/economy/promotional-credits.js";
import { managedPurchasesSchemaSql } from "../src/economy/managed-purchases.js";
import { browserInferenceCreditsSchemaSql, browserInferenceCreditsAccessSql } from "../src/economy/browser-inference-credits.js";
import { BrowserInference } from "../src/coordinator/browser-inference.js";
import { ApiAccessManager } from "../src/coordinator/api-access.js";
import type { MobileComputeHub } from "../src/coordinator/mobile-compute-hub.js";
import { mountBrowserInference } from "../src/coordinator/browser-inference-routes.js";
import Fastify from "fastify";
import { browserTextModel } from "../src/contracts/browser-text.js";

// Separate PostgreSQL schema, fictional balances and local compute doubles. No provider/network charges.
const url = process.env.MYCELLIOS_REFERRAL_TEST_POSTGRES_URL;
describe.skipIf(!url)("browser inference credits on isolated PostgreSQL", () => {
  const schema = "browser_test_" + Math.random().toString(36).slice(2), role = schema + "_native";
  const sql = postgres(url!, { max: 2, onnotice: () => {} });
  let db: MeshDatabase, wallet: ContributionCreditWallet, api: ApiAccessManager, service: BrowserInference;
  const identity = { workerId: "32cb4b44-cd2e-45d5-966e-b876f4c4dba0", browserId: "signed-browser", fingerprint: "sha256:" + "a".repeat(64) };
  const output = Buffer.from(new Float32Array([0.125]).buffer).toString("base64");
  const hub = { contributorIdentity: vi.fn(), availableContributors: vi.fn(), executeFundedExpert: vi.fn(), notifyInferenceSettled: vi.fn(),
    textHub: { inputTokens: vi.fn(), execute: vi.fn() } };
  const offer = { model: "mycellios-browser/test-expert", artifactId: "b".repeat(64), costMicrounitsPerRow: 1000, maxRows: 16 };
  const request = { model: offer.model, rows: 1, hiddenSize: 1, activationsBase64: output };
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
      + managedPurchasesSchemaSql + browserInferenceCreditsSchemaSql);
    await sql.unsafe(`CREATE ROLE ${role} NOLOGIN; SET search_path TO ${schema}; ` + browserInferenceCreditsAccessSql(role));
    db = await MeshDatabase.openPostgres(url!, schema);
    const ledger = new EconomicLedger(db, { receiptSigning: { keyId: "browser-test", privateKey: generateKeyPairSync("ed25519").privateKey } });
    wallet = new ContributionCreditWallet(db, ledger, true); await wallet.initialize();
    api = new ApiAccessManager(db, { starterTokens: 0, requestsPerMinute: 100, maxConcurrent: 10, maxActiveKeys: 2 }, {}, true);
    service = new BrowserInference(db, wallet, api, hub as unknown as MobileComputeHub, [offer], 1_000_000);
    await service.initialize();
  });
  beforeEach(async () => {
    await db.raw.exec(`TRUNCATE economic_browser_inference_credits,economic_browser_contributors,
      economic_managed_purchases,economic_promotion_allocations,economic_credit_replays,economic_credit_transfers,
      api_contribution_funded_usage,economic_credit_holds,economic_promotional_grants,api_usage,api_accounts,
      economic_settlement_receipts,economic_ledger_entries,economic_settlements,economic_contribution_evidence,economic_accounts CASCADE`);
    await api.getOrCreateAccount("buyer"); await api.getOrCreateAccount("contributor");
    await db.raw.prepare(`INSERT INTO economic_promotional_grants
      (id,account_id,issued_by,reason,amount_microunits,created_at,expires_at) VALUES ('test-only','buyer','test','fictional',200000,?,?)`)
      .run(Date.now(), Date.now() + 600000);
    vi.clearAllMocks();
    hub.contributorIdentity.mockImplementation((id, token) => id === identity.workerId && token === "worker-proof" ? identity : null);
    hub.availableContributors.mockReturnValue([identity]);
    hub.executeFundedExpert.mockResolvedValue({ outputBase64: output, evidenceDigest: "sha256:" + "c".repeat(64) });
    hub.textHub.inputTokens.mockReturnValue(5);
    hub.textHub.execute.mockResolvedValue({ result: { text: "Result", inputTokens: 5, tokenIds: [123,50256], finishReason: "stop" }, evidenceDigest: "sha256:" + "d".repeat(64) });
    await service.bind("contributor", identity.workerId, "worker-proof");
  });
  afterAll(async () => { await db?.close(); await sql.unsafe(`DROP SCHEMA ${schema} CASCADE; DROP ROLE ${role}`); await sql.end(); });
  const execute = (key = "test-inference-01") => service.execute("buyer", null, key, request, service.quote("buyer", request).token);
  async function textService() {
    const value = new BrowserInference(db,wallet,api,hub as unknown as MobileComputeHub,[{
      kind:"text",model:"mycellios-browser/gpt2",artifactId:browserTextModel.files["model.onnx"].sha256,costMicrounitsPerToken:50,maxOutputTokens:32,
    }],1000000); await value.initialize(); return value;
  }
  const textRequest = {kind:"text",model:"mycellios-browser/gpt2",prompt:"Complete this text",maxTokens:8};
  it("reserves the full text budget and settles only independently verified actual token counts +4%",async()=>{
    const value=await textService();const quote=value.quote("buyer",textRequest);
    expect(quote.creditsMicrounits).toBe(676);
    hub.textHub.execute.mockImplementationOnce(async()=>{
      expect((await wallet.summary("account","buyer")).reservedMicrounits).toBe(676);
      return {result:{text:"Result",inputTokens:5,tokenIds:[123,50256],finishReason:"stop"},evidenceDigest:"sha256:"+"d".repeat(64)};
    });
    const result=await value.execute("buyer",null,"full-text-budget",textRequest,quote.token);
    expect(result).toMatchObject({status:"completed",creditsMicrounits:364,serviceFeeMicrounits:14,
      response:{choices:[{message:{role:"assistant",content:"Result"}}],usage:{prompt_tokens:5,completion_tokens:2,total_tokens:7}}});
    expect(await wallet.summary("account","buyer")).toMatchObject({availableMicrounits:199636,reservedMicrounits:0});
    expect(await wallet.summary("account","contributor")).toMatchObject({availableMicrounits:350,contributionEarnedMicrounits:350});
    await expect(value.execute("buyer",null,"full-text-budget",textRequest,quote.token)).resolves.toEqual(result);
    expect(hub.textHub.execute).toHaveBeenCalledOnce();
    await expect(value.replayRequest("buyer","full-text-budget",{...textRequest,prompt:"changed"})).rejects.toThrow("idempotency_conflict");
  });
  it("releases failed or paused full-model work without charging or awarding any credit",async()=>{
    const value=await textService();hub.textHub.execute.mockRejectedValueOnce(new Error("browser_text_reference_mismatch"));
    expect(await value.execute("buyer",null,"full-text-failed",textRequest,value.quote("buyer",textRequest).token)).toMatchObject({status:"failed"});
    expect(await wallet.summary("account","buyer")).toMatchObject({availableMicrounits:200000,reservedMicrounits:0});
    expect((await wallet.summary("account","contributor")).availableMicrounits).toBe(0);
  });
  it("keeps full-model chat funding, max spend, auth, streaming and replay within the settled route",async()=>{
    const value=await textService(),app=Fastify();
    mountBrowserInference(app,value,r=>r.headers.authorization==="Bearer buyer"?{kind:"user",userId:"buyer"}:{kind:"system"});
    app.post("/v1/chat/completions",async()=>{throw new Error("unexpected native fallback");});
    const payload={model:textRequest.model,messages:[{role:"user",content:textRequest.prompt}],max_tokens:8,temperature:0,stream:true};
    const headers={authorization:"Bearer buyer","x-mycellios-funding":"contribution-credits","idempotency-key":"full-text-chat-1"};
    try{
      expect((await app.inject({method:"POST",url:"/v1/chat/completions",headers:{...headers,"x-mycellios-max-credit-microunits":"10"},payload})).statusCode).toBe(409);
      expect((await app.inject({method:"POST",url:"/v1/chat/completions",headers:{...headers,authorization:"Bearer other"},payload})).statusCode).toBe(403);
      expect((await app.inject({method:"POST",url:"/v1/chat/completions",headers:{...headers,"x-mycellios-funding":""},payload})).statusCode).toBe(409);
      expect(hub.textHub.execute).not.toHaveBeenCalled();
      const response=await app.inject({method:"POST",url:"/v1/chat/completions",headers,payload});
      expect(response.statusCode).toBe(200);expect(response.headers["content-type"]).toContain("text/event-stream");
      expect(response.body).toContain('"content":"Result"');expect(response.body).toContain("[DONE]");
      expect((await app.inject({method:"POST",url:"/v1/chat/completions",headers,payload})).body).toBe(response.body);
      expect(hub.textHub.execute).toHaveBeenCalledOnce();
      const plain=await app.inject({method:"POST",url:"/v1/chat/completions",headers,payload:{...payload,stream:false}});
      expect(plain.statusCode).toBe(200);expect(plain.json()).toMatchObject({choices:[{message:{content:"Result"}}]});
      expect(hub.textHub.execute).toHaveBeenCalledOnce();
    }finally{await app.close();}
  });
  it("recovers a full-model receipt after rollback/offer closure without repeating generation",async()=>{
    const value=await textService(),complete=vi.spyOn(api,"completeUsage").mockRejectedValueOnce(new Error("temporary db failure"));
    try{
      await expect(value.execute("buyer",null,"text-recovery-1",textRequest,value.quote("buyer",textRequest).token)).rejects.toThrow("temporary db failure");
      expect((await wallet.summary("account","contributor")).availableMicrounits).toBe(0);
      complete.mockRestore();const closed=new BrowserInference(db,wallet,api,hub as unknown as MobileComputeHub,[],1);await closed.initialize();
      expect(await closed.replayRequest("buyer","text-recovery-1",textRequest)).toMatchObject({status:"completed",creditsMicrounits:364});
      expect((await wallet.summary("account","contributor")).availableMicrounits).toBe(350);
      expect(hub.textHub.execute).toHaveBeenCalledOnce();
    }finally{complete.mockRestore();}
  });
  it("debits exact cost +4%, pays the owned account once and conserves every microcredit", async () => {
    const result = await execute();
    expect(result).toMatchObject({ status: "completed", creditsMicrounits: 1040, serviceFeeMicrounits: 40, outputBase64: output });
    expect(await wallet.summary("account", "buyer")).toMatchObject({ availableMicrounits: 198960, reservedMicrounits: 0, settledJobs: 1 });
    expect(await wallet.summary("account", "contributor")).toMatchObject({ availableMicrounits: 1000, contributionEarnedMicrounits: 1000, settledJobs: 1 });
    expect(await wallet.summary("platform", "mycellios")).toMatchObject({ balanceMicrounits: -199960 });
    expect(hub.notifyInferenceSettled).toHaveBeenCalledWith(identity.workerId);
    await expect(execute()).resolves.toEqual(result);
    expect(hub.executeFundedExpert).toHaveBeenCalledOnce();
    expect((await wallet.summary("account", "contributor")).availableMicrounits).toBe(1000);
  });
  it("pays two genuinely separate requests with identical tensors, without confusing them with replays", async () => {
    await execute("separate-job-01"); await execute("separate-job-02");
    expect((await wallet.summary("account", "contributor")).contributionEarnedMicrounits).toBe(2000);
    expect(hub.executeFundedExpert).toHaveBeenCalledTimes(2);
  });
  it("one idempotency key admits one computation under concurrent requests", async () => {
    const result = await Promise.all([execute(), execute()]);
    expect(result.some(r => r.status === "completed")).toBe(true);
    expect(hub.executeFundedExpert).toHaveBeenCalledOnce();
    expect((await wallet.summary("account", "contributor")).availableMicrounits).toBe(1000);
  });
  it("checks budget before dispatch and cannot spend or invent another account's credits", async () => {
    await expect(service.execute("contributor", null, "no-funds-01", request, service.quote("contributor", request).token))
      .rejects.toThrow("insufficient_contribution_credits");
    expect(hub.executeFundedExpert).not.toHaveBeenCalled();
    expect((await wallet.summary("account", "contributor")).contributionEarnedMicrounits).toBe(0);
  });
  it("rejects forged worker ownership and account switching", async () => {
    await expect(service.bind("attacker", identity.workerId, "wrong-proof")).rejects.toThrow("proof_invalid");
    await expect(service.bind("attacker", identity.workerId, "worker-proof")).rejects.toThrow("ownership_conflict");
  });
  it("reserves before compute and releases failed/paused/tampered inference with no reward", async () => {
    hub.executeFundedExpert.mockImplementation(async () => {
      expect((await wallet.summary("account", "buyer")).reservedMicrounits).toBe(1040);
      throw new Error("browser_inference_reference_mismatch");
    });
    expect(await execute()).toMatchObject({ status: "failed" });
    expect(await wallet.summary("account", "buyer")).toMatchObject({ availableMicrounits: 200000, reservedMicrounits: 0 });
    expect((await wallet.summary("account", "contributor")).availableMicrounits).toBe(0);
    await execute(); expect(hub.executeFundedExpert).toHaveBeenCalledOnce();
  });
  it("never bills benchmarks or unlinked workers", async () => {
    await service.unbind("contributor", identity.workerId);
    await expect(execute()).rejects.toThrow("contributor_unavailable");
    expect(hub.executeFundedExpert).not.toHaveBeenCalled();
    expect((await wallet.summary("account", "buyer")).availableMicrounits).toBe(200000);
  });
  it("does not accept another account's quote or changed inputs", async () => {
    const quote = service.quote("buyer", request).token;
    await expect(service.execute("contributor", null, "quote-forgery", request, quote)).rejects.toThrow("expired_or_changed");
    await expect(service.execute("buyer", null, "quote-changed", { ...request, rows: 2 }, quote)).rejects.toThrow("expired_or_changed");
    expect(hub.executeFundedExpert).not.toHaveBeenCalled();
  });
  it("atomically rolls back a failed credit and recovers its saved receipt without another computation", async () => {
    const original = api.completeUsage.bind(api);
    const complete = vi.spyOn(api, "completeUsage").mockRejectedValueOnce(new Error("temporary db failure"));
    try {
      await expect(execute()).rejects.toThrow("temporary db failure");
      expect((await wallet.summary("account", "contributor")).availableMicrounits).toBe(0);
      expect((await wallet.summary("account", "buyer")).reservedMicrounits).toBe(1040);
      complete.mockImplementation(original);
      const restarted = new BrowserInference(db, wallet, api, hub as unknown as MobileComputeHub, [], 1);
      await restarted.initialize();
      expect(restarted.models()).toEqual([]);
      expect(()=>restarted.quote("buyer",request)).toThrow("offer_unavailable");
      expect(await restarted.status("buyer", "test-inference-01")).toMatchObject({ status: "completed" });
      expect(hub.executeFundedExpert).toHaveBeenCalledOnce();
      expect((await wallet.summary("account", "contributor")).availableMicrounits).toBe(1000);
    } finally { complete.mockRestore(); }
  });
  it("keeps the API scoped to its principal and denies system identities", async () => {
    const app = Fastify();
    mountBrowserInference(app, service, r => r.headers.authorization === "Bearer buyer" ? { kind: "user", userId: "buyer" } : { kind: "system" });
    try {
      expect((await app.inject({ method: "GET", url: "/v1/browser/models" })).statusCode).toBe(403);
      const response = await app.inject({ method: "POST", url: "/v1/browser/contributors", headers: { authorization: "Bearer buyer" },
        payload: { workerId: identity.workerId, token: "x".repeat(32), accountId: "contributor" } });
      expect(response.statusCode).not.toBe(200);
      expect(response.body).not.toContain("x".repeat(32));
      expect(await service.status("contributor", "test-inference-01")).toBeNull();
    } finally { await app.close(); }
  });
  it("protects payout tables with RLS and gives no public grants", async () => {
    const tables = await sql.unsafe(`SELECT c.relname,c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='${schema}' AND c.relname IN ('economic_browser_inference_credits','economic_browser_contributors')`);
    expect(tables).toHaveLength(2); expect(tables.every(t => t.relrowsecurity)).toBe(true);
    const grants = await sql.unsafe(`SELECT * FROM information_schema.table_privileges WHERE table_schema='${schema}'
      AND table_name IN ('economic_browser_inference_credits','economic_browser_contributors') AND grantee='PUBLIC'`);
    expect(grants).toHaveLength(0);
  });
  it("releases a hard-expired abandoned lease on recovery without compute, charging or rewarding",async()=>{
    const purchases = new (await import("../src/economy/managed-purchases.js")).ManagedPurchases(db,wallet,1000000);
    await purchases.initialize();
    const usage=await api.beginUsage("buyer",null,{model:request.model,messages:[]},true);
    await purchases.reserve({usageId:usage.id,accountId:"buyer",key:"abandoned-lease",digest:"test-only",provider:"mycellios-browser",model:request.model,maximumUsd:"0.001"});
    await purchases.claim(usage.id,"buyer");
    await db.raw.prepare("UPDATE economic_managed_purchases SET created_at=?,remote_job_json=? WHERE usage_id=?")
      .run(Date.now()-130000,JSON.stringify({workerId:identity.workerId,accountId:"contributor",fingerprint:identity.fingerprint,artifactId:offer.artifactId,cost:1000,digest:"test-only",deadline:Date.now()-10000}),usage.id);
    await service.recoverExpired();
    expect((await wallet.summary("account","buyer")).availableMicrounits).toBe(200000);
    expect((await wallet.summary("account","contributor")).availableMicrounits).toBe(0);
    expect(hub.executeFundedExpert).not.toHaveBeenCalled();
  });
});
