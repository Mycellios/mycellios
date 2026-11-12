import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { generateKeyPairSync,createHmac,createHash } from "node:crypto";
import {ManagedAntseedEdit,type EditQuote} from "../src/coordinator/managed-antseed-edit.js";
import {mountManagedVideoEdit} from "../src/coordinator/managed-video-edit-routes.js";
import type {ManagedEditRequest} from "../src/contracts/video-edit.js";
import {ManagedTextRouter,managedTextBackend,type RoutedTextQuote} from "../src/coordinator/managed-text-router.js";
import type {ManagedModel} from "../src/contracts/managed-provider.js";
import { WalletTopups,walletTopupsSchemaSql,walletTopupsAccessSchemaSql } from "../src/economy/wallet-topups.js";
import { StripeBillingInbound } from "../src/coordinator/billing-inbound.js";
import postgres from "postgres";
import { grantWelcomeCredits, WELCOME_CREDIT_MICROUNITS } from "../src/economy/welcome-credits.js";
import Fastify from "fastify";
import { MeshDatabase } from "../src/storage/database.js";
import { EconomicLedger } from "../src/economy/economic-ledger.js";
import { ContributionCreditWallet, contributionCreditSchemaSql } from "../src/economy/contribution-credit-wallet.js";
import { expiringPromotionSchemaSql } from "../src/economy/promotional-credits.js";
import { ManagedPurchases, managedPurchasesSchemaSql, managedPurchasesAccessSchemaSql } from "../src/economy/managed-purchases.js";
import { ApiAccessManager } from "../src/coordinator/api-access.js";
import { ManagedGateway } from "../src/coordinator/managed-gateway.js";
import { ManagedOpenRouter, MANAGED_MODEL_PREFIX } from "../src/coordinator/managed-openrouter.js";
import { ManagedAntseedText } from "../src/coordinator/managed-antseed-text.js";
import { antseedFixture, operatorSecret } from "./fixtures/managed-antseed.js";
import {ManagedAntseedGateway} from "../src/coordinator/managed-antseed-gateway.js";
import {antseedGatewayFixture,gatewayKey,gatewayModel} from "./fixtures/managed-antseed-gateway.js";
import { mountManagedProviderRoutes, handleManagedChat } from "../src/coordinator/managed-provider-routes.js";
import {ManagedMedia,type MediaRequest,type MediaQuote} from "../src/coordinator/managed-media.js";
import {Referrals,referralSchemaSql,referralAccessSchemaSql} from "../src/economy/referrals.js";
import {mountManagedMediaRoutes} from "../src/coordinator/managed-media-routes.js";
import type {MediaOffer} from "../src/contracts/managed-provider.js";
import {mountWalletTopups} from "../src/coordinator/wallet-topup-routes.js";

// All money here is isolated test data. No vendor key, external inference or production DB.
const url = process.env.MYCELLIOS_REFERRAL_TEST_POSTGRES_URL;
describe.skipIf(!url)("managed purchases on isolated PostgreSQL", () => {
  const schema = "managed_test_" + Math.random().toString(36).slice(2);
  const nativeRole = schema + "_native", browserRole = schema + "_browser";
  const sql = postgres(url!, { max: 2, onnotice: () => {} });
  let db: MeshDatabase, ledger: EconomicLedger, wallet: ContributionCreditWallet, purchases: ManagedPurchases, api: ApiAccessManager;
  const input = { model: MANAGED_MODEL_PREFIX + "vendor/text", messages: [{ role: "user", content: "Hello" }], max_tokens: 10 };
  beforeAll(async () => {
    await sql.unsafe(`CREATE SCHEMA ${schema}`);
    const source = readFileSync(new URL("../src/storage/database.ts", import.meta.url), "utf8");
    for (const table of ["economic_contribution_evidence", "economic_accounts", "pricing_policies", "economic_settlements",
      "economic_ledger_entries", "economic_settlement_receipts", "node_ownership", "economic_node_reputation", "api_accounts", "api_keys", "api_usage"]) {
      const ddl = source.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\n      \\);`))?.[0];
      if (!ddl) throw new Error(`Canonical DDL missing: ${table}`);
      await sql.unsafe(`SET search_path TO ${schema}; ` + ddl.replace(/\bINTEGER\b/g, "BIGINT"));
    }
    await sql.unsafe(`SET search_path TO ${schema}; CREATE TABLE schema_meta(version integer); INSERT INTO schema_meta VALUES(33);
      CREATE TABLE api_operator_funded_usage(usage_id text);` + contributionCreditSchemaSql + expiringPromotionSchemaSql + managedPurchasesSchemaSql + walletTopupsSchemaSql + referralSchemaSql);
    await sql.unsafe(`CREATE ROLE ${nativeRole} NOLOGIN; CREATE ROLE ${browserRole} NOLOGIN;
      GRANT USAGE ON SCHEMA ${schema} TO ${nativeRole},${browserRole}; SET search_path TO ${schema};` + managedPurchasesAccessSchemaSql(nativeRole)+walletTopupsAccessSchemaSql(nativeRole)+referralAccessSchemaSql(nativeRole));
    db = await MeshDatabase.openPostgres(url!, schema);
    ledger = new EconomicLedger(db, { receiptSigning: { keyId: "managed-test", privateKey: generateKeyPairSync("ed25519").privateKey } });
    wallet = new ContributionCreditWallet(db, ledger, true); await wallet.initialize();
    purchases = new ManagedPurchases(db, wallet, 10000000); await purchases.initialize();
    api = new ApiAccessManager(db, { starterTokens: 0, requestsPerMinute: 100, maxConcurrent: 10, maxActiveKeys: 2 }, {}, true);
  });
  beforeEach(async () => {
    await db.raw.exec(`TRUNCATE referral_redemptions,referral_pending_accounts,referral_visits,referral_invites,economic_wallet_topups,economic_wallet_payment_events,economic_managed_purchases,economic_promotion_allocations,economic_credit_replays,economic_credit_transfers,
      api_contribution_funded_usage,economic_credit_holds,economic_promotional_grants,api_usage,api_accounts,
      economic_settlement_receipts,economic_ledger_entries,economic_settlements,economic_contribution_evidence,economic_accounts CASCADE`);
    await api.getOrCreateAccount("alice"); await api.getOrCreateAccount("bob");
    await db.raw.prepare(`INSERT INTO economic_promotional_grants
      (id,account_id,issued_by,reason,amount_microunits,created_at,expires_at) VALUES ('test-funds','alice','test','test-only',2000000,?,?)`)
      .run(Date.now(), Date.now() + 600000);
  });
  afterAll(async () => { await db?.close(); await sql.unsafe(`DROP SCHEMA ${schema} CASCADE; DROP ROLE ${nativeRole}; DROP ROLE ${browserRole}`); await sql.end(); });
  it("grants welcome credit once only to an existing verified account under concurrent retries", async () => {
    expect(await grantWelcomeCredits(db, { userId: "bob", emailVerified: false })).toBe(false);
    expect(await grantWelcomeCredits(db, { userId: "missing", emailVerified: true })).toBe(false);
    const results = await Promise.all(Array.from({ length: 4 }, () => grantWelcomeCredits(db, { userId: "bob", emailVerified: true })));
    expect(results.filter(Boolean)).toHaveLength(1);
    const rows = await db.raw.prepare("SELECT account_id,amount_microunits FROM economic_promotional_grants WHERE issued_by='welcome-v1'").all();
    expect(rows).toEqual([{ account_id: "bob", amount_microunits: WELCOME_CREDIT_MICROUNITS }]);
    expect(await grantWelcomeCredits(db, { userId: "bob", emailVerified: true })).toBe(false);
  });
  async function hold(key: string, maximumUsd = "1", accountId = "alice") {
    const usage = await api.beginUsage(accountId, null, { model: input.model, messages: [] }, true);
    return await purchases.reserve({ usageId: usage.id, accountId, key, digest: "digest-" + key, provider: "mock", model: input.model, maximumUsd });
  }
  async function gateway() {
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ data: [{ id: "vendor/text", name: "Text",
      context_length: 131072, architecture: { output_modalities: ["text"] }, pricing: { prompt: "0.000001", completion: "0.000002", request: "0" } }] }));
    const provider = new ManagedOpenRouter("test-not-a-real-key", ["vendor/text"], transport,0);
    await provider.refresh();
    return { service: new ManagedGateway(db, purchases, api, provider, 1000000), transport };
  }
  function result(cost = "0.00001", id = "gen-test") {
    return new Response(`{"id":"${id}","choices":[{"index":0,"message":{"role":"assistant","content":"Hi"},"finish_reason":"stop"}],"usage":{"cost":${cost},"prompt_tokens":2,"completion_tokens":3}}`);
  }

  it("connects an operator gateway key to the real wallet, funds a new account and debits actual cost plus funding plus 4 percent once", async () => {
    const f=antseedGatewayFixture(),adapter=new ManagedAntseedGateway(gatewayKey,"http://127.0.0.1:8379",["*"],100,f.transport,"deepseek-bounded-v1");
    const service=new ManagedGateway(db,purchases,api,new ManagedTextRouter([managedTextBackend("antseed-gateway",adapter)]),1000000);
    const request={model:gatewayModel,messages:[{role:"user",content:"Hello"}],max_tokens:10};
    const app=Fastify(),headers={"x-mycellios-funding":"contribution-credits","idempotency-key":"gateway-first-credit"};
    app.post("/v1/chat/completions",(req,reply)=>handleManagedChat(req,reply,service,{userId:"bob",apiKeyId:null}));
    try {
      expect((await app.inject({method:"POST",url:"/v1/chat/completions",headers:{...headers,"idempotency-key":"gateway-no-funds"},payload:request})).statusCode).toBe(402);
      expect(f.inference()).toHaveLength(0);
      await db.raw.prepare(`INSERT INTO economic_promotional_grants
        (id,account_id,issued_by,reason,amount_microunits,created_at,expires_at)
        VALUES ('bob-gateway-credit','bob','test','test-only',1000000,?,?)`).run(Date.now(),Date.now()+14*86400000);
      const response=await app.inject({method:"POST",url:"/v1/chat/completions",headers,payload:request});
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({model:gatewayModel,mycellios:{creditsMicrounits:6,fundingCostBasisPoints:100,serviceFeeBasisPoints:400}});
      expect((await wallet.summary("account","bob")).availableMicrounits).toBe(999994);
      expect(JSON.stringify(response.json())).not.toContain(gatewayKey);
      expect((await app.inject({method:"POST",url:"/v1/chat/completions",headers,payload:request})).statusCode).toBe(200);
      expect(f.inference()).toHaveLength(1);expect(await wallet.reserved("bob")).toBe(0);
      expect((await purchases.find("bob",headers["idempotency-key"]))?.provider).toBe("antseed-gateway");
    } finally {await app.close();}
  });
  it("retains the gateway credit hold on partial cost, recovers after restart and rejects an unrelated account",async()=>{
    const f=antseedGatewayFixture();f.pending(true);
    const make=()=>new ManagedGateway(db,purchases,api,new ManagedTextRouter([managedTextBackend("antseed-gateway",
      new ManagedAntseedGateway(gatewayKey,"http://127.0.0.1:8379",["*"],100,f.transport,"deepseek-bounded-v1"))]),1000000);
    const service=make(),request={model:gatewayModel,messages:[{role:"user",content:"Hello"}],max_tokens:10};
    const q=await service.quote("alice",request),key="gateway-late-invoice";
    expect(await service.execute("alice",null,key,request,q.token)).toMatchObject({status:"pending_reconciliation"});
    expect(await wallet.reserved("alice")).toBeGreaterThan(0);
    await expect(make().reconcile("bob",key)).rejects.toThrow("receipt_missing");
    f.pending(false);f.row.inputTokens=1;
    expect(await make().reconcile("alice",key)).toMatchObject({status:"pending_reconciliation"});
    f.row.inputTokens=3;
    expect(await make().reconcile("alice",key)).toMatchObject({status:"completed",response:{mycellios:{creditsMicrounits:6}}});
    expect(f.inference()).toHaveLength(1);expect(await wallet.reserved("alice")).toBe(0);
  });
  it("persists gateway overcharges as a safety stop rather than clearing the hold or allowing more spend",async()=>{
    const f=antseedGatewayFixture();f.row.spent="1";
    const provider=new ManagedTextRouter([managedTextBackend("antseed-gateway",
      new ManagedAntseedGateway(gatewayKey,"http://127.0.0.1:8379",["*"],100,f.transport,"deepseek-bounded-v1"))]);
    const service=new ManagedGateway(db,purchases,api,provider,1000000),request={model:gatewayModel,messages:[{role:"user",content:"Hello"}],max_tokens:10};
    const q=await service.quote("alice",request);
    expect(await service.execute("alice",null,"gateway-overcharge",request,q.token)).toMatchObject({status:"pending_reconciliation"});
    expect(await purchases.find("alice","gateway-overcharge")).toMatchObject({safety_stop:true,state:"uncertain"});
    expect(await wallet.reserved("alice")).toBeGreaterThan(0);
    await expect(service.quote("bob",request)).rejects.toThrow("safety_stop");expect(f.inference()).toHaveLength(1);
  });
  it("spends one promotional Credit through AntSeed, charges actual signed cost plus 4 percent once and blocks overdrafts before inference", async () => {
    await db.raw.prepare(`INSERT INTO economic_promotional_grants
      (id,account_id,issued_by,reason,amount_microunits,created_at,expires_at)
      VALUES ('bob-antseed-credit','bob','test','referral-test',1000000,?,?)`).run(Date.now(),Date.now()+14*86400000);
    const f=antseedFixture(),adapter=new ManagedAntseedText(operatorSecret,["*"],f.transport,0);
    const router=new ManagedTextRouter([managedTextBackend("antseed",adapter)]);
    const gateway=new ManagedGateway(db,purchases,api,router,2000000);
    const request={model:"mycellios/managed/antseed/deepseek-test",messages:[{role:"user",content:"Hello"}],max_tokens:256};
    const app=Fastify();
    app.post("/v1/chat/completions",(req,reply)=>handleManagedChat(req,reply,gateway,{userId:"bob",apiKeyId:null}));
    const headers={"x-mycellios-funding":"contribution-credits","idempotency-key":"antseed-first-account"};
    try {
      const response=await app.inject({method:"POST",url:"/v1/chat/completions",headers,payload:request});
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({model:request.model,mycellios:{provider:"Mycellios",creditsMicrounits:420,serviceFeeBasisPoints:400}});
      expect(JSON.stringify(response.json())).not.toContain(operatorSecret);
      expect((await wallet.summary("account","bob")).availableMicrounits).toBe(999580);
      expect(f.posts()).toHaveLength(1);
      const replay=await app.inject({method:"POST",url:"/v1/chat/completions",headers,payload:request});
      expect(replay.statusCode).toBe(200);expect(f.posts()).toHaveLength(1);
      const rejected=await app.inject({method:"POST",url:"/v1/chat/completions",headers:{...headers,"idempotency-key":"antseed-over-balance"},payload:{...request,max_tokens:8192}});
      expect(rejected.statusCode).toBe(402);expect(f.posts()).toHaveLength(1);
      expect((await wallet.summary("account","bob")).availableMicrounits).toBe(999580);
      expect((await purchases.find("bob",headers["idempotency-key"]))?.provider).toBe("antseed");
    } finally {await app.close();}
  });
  it("recovers a late AntSeed receipt after recreating the gateway, preserving the hold and never repeating the paid POST",async()=>{
    const f=antseedFixture({late:true}),adapter=new ManagedAntseedText(operatorSecret,["*"],f.transport,0);
    const makeGateway=()=>new ManagedGateway(db,purchases,api,new ManagedTextRouter([managedTextBackend("antseed",adapter)]),2000000);
    const gateway=makeGateway(),request={model:"mycellios/managed/antseed/deepseek-test",messages:[{role:"user",content:"Hi"}],max_tokens:256};
    const quote=await gateway.quote("alice",request),key="antseed-late-receipt";
    expect(await gateway.execute("alice",null,key,request,quote.token)).toMatchObject({status:"pending_reconciliation"});
    expect(await wallet.reserved("alice")).toBeGreaterThan(0);
    await expect(gateway.reconcile("bob",key)).rejects.toThrow("receipt_missing");
    f.confirm();const restarted=makeGateway();
    expect(await restarted.reconcile("alice",key)).toMatchObject({status:"completed",response:{mycellios:{creditsMicrounits:420}}});
    await restarted.reconcile("alice",key);expect(f.posts()).toHaveLength(1);
    expect(await wallet.reserved("alice")).toBe(0);
    expect((await wallet.summary("account","alice")).availableMicrounits).toBe(1999580);
  });
  it("checks a late AntSeed receipt when the same chat is retried, without another paid call or quote",async()=>{
    const f=antseedFixture({late:true}),adapter=new ManagedAntseedText(operatorSecret,["*"],f.transport,0);
    const gateway=new ManagedGateway(db,purchases,api,new ManagedTextRouter([managedTextBackend("antseed",adapter)]),2000000);
    const request={model:"mycellios/managed/antseed/deepseek-test",messages:[{role:"user",content:"Hi"}],max_tokens:256};
    const app=Fastify(),headers={"x-mycellios-funding":"contribution-credits","idempotency-key":"antseed-retry-same-chat"};
    app.post("/v1/chat/completions",(req,reply)=>handleManagedChat(req,reply,gateway,{userId:"alice",apiKeyId:null}));
    try {
      expect((await app.inject({method:"POST",url:"/v1/chat/completions",headers,payload:request})).statusCode).toBe(202);
      f.confirm();
      const retry=await app.inject({method:"POST",url:"/v1/chat/completions",headers,payload:request});
      expect(retry.statusCode).toBe(200);expect(retry.json().mycellios.creditsMicrounits).toBe(420);
      expect(f.posts()).toHaveLength(1);
    } finally {await app.close();}
  });
  it("lets a new account spend its one promotional Credit through the optional OpenRouter backend without a personal provider key", async () => {
    await db.raw.prepare(`INSERT INTO economic_promotional_grants
      (id,account_id,issued_by,reason,amount_microunits,created_at,expires_at)
      VALUES ('bob-one-credit','bob','test','referral-test',1000000,?,?)`).run(Date.now(), Date.now() + 14 * 86400000);
    const operatorKey = "operator-key-fixture-only";
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ data: [{
      id: "vendor/text", name: "Managed text", context_length: 131072,
      architecture: { output_modalities: ["text"] },
      pricing: { prompt: "0.000001", completion: "0.0002", request: "0" },
    }] }));
    const provider = new ManagedOpenRouter(operatorKey, ["vendor/text"], transport, 550);
    await provider.refresh();
    const service = new ManagedGateway(db, purchases, api, provider, 2000000);
    const app = Fastify();
    app.post("/v1/chat/completions", (request, reply) => handleManagedChat(request, reply, service, { userId: "bob", apiKeyId: null }));
    const headers = { "x-mycellios-funding": "contribution-credits", "idempotency-key": "new-account-first-message" };
    transport.mockResolvedValueOnce(result("0.00001", "gen-new-account"));
    try {
      const response = await app.inject({ method: "POST", url: "/v1/chat/completions", headers, payload: input });
      expect(response.statusCode).toBe(200);
      expect(response.json().choices[0].message.content).toBe("Hi");
      expect(JSON.stringify(response.json())).not.toContain(operatorKey);
      expect(new Headers(transport.mock.calls[1]?.[1]?.headers).get("authorization")).toBe(`Bearer ${operatorKey}`);
      // $0.00001 + fixture supplier funding fee of 5.5%, then Mycellios +4%.
      expect((await wallet.summary("account", "bob")).availableMicrounits).toBe(999989);
      const replay = await app.inject({ method: "POST", url: "/v1/chat/completions", headers, payload: input });
      expect(replay.statusCode).toBe(200);
      expect(transport).toHaveBeenCalledTimes(2); // Catalog plus one upstream inference.
      const rejected = await app.inject({ method: "POST", url: "/v1/chat/completions",
        headers: { ...headers, "idempotency-key": "new-account-over-balance" }, payload: { ...input, max_tokens: 8192 } });
      expect(rejected.statusCode).toBe(402);
      expect(transport).toHaveBeenCalledTimes(2);
      expect((await wallet.summary("account", "bob")).availableMicrounits).toBe(999989);
    } finally { await app.close(); }
  });
  it("executes a verified zero-price model with no balance, no Credit hold and one persisted receipt",async()=>{
    const transport=vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({data:[{id:"vendor/free",name:"Free",context_length:131072,
      architecture:{output_modalities:["text"]},pricing:{prompt:"0",completion:"0"}}]}));
    const provider=new ManagedOpenRouter("fixture",["*"],transport);await provider.refresh();
    const service=new ManagedGateway(db,purchases,api,provider,1000000),request={...input,model:MANAGED_MODEL_PREFIX+"vendor/free"};
    const quote=await service.quote("bob",request);expect(quote.maximumMicrounits).toBe(0);
    transport.mockResolvedValueOnce(result("0","free-receipt"));
    expect(await service.execute("bob",null,"free-wallet-request",request,quote.token)).toMatchObject({status:"completed",response:{mycellios:{creditsMicrounits:0}}});
    await service.execute("bob",null,"free-wallet-request",request,quote.token);
    expect((await wallet.summary("account","bob")).availableMicrounits).toBe(0);
    expect(await db.raw.prepare("SELECT amount_microunits,status FROM economic_credit_holds WHERE account_id='bob'").get()).toMatchObject({amount_microunits:0,status:"settled"});
    expect(transport.mock.calls.filter(([,i])=>i?.method==="POST")).toHaveLength(1);
  });
  it("rejects a paid receipt for a zero-cost reservation instead of fabricating a free result",async()=>{
    const usage=await api.beginUsage("bob",null,{model:input.model,messages:[]},true);
    await purchases.reserve({usageId:usage.id,accountId:"bob",key:"false-free-request",digest:"free",provider:"mock",model:input.model,maximumUsd:"0"});
    await purchases.claim(usage.id,"bob");
    await expect(purchases.settle({id:usage.id,accountId:"bob",receiptId:"not-free",usd:"0.00000001",evidence:{}})).rejects.toThrow("outside_reservation");
    expect((await purchases.find("bob","false-free-request"))?.state).toBe("submitted");
  });
  it("freezes the effective supplier fee in the durable reservation, survives a new service and debits all costs once",async()=>{
    const usage=await api.beginUsage("alice",null,{model:input.model,messages:[]},true);
    await purchases.reserve({usageId:usage.id,accountId:"alice",key:"loaded-cost-request",digest:"loaded",provider:"mock",model:input.model,maximumUsd:"1",fundingCostBasisPoints:550});
    expect(await wallet.reserved("alice")).toBe(1097200);await purchases.claim(usage.id,"alice");
    const restarted=new ManagedPurchases(db,wallet,10000000);await restarted.initialize();
    const receipt={id:usage.id,accountId:"alice",receiptId:"loaded-receipt",usd:"0.5",evidence:{}};
    expect(await restarted.settle(receipt)).toMatchObject({totalMicrounits:548600,fundingCostMicrounits:27500,serviceFeeMicrounits:21100});
    await restarted.settle(receipt);expect((await wallet.summary("account","alice")).availableMicrounits).toBe(1451400);
  });
  it("does not release a possibly charged managed hold during generic failed-usage startup recovery",async()=>{
    const item=await hold("startup-uncertain");await purchases.claim(item.id,"alice");await purchases.uncertain(item.id);
    await api.failUsage(item.id,"interrupted");await wallet.initialize();expect(await wallet.reserved("alice")).toBe(1040000);
  });
  it("only leases one asynchronous media recovery across service instances",async()=>{
    const item=await hold("one-poll-only");await purchases.claim(item.id,"alice");
    const claims=await Promise.all([purchases.claimPoll(item.id,"alice"),purchases.claimPoll(item.id,"alice")]);
    expect(claims.filter(v=>v!==null)).toHaveLength(1);
    expect(await purchases.claimPoll(item.id,"bob")).toBeNull();await purchases.releasePoll(item.id,claims.find(v=>v!==null)!);
    expect(await purchases.claimPoll(item.id,"alice")).not.toBeNull();
  });
  it("persists an upstream overcharge receipt, retains the hold and stops new purchases across accounts and restarts",async()=>{
    const {service,transport}=await gateway();const quote=await service.quote("alice",input);
    transport.mockResolvedValueOnce(result("1","overcharge-receipt"));
    expect(await service.execute("alice",null,"overcharge-request",input,quote.token)).toMatchObject({status:"pending_reconciliation"});
    const row=await purchases.find("alice","overcharge-request");expect(row).toMatchObject({safety_stop:true,state:"uncertain",provider_receipt_id:"overcharge-receipt"});
    expect(await wallet.reserved("alice")).toBeGreaterThan(0);
    const restarted=new ManagedPurchases(db,wallet,10000000);await restarted.initialize();
    await expect(restarted.assertAdmitting("openrouter")).rejects.toThrow("safety_stop");
    await expect(service.quote("bob",input)).rejects.toThrow("safety_stop");
    expect(transport.mock.calls.filter(([,i])=>i?.method==="POST")).toHaveLength(1);
    expect((await wallet.summary("account","alice")).balanceMicrounits).toBe(2000000);
  });
  it("counts late settlement on the day it settles, preserving the persisted daily cap",async()=>{
    const first=await hold("yesterday-request","0.5");await purchases.claim(first.id,"alice");
    await db.raw.prepare("UPDATE economic_managed_purchases SET created_at=? WHERE usage_id=?").run(Date.now()-86400000,first.id);
    await purchases.settle({id:first.id,accountId:"alice",receiptId:"today-receipt",usd:"0.5",evidence:{}});
    const limited=new ManagedPurchases(db,wallet,1000000);await limited.initialize();
    const usage=await api.beginUsage("alice",null,{model:input.model,messages:[]},true);
    await expect(limited.reserve({usageId:usage.id,accountId:"alice",key:"today-over-budget",digest:"today",provider:"mock",model:input.model,maximumUsd:"0.5"})).rejects.toThrow("budget_exceeded");
  });
  it("bills the routed upstream to the same Mycellios wallet and rejects a changed route before spending",async()=>{
    const transport=vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({data:[{id:"vendor/text",name:"Text",context_length:131072,architecture:{output_modalities:["text"]},pricing:{prompt:"0.0001",completion:"0.0002",request:"0"}}]}));
    const adapter=new ManagedOpenRouter("fixture",["vendor/text"],transport,0);
    const router=new ManagedTextRouter([managedTextBackend("openrouter",adapter)],[{id:"mycellios/managed/assistant",backend:"openrouter",model:input.model}]);
    const gateway=new ManagedGateway<typeof input,RoutedTextQuote,ManagedModel>(db,purchases,api,router,1040000);
    const request={...input,model:"mycellios/managed/assistant"};const quote=await gateway.quote("alice",request);
    transport.mockResolvedValueOnce(result("0.1","gen-routed"));
    const completed=await gateway.execute("alice",null,"routed-wallet-request",request,quote.token);
    expect(completed).toMatchObject({status:"completed",response:{model:request.model,mycellios:{creditsMicrounits:104000}}});
    expect((await purchases.find("alice","routed-wallet-request"))?.provider).toBe("openrouter");
    expect((await wallet.summary("account","alice")).availableMicrounits).toBe(1896000);
    const next=await gateway.quote("alice",request),original=router.quote.bind(router);
    vi.spyOn(router,"quote").mockImplementation(raw=>{const q=original(raw);return {...q,body:{...q.body,route:{...q.body.route,backend:"antseed"}}};});
    await expect(gateway.execute("alice",null,"changed-route-request",request,next.token)).rejects.toThrow("managed_price_changed");
    expect(transport.mock.calls.filter(([,v])=>v?.method==="POST")).toHaveLength(1);
  });
  it("edits through the real shared wallet and scoped HTTP routes with mocked AntSeed, once, including restart recovery and 4 percent",async()=>{
    const bytes=Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from("ftyp"),Buffer.alloc(40)]),source={duration:5,width:1280,height:720};
    let tag="",downloadId="",createCount=0,downloadCount=0,wrongReceipt=true;
    const transport=vi.fn<typeof fetch>(async(url,init)=>{
      const path=String(url),headers=new Headers(init?.headers);
      if(path.includes("/v1/models"))return Response.json({data:[{id:"wan",peers:[{peerId:"peer",provider:"video",serviceId:"wan",protocol:"fal-video",
        capabilities:{video:{inputs:["video"],requiredInputs:["video"],resolutions:["720p"]}},
        unitBillingModels:{"fal-video":{components:[{unit:"video_seconds",priceUsd:0.02}]}}}]}]});
      if(path.includes("/attributed-spend"))return Response.json({bootId:"isolated-buyer",cursor:tag?1:0,oldestSeq:1,capabilities:["video-budget"],events:downloadId?[{
        seq:1,tag,requestId:downloadId,sellerPeerId:wrongReceipt?"foreign-peer":"peer",buyerIdentity:"default",amountUsdc:"100000"}]:[]});
      if(path.endsWith("/queue")){createCount++;tag=headers.get("x-antseed-attribution-tag")!;return Response.json({request_id:"job-isolated"});}
      if(path.endsWith("/retrieve")){downloadCount++;downloadId=headers.get("x-antseed-request-id")!;return new Response(bytes,{headers:{"content-type":"video/mp4"}});}
      throw new Error("unexpected transport");
    });
    const provider=new ManagedAntseedEdit("test-control-not-real",transport,async()=>source);
    const make=()=>new ManagedGateway<ManagedEditRequest,EditQuote,ReturnType<ManagedAntseedEdit["catalog"]>[number]>(db,purchases,api,provider,1040000);
    let gateway=make(),owner="alice",app=Fastify();
    mountManagedVideoEdit(app,provider,gateway,purchases,db,wallet,()=>({userId:owner,apiKeyId:null}));
    const request:ManagedEditRequest={model:"mycellios/antseed/video-edit",project:"a".repeat(64),prompt:"Make it rain",source:{...source,hash:createHash("sha256").update(bytes).digest("hex")}};
    const key="edit:"+request.project;
    try {
      const q=await app.inject({method:"POST",url:"/v1/managed/video-edit/quote",payload:request});expect(q.statusCode).toBe(200);expect(q.json().maximumMicrounits).toBe(104000);
      expect((await wallet.summary("account","alice")).availableMicrounits).toBe(2000000);expect(createCount).toBe(0);
      const payload={request,token:q.json().token,key,data:bytes.toString("base64")};
      expect((await app.inject({method:"POST",url:"/v1/managed/video-edit/execute",payload})).statusCode).toBe(202);
      expect(createCount).toBe(1);expect((await wallet.summary("account","alice")).reservedMicrounits).toBe(104000);
      await app.inject({method:"POST",url:"/v1/managed/video-edit/execute",payload});expect(createCount).toBe(1);
      const bad=await app.inject({method:"POST",url:"/v1/managed/video-edit/status",payload:{key}});expect(bad.statusCode).toBe(500);
      expect((await wallet.summary("account","alice")).reservedMicrounits).toBe(104000);
      const row=await purchases.find("alice",key);expect(JSON.parse(String(row!.remote_job_json)).bytes).toBe(bytes.toString("base64"));
      wrongReceipt=false;gateway=make(); // The server receipt and local artifact survive a gateway restart.
      await app.close();app=Fastify();mountManagedVideoEdit(app,provider,gateway,purchases,db,wallet,()=>({userId:owner,apiKeyId:null}));
      const concurrent=await Promise.all([app.inject({method:"POST",url:"/v1/managed/video-edit/status",payload:{key}}),app.inject({method:"POST",url:"/v1/managed/video-edit/status",payload:{key}})]);
      expect(concurrent.some(r=>r.json().status==="completed")).toBe(true);
      const repeated=await app.inject({method:"POST",url:"/v1/managed/video-edit/status",payload:{key}});expect(repeated.json().response.mycellios.creditsMicrounits).toBe(104000);
      expect((await wallet.summary("account","alice")).availableMicrounits).toBe(1896000);
      const output=await app.inject({method:"POST",url:"/v1/managed/video-edit/content",payload:{key}});expect(output.rawPayload).toEqual(bytes);
      owner="bob";expect((await app.inject({method:"POST",url:"/v1/managed/video-edit/content",payload:{key}})).statusCode).toBe(500);
      const qb=await app.inject({method:"POST",url:"/v1/managed/video-edit/quote",payload:request});
      expect((await app.inject({method:"POST",url:"/v1/managed/video-edit/execute",payload:{...payload,token:qb.json().token}})).json()).toMatchObject({status:"not_submitted",code:"insufficient_contribution_credits"});
      expect({createCount,downloadCount}).toEqual({createCount:1,downloadCount:1});
    }finally{await app.close();}
  });
  it("resumes a persisted media job and charges its real cost plus 4 percent without another create",async()=>{
    const transport=vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({id:"movie-test"}))
      .mockResolvedValueOnce(new Response('{"id":"movie-test","status":"completed","generation_id":"gen-movie","usage":{"cost":0.5}}'));
    const provider=new ManagedMedia("fixture",[{id:"mycellios/media/movie",upstreamId:"vendor/movie",kind:"video",name:"Movie",maximumUsd:"1",expiresAt:Date.now()+60000,durations:[5]}],transport,0);
    const make=()=>new ManagedGateway<MediaRequest,MediaQuote,ReturnType<ManagedMedia["catalog"]>[number]>(db,purchases,api,provider,1040000);
    const request:MediaRequest={model:"mycellios/media/movie",kind:"video",prompt:"A tree",duration:5};
    const gateway=make(),quote=await gateway.quote("alice",request);
    expect((await gateway.execute("alice",null,"media-movie-request",request,quote.token)).status).toBe("pending_reconciliation");
    const row=await purchases.find("alice","media-movie-request");expect(typeof row?.remote_job_json).toBe("string");
    const result=await provider.poll(JSON.parse(String(row!.remote_job_json)));
    await make().completeKnown(String(row!.usage_id),"alice",result!);
    expect((await wallet.summary("account","alice")).availableMicrounits).toBe(1480000);
    expect(transport.mock.calls.filter(v=>v[1]?.method==="POST")).toHaveLength(1);
  });
  function mediaFixture(kind:MediaOffer["kind"]) {
    const offer:MediaOffer={id:"mycellios/media/"+kind+"/vendor/model",upstreamId:"vendor/model",name:"Fixture",kind,expiresAt:Date.now()+60000,
      maximumUsd:"0.02",voices:["alloy"],durations:[5],costContract:{version:1,sourceDigest:"sha256:"+"a".repeat(64),
        components:[{unit:"request",usd:"0.02"}],controls:{},maxOutputTokens:256}};
    const transport=vi.fn<typeof fetch>(async(url,init)=>{
      const path=String(url);
      if(init?.method==="POST") {
        if(kind==="speech")return new Response(Buffer.from("ID3fixture"),{headers:{"content-type":"audio/mpeg","x-generation-id":"speech-real-id"}});
        if(kind==="batch"||kind==="video")return Response.json({id:kind+"-job"});
        const data=kind==="image"?{data:[{b64_json:Buffer.from([137,80,78,71,13,10,26,10]).toString("base64"),media_type:"image/png"}]}:
          kind==="transcription"?{text:"Hola"}:kind==="embeddings"?{data:[{index:0,embedding:[0.1,0.2]}]}:kind==="decisions"?{answers:{answer:{type:"noul",noul:0.86}}}:{results:[{index:0,relevance_score:0.9}]};
        return Response.json({id:kind+"-receipt",...data,usage:{cost:0.01,is_byok:false}});
      }
      if(path.includes("/generation?"))return Response.json({data:{id:"speech-real-id",total_cost:0.01,is_byok:false}});
      if(path.endsWith("/batches/batch-job"))return Response.json({id:"batch-job",status:"completed",usage:{cost:0.01,is_byok:false},results:[{custom_id:"item-0",response:{status_code:200,body:{choices:[{message:{content:"Hecho"}}]}}}]});
      if(path.endsWith("/videos/video-job"))return Response.json({id:"video-job",status:"completed",generation_id:"video-real-id",usage:{cost:0.01,is_byok:false}});
      throw new Error("Unexpected fixture request");
    });
    const provider=new ManagedMedia("not-a-key",[offer],transport,550);
    const make=()=>new ManagedGateway<MediaRequest,MediaQuote,ReturnType<ManagedMedia["catalog"]>[number]>(db,purchases,api,provider,1040000);
    const bytes=Buffer.alloc(44+32000);bytes.write("RIFF");bytes.writeUInt32LE(bytes.length-8,4);bytes.write("WAVEfmt ",8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(16000,24);bytes.writeUInt32LE(32000,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write("data",36);bytes.writeUInt32LE(32000,40);
    const request:MediaRequest={model:offer.id,kind,...(kind==="transcription"?{audio:{data:bytes.toString("base64"),format:"wav" as const}}:kind==="batch"?{prompts:["Hola"]}:{prompt:"Hola"}),
      ...(kind==="decisions"?{state:"The service is down."}:{}),...(kind==="speech"?{voice:"alloy"}:{}),...(kind==="video"?{duration:5}:{}),...(kind==="rerank"?{documents:["hola"]}:{})};
    return {provider,make,request,transport,offer};
  }
  it.each(["image","speech","transcription","video","embeddings","rerank","batch","decisions"] as const)("settles %s against the same wallet with full supplier funding cost +4 percent and no paid replay",async kind=>{
    const {provider,make,request,transport}=mediaFixture(kind);let owner="alice",app=Fastify();
    mountManagedMediaRoutes(app,provider,make(),purchases,()=>({userId:owner,apiKeyId:null}));
    const key="qualified-media-"+kind;
    try {
      const q=await app.inject({method:"POST",url:"/v1/managed/media/quote",payload:request});expect(q.statusCode).toBe(200);expect(q.json().maximumMicrounits).toBe(21944);
      expect(transport).not.toHaveBeenCalled();
      const payload={request,quoteToken:q.json().token},headers={"idempotency-key":key};
      const created=await app.inject({method:"POST",url:"/v1/managed/media/execute",headers,payload});expect([200,202]).toContain(created.statusCode);
      await app.close();app=Fastify(); // Status uses durable state through a new gateway and HTTP server.
      mountManagedMediaRoutes(app,provider,make(),purchases,()=>({userId:owner,apiKeyId:null}));
      const done=await app.inject({method:"POST",url:"/v1/managed/media/status",payload:{idempotencyKey:key}});
      expect(done.statusCode).toBe(200);expect(done.json()).toMatchObject({status:"completed",response:{mycellios:{creditsMicrounits:10972,fundingCostMicrounits:550,serviceFeeMicrounits:422}}});
      await app.inject({method:"POST",url:"/v1/managed/media/execute",headers,payload});
      await app.inject({method:"POST",url:"/v1/managed/media/status",payload:{idempotencyKey:key}});
      expect(transport.mock.calls.filter(([,i])=>i?.method==="POST")).toHaveLength(1);
      expect((await wallet.summary("account","alice")).availableMicrounits).toBe(1989028);expect(await wallet.reserved("alice")).toBe(0);
      owner="bob";expect((await app.inject({method:"POST",url:"/v1/managed/media/status",payload:{idempotencyKey:key}})).statusCode).toBe(404);
      expect((await wallet.summary("account","bob")).availableMicrounits).toBe(0);
    }finally{await app.close();}
  });
  it("pins the signed media billing contract and refuses a changed unit price before reserving or calling the supplier",async()=>{
    const {provider,make,request,transport,offer}=mediaFixture("image"),service=make(),quote=await service.quote("alice",request);
    offer.costContract!.sourceDigest="sha256:"+"b".repeat(64);
    await expect(service.execute("alice",null,"changed-media-contract",request,quote.token)).rejects.toThrow("managed_price_changed");
    expect(await wallet.reserved("alice")).toBe(0);expect(transport).not.toHaveBeenCalled();expect(await purchases.find("alice","changed-media-contract")).toBeUndefined();
  });
  it("reports insufficient Credits before any supplier call and permits the same unsubmitted request key after funding",async()=>{
    const {provider,make,request,transport}=mediaFixture("image"),app=Fastify(),service=make();mountManagedMediaRoutes(app,provider,service,purchases,()=>({userId:"bob",apiKeyId:null}));
    try {
      const quote=await service.quote("bob",request),payload={request,quoteToken:quote.token},headers={"idempotency-key":"insufficient-media-request"};
      const rejected=await app.inject({method:"POST",url:"/v1/managed/media/execute",payload,headers});
      expect(rejected.json()).toMatchObject({status:"not_submitted",code:"insufficient_contribution_credits"});expect(transport).not.toHaveBeenCalled();
      await db.raw.prepare("INSERT INTO economic_promotional_grants(id,account_id,issued_by,reason,amount_microunits,created_at,expires_at) VALUES('bob-test-only','bob','test','isolated',100000,?,?)").run(Date.now(),Date.now()+60000);
      const accepted=await app.inject({method:"POST",url:"/v1/managed/media/execute",payload,headers});expect(accepted.json().status).toBe("completed");
      expect((await wallet.summary("account","bob")).availableMicrounits).toBe(89028);
    }finally{await app.close();}
  });
  it("awards both verified referral accounts once, expires both grants in 14 days and spends the invitee reward on managed media",async()=>{
    const referrals=new Referrals(db,"isolated-referral-wallet-pepper-not-production");await referrals.initialize();const now=Date.now();
    const person=(userId:string)=>({userId,email:userId+"@example.test",emailVerified:true});
    const invite=(await referrals.invite(person("alice"),now))!,receipt=(await referrals.visit(invite.code,undefined,now))!;
    await db.raw.prepare("UPDATE api_accounts SET created_at=? WHERE user_id='bob'").run(now+1);
    expect((await referrals.redeem(person("bob"),receipt,now+2)).status).toBe("awarded");
    expect((await referrals.redeem(person("bob"),receipt,now+3)).status).toBe("already_awarded");
    const grants=await db.raw.prepare("SELECT amount_microunits,expires_at,created_at FROM economic_promotional_grants WHERE id<>'test-funds'").all();
    expect(grants).toHaveLength(2);for(const grant of grants){expect(grant.amount_microunits).toBe(1000000);expect(Number(grant.expires_at)-Number(grant.created_at)).toBe(14*86400000);}
    const {make,request}=mediaFixture("embeddings"),service=make(),quote=await service.quote("bob",request);
    expect((await service.execute("bob",null,"spend-real-referral-fixture",request,quote.token)).status).toBe("completed");
    expect((await wallet.summary("account","bob")).availableMicrounits).toBe(989028);expect((await wallet.summary("account","alice")).availableMicrounits).toBe(3000000);
    await service.execute("bob",null,"spend-real-referral-fixture",request,quote.token);
    expect((await wallet.summary("account","bob")).availableMicrounits).toBe(989028);
  });
  it("creates only a hosted test checkout with server-owned amounts, and grants nothing before a signed payment",async()=>{
    const app=Fastify(),topups=new WalletTopups(db),transport=vi.fn<typeof fetch>().mockResolvedValue(Response.json({id:"cs_fixture",url:"https://checkout.stripe.com/c/pay/test",livemode:false}));
    mountWalletTopups(app,topups,{secretKey:"sk_test_fixture",successUrl:"http://127.0.0.1/success",cancelUrl:"http://127.0.0.1/cancel",webhookSecrets:["whsec_fixture_1234567890"],livemode:false},()=>({userId:"alice"}),transport);
    try {
      const result=await app.inject({method:"POST",url:"/v1/wallet/checkout",headers:{"idempotency-key":"checkout-fixture"},payload:{dollars:5,credits:500000}});
      expect(result.statusCode).toBe(200);expect(result.json().credits).toBe(5);
      const sent=new URLSearchParams(String(transport.mock.calls[0]![1]?.body));
      expect(sent.get("line_items[0][price_data][unit_amount]")).toBe("500");expect(sent.get("metadata[purpose]")).toBe("mycellios-wallet-v1");
      expect((await wallet.summary("account","alice")).availableMicrounits).toBe(2000000);
      expect((await app.inject({method:"POST",url:"/webhooks/v1/wallet-stripe",payload:{}})).statusCode).toBe(401);
    } finally {await app.close();}
  });
  it("verified new Credit payments fund the shared wallet once, without creating legacy token grants",async()=>{
    const topups=new WalletTopups(db);await topups.initialize();
    const quote=await topups.quote("alice",5,"new-wallet-purchase");await topups.bind(String(quote.id),"cs_test_wallet");
    const secret="whsec_wallet_fixture_secret_123456";
    const verifier=new StripeBillingInbound({endpointSecrets:[secret],expectedLivemode:false});
    async function deliver(id:string,type:string,object:Record<string,unknown>) {
      const timestamp=Math.floor(Date.now()/1000);
      const raw=Buffer.from(JSON.stringify({id,type,livemode:false,created:timestamp,data:{object}}));
      const signature=`t=${timestamp},v1=${createHmac("sha256",secret).update(Buffer.concat([Buffer.from(timestamp+"."),raw])).digest("hex")}`;
      return await topups.receive(verifier,raw,signature);
    }
    const paid={id:"cs_test_wallet",mode:"payment",payment_status:"paid",currency:"usd",amount_total:500,payment_intent:"pi_wallet",
      metadata:{purpose:"mycellios-wallet-v1",quote_id:quote.id,account_id:"alice"}};
    await Promise.all([deliver("evt_wallet","checkout.session.completed",paid),deliver("evt_wallet","checkout.session.completed",paid)]);
    expect((await wallet.summary("account","alice")).availableMicrounits).toBe(7000000);
    expect((await api.getOrCreateAccount("alice")).tokenBalance).toBe(0);
    const hold=await purchases.reserve({usageId:(await api.beginUsage("alice",null,{model:input.model,messages:[]},true)).id,
      accountId:"alice",key:"paid-media-use",digest:"usage",provider:"mock",model:input.model,maximumUsd:"1"});
    await purchases.claim(hold.id,"alice");await purchases.settle({id:hold.id,accountId:"alice",receiptId:"paid-use",usd:"1",evidence:{}});
    expect((await wallet.summary("account","alice")).availableMicrounits).toBe(5960000);
    await deliver("evt_refund","charge.refunded",{payment_intent:"pi_wallet",currency:"usd",amount:500,amount_refunded:200});
    await deliver("evt_old_refund","charge.refunded",{payment_intent:"pi_wallet",currency:"usd",amount:500,amount_refunded:100});
    expect((await wallet.summary("account","alice")).availableMicrounits).toBe(3960000);
    await expect(deliver("evt_bad","checkout.session.completed",{...paid,amount_total:1000})).rejects.toThrow("mismatch");
    await expect(topups.receive(verifier,Buffer.from('{}'),'t=1,v1=forged')).rejects.toThrow();
    const early=await topups.quote("bob",5,"early-refund-wallet");await topups.bind(String(early.id),"cs_bob");
    await deliver("evt_bob_refund","charge.refunded",{payment_intent:"pi_bob",currency:"usd",amount:500,amount_refunded:200,
      metadata:{purpose:"mycellios-wallet-v1",quote_id:early.id}});
    expect((await wallet.summary("account","bob")).availableMicrounits).toBe(0);
    await deliver("evt_bob_paid","checkout.session.completed",{...paid,id:"cs_bob",payment_intent:"pi_bob",metadata:{purpose:"mycellios-wallet-v1",quote_id:early.id,account_id:"bob"}});
    expect((await wallet.summary("account","bob")).availableMicrounits).toBe(3000000);
  });
  it("keeps prompts/results and billing receipts private even after an accidental browser SELECT grant", async () => {
    await hold("private-request");
    await sql.unsafe(`GRANT SELECT ON ${schema}.economic_managed_purchases TO ${browserRole}`);
    const denied = await sql.begin(async tx => { await tx.unsafe(`SET LOCAL ROLE ${browserRole}`); return await tx.unsafe(`SELECT * FROM ${schema}.economic_managed_purchases`); });
    expect(denied).toHaveLength(0);
    const allowed = await sql.begin(async tx => { await tx.unsafe(`SET LOCAL ROLE ${nativeRole}`); return await tx.unsafe(`SELECT * FROM ${schema}.economic_managed_purchases`); });
    expect(allowed).toHaveLength(1);
  });
  it("reserves the cost plus 4 percent, settles actual cost exactly once and separates the fee", async () => {
    const h = await hold("single-request"); await purchases.claim(h.id, "alice");
    expect((await wallet.summary("account", "alice")).availableMicrounits).toBe(960000);
    const receipt = { id: h.id, accountId: "alice", receiptId: "invoice-one", usd: "0.5", evidence: { actual: true } };
    await purchases.settle(receipt); await purchases.settle(receipt);
    const summary = await wallet.summary("account", "alice");
    expect(summary).toMatchObject({ availableMicrounits: 1480000, reservedMicrounits: 0 });
    expect((await wallet.summary("platform", "platform")).balanceMicrounits).toBe(-1980000);
    expect(await db.raw.prepare("SELECT upstream_microunits,fee_microunits,total_microunits FROM economic_managed_purchases").get())
      .toMatchObject({ upstream_microunits: 500000, fee_microunits: 20000, total_microunits: 520000 });
    expect(await db.raw.prepare("SELECT COUNT(*) AS count FROM economic_contribution_evidence").get()).toMatchObject({ count: 0 });
  });
  it("does not overspend across concurrent reservations", async () => {
    const attempts = await Promise.allSettled([hold("purchase-one"), hold("purchase-two")]);
    expect(attempts.filter(v => v.status === "fulfilled")).toHaveLength(1);
    expect(await wallet.reserved("alice")).toBe(1040000);
  });
  it("enforces a persisted global operator budget, including unresolved purchases from previous days", async () => {
    const limited = new ManagedPurchases(db, wallet, 1500000); await limited.initialize();
    const first = await hold("operator-first"); await purchases.claim(first.id, "alice");
    await db.raw.prepare("UPDATE economic_managed_purchases SET created_at=? WHERE usage_id=?").run(Date.now() - 86400000, first.id);
    const usage = await api.beginUsage("alice", null, { model: input.model, messages: [] }, true);
    await expect(limited.reserve({ usageId: usage.id, accountId: "alice", key: "operator-second", digest: "second", provider: "mock",
      model: input.model, maximumUsd: "0.5" })).rejects.toThrow("operator_budget_exceeded");
  });
  it("does not reset an audited lifetime envelope after midnight or restart", async () => {
    const first=await hold("funded-yesterday","0.5");await purchases.claim(first.id,"alice");
    await purchases.settle({id:first.id,accountId:"alice",receiptId:"funded-invoice",usd:"0.5",evidence:{}});
    await db.raw.prepare("UPDATE economic_managed_purchases SET created_at=?,settled_at=? WHERE usage_id=?")
      .run(Date.now()-86400000,Date.now()-86400000,first.id);
    const limited=new ManagedPurchases(db,wallet,10000000,1000000);await limited.initialize();
    const usage=await api.beginUsage("alice",null,{model:input.model,messages:[]},true);
    await expect(limited.reserve({usageId:usage.id,accountId:"alice",key:"funded-today",digest:"today",provider:"mock",model:input.model,maximumUsd:"0.5"}))
      .rejects.toThrow("operator_budget_exceeded");
    expect(await wallet.reserved("alice")).toBe(0);
  });
  it("keeps uncertain prior-day spend inside the lifetime envelope across independent connections",async()=>{
    const h=await hold("old-uncertain-envelope","0.5");await purchases.claim(h.id,"alice");await purchases.uncertain(h.id);
    await db.raw.prepare("UPDATE economic_managed_purchases SET created_at=? WHERE usage_id=?").run(Date.now()-86400000,h.id);
    const other=await MeshDatabase.openPostgres(url!,schema);
    try{
      const otherLedger=new EconomicLedger(other,{receiptSigning:{keyId:"envelope-test",privateKey:generateKeyPairSync("ed25519").privateKey}});
      const limited=new ManagedPurchases(other,new ContributionCreditWallet(other,otherLedger,true),10000000,1000000);await limited.initialize();
      const usage=await api.beginUsage("alice",null,{model:input.model,messages:[]},true);
      await expect(limited.reserve({usageId:usage.id,accountId:"alice",key:"another-envelope",digest:"other",provider:"mock",model:input.model,maximumUsd:"0.5"}))
        .rejects.toThrow("operator_budget_exceeded");
      expect(await wallet.reserved("alice")).toBe(520000);
    }finally{await other.close();}
  });
  it("serializes lifetime reservations across accounts before consuming any audited balance",async()=>{
    await db.raw.prepare(`INSERT INTO economic_promotional_grants(id,account_id,issued_by,reason,amount_microunits,created_at,expires_at)
      VALUES ('bob-envelope','bob','test','test-only',1000000,?,?)`).run(Date.now(),Date.now()+600000);
    const limited=new ManagedPurchases(db,wallet,10000000,1000000);await limited.initialize();
    const usages=await Promise.all(["alice","bob"].map(account=>api.beginUsage(account,null,{model:input.model,messages:[]},true)));
    const other=await MeshDatabase.openPostgres(url!,schema);
    try{
      const otherLedger=new EconomicLedger(other,{receiptSigning:{keyId:"envelope-test",privateKey:generateKeyPairSync("ed25519").privateKey}});
      const otherWallet=new ContributionCreditWallet(other,otherLedger,true);await otherWallet.initialize();
      const competing=new ManagedPurchases(other,otherWallet,10000000,1000000);await competing.initialize();
      const attempts=await Promise.allSettled([limited,competing].map((store,i)=>store.reserve({usageId:usages[i]!.id,accountId:["alice","bob"][i]!,
        key:"envelope-account-"+i,digest:String(i),provider:"mock",model:input.model,maximumUsd:"0.5"})));
      expect(attempts.filter(x=>x.status==="fulfilled")).toHaveLength(1);
      expect((await wallet.reserved("alice"))+(await wallet.reserved("bob"))).toBe(520000);
    }finally{await other.close();}
  });
  it("shares the balance with existing native holds", async () => {
    const usage = await api.beginUsage("alice", null, { model: "native", messages: [] }, true);
    await db.raw.prepare(`INSERT INTO economic_credit_holds(id,account_id,request_digest,amount_microunits,status,created_at)
      VALUES (?,'alice','native',1200000,'reserved',?)`).run(usage.id, Date.now());
    await expect(hold("external-request")).rejects.toThrow("insufficient");
    expect(await wallet.reserved("alice")).toBe(1200000);
  });
  it("unknown outcomes retain the reservation through restart and cannot be casually refunded", async () => {
    const h = await hold("unknown-request"); await purchases.claim(h.id, "alice"); await purchases.uncertain(h.id);
    await expect(purchases.release(h.id, "alice")).rejects.toThrow("unconfirmed");
    const restarted = new ContributionCreditWallet(db, ledger); await restarted.initialize();
    expect((await restarted.summary("account", "alice")).availableMicrounits).toBe(960000);
    await purchases.release(h.id, "alice", true);
    expect((await wallet.summary("account", "alice")).availableMicrounits).toBe(2000000);
  });
  it("spent external credits stay spent even if new purchases/referrals are disabled", async () => {
    const h = await hold("disabled-request"); await purchases.claim(h.id, "alice");
    await purchases.settle({ id: h.id, accountId: "alice", receiptId: "invoice", usd: "1", evidence: {} });
    await db.raw.prepare("UPDATE economic_promotional_grants SET expires_at=?").run(Date.now() - 1);
    const restarted = new ContributionCreditWallet(db, ledger, false); await restarted.initialize();
    expect((await restarted.summary("account", "alice")).balanceMicrounits).toBe(0);
  });
  it("refuses another payer, over-budget receipts and changed invoices without moving money", async () => {
    const h = await hold("guarded-request"); await purchases.claim(h.id, "alice");
    await expect(purchases.settle({ id: h.id, accountId: "bob", receiptId: "x", usd: "1", evidence: {} })).rejects.toThrow("not_found");
    await expect(purchases.settle({ id: h.id, accountId: "alice", receiptId: "x", usd: "2", evidence: {} })).rejects.toThrow("outside_reservation");
    await purchases.settle({ id: h.id, accountId: "alice", receiptId: "x", usd: "1", evidence: {} });
    await expect(purchases.settle({ id: h.id, accountId: "alice", receiptId: "x", usd: "0.5", evidence: {} })).rejects.toThrow("conflict");
    expect((await wallet.summary("account", "alice")).availableMicrounits).toBe(960000);
  });
  it("does not let one upstream invoice debit two purchases", async () => {
    const first = await hold("invoice-first", "0.5"), second = await hold("invoice-second", "0.5");
    await purchases.claim(first.id, "alice"); await purchases.claim(second.id, "alice");
    await purchases.settle({ id: first.id, accountId: "alice", receiptId: "same-invoice", usd: "0.2", evidence: {} });
    await expect(purchases.settle({ id: second.id, accountId: "alice", receiptId: "same-invoice", usd: "0.2", evidence: {} })).rejects.toMatchObject({ code: "23505" });
    expect((await wallet.summary("account", "alice")).availableMicrounits).toBe(1272000);
  });
  it("executes the accepted quote once and replays the same paid response, even after restart", async () => {
    const { service, transport } = await gateway(); transport.mockResolvedValueOnce(result());
    const quote = await service.quote("alice", input);
    const responses = await Promise.all(Array.from({ length: 8 }, () => service.execute("alice", null, "same-paid-request", input, quote.token)));
    expect(responses.some(r => r.status === "completed")).toBe(true);
    const replay = await service.execute("alice", null, "same-paid-request", input, "expired-token");
    expect(replay).toMatchObject({ status: "completed", response: { mycellios: { creditsMicrounits: 11, serviceFeeBasisPoints: 400 } } });
    expect(transport).toHaveBeenCalledTimes(2); // One catalog GET and exactly one inference POST.
    expect(await db.raw.prepare("SELECT COUNT(*) AS count FROM api_usage").get()).toMatchObject({ count: 1 });
    expect((await api.getOrCreateAccount("alice")).tokenBalance).toBe(0); // No second token-currency charge.
    expect((await wallet.summary("account", "alice")).availableMicrounits).toBe(1999989);
  });
  it("binds quote to its payer, body and cost; rejects altered and expired quotes", async () => {
    const { service, transport } = await gateway(); const quote = await service.quote("alice", input);
    await expect(service.execute("bob", null, "bob-request", input, quote.token)).rejects.toThrow("changed");
    await expect(service.execute("alice", null, "changed-request", { ...input, max_tokens: 11 }, quote.token)).rejects.toThrow("changed");
    await expect(service.execute("alice", null, "invalid-request", input, quote.token + "x")).rejects.toThrow("invalid");
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 61000);
    try { await expect(service.execute("alice", null, "expired-request", input, quote.token)).rejects.toThrow("expired"); }
    finally { clock.mockRestore(); }
    expect(transport).toHaveBeenCalledTimes(1);
    expect(await wallet.reserved("alice")).toBe(0);
  });
  it("keeps missing-cost/timeouts pending without retry or fabricated free success", async () => {
    const { service, transport } = await gateway(); transport.mockRejectedValueOnce(new Error("timeout"));
    const quote = await service.quote("alice", input);
    expect(await service.execute("alice", null, "timeout-request", input, quote.token)).toMatchObject({ status: "pending_reconciliation" });
    await service.execute("alice", null, "timeout-request", input, quote.token);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(await wallet.reserved("alice")).toBeGreaterThan(0);
    expect(await db.raw.prepare("SELECT status FROM api_usage").get()).toMatchObject({ status: "pending" });
  });
  it("rolls back a billing interruption, then reconciles its stored receipt without another POST", async () => {
    const { service, transport } = await gateway(); transport.mockResolvedValueOnce(result());
    const complete = vi.spyOn(api, "completeUsage").mockRejectedValueOnce(new Error("injected DB failure"));
    const quote = await service.quote("alice", input);
    expect(await service.execute("alice", null, "reconcile-request", input, quote.token)).toMatchObject({ status: "pending_reconciliation" });
    expect(await wallet.reserved("alice")).toBeGreaterThan(0);
    expect(await service.reconcile("alice", "reconcile-request")).toMatchObject({ status: "completed" });
    expect(await wallet.reserved("alice")).toBe(0);
    expect(transport).toHaveBeenCalledTimes(2); complete.mockRestore();
  });
  it("HTTP quote/execute requires the account boundary and keeps upstream errors private", async () => {
    const { service, transport } = await gateway(); const app = Fastify();
    mountManagedProviderRoutes(app, { gateway: service, account: req => {
      if (req.headers.authorization !== "Bearer test-account") throw Object.assign(new Error("unauthorized"), { statusCode: 401 });
      return { userId: "alice", apiKeyId: null };
    } });
    try {
      expect((await app.inject({ method: "GET", url: "/v1/managed/models" })).statusCode).toBe(401);
      const headers = { authorization: "Bearer test-account" };
      const quote = (await app.inject({ method: "POST", url: "/v1/managed/quote", headers, payload: input })).json();
      transport.mockResolvedValueOnce(result());
      const response = await app.inject({ method: "POST", url: "/v1/managed/execute", headers: { ...headers, "idempotency-key": "http-request" },
        payload: { request: input, quoteToken: quote.token } });
      expect(response.statusCode).toBe(200); expect(response.json().status).toBe("completed");
      expect(response.body).not.toContain("test-not-a-real-key"); expect(response.body).not.toContain("openrouter");
    } finally { await app.close(); }
  });
  it("the compatible chat endpoint streams tools, settles before DONE and replays without inference", async () => {
    const { service, transport } = await gateway(); const app = Fastify();
    app.post("/v1/chat/completions", (req, reply) => handleManagedChat(req, reply, service, { userId: "alice", apiKeyId: null }));
    const body = { ...input, stream: true };
    const event = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
    const stream = event({ id: "gen-stream", created: 1, choices: [{ index: 0, delta: { role: "assistant", content: "Hi" }, finish_reason: null }] })
      + event({ id: "gen-stream", created: 1, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })
      + event({ id: "gen-stream", created: 1, choices: [], usage: { cost: 0.00001, prompt_tokens: 2, completion_tokens: 3 } }) + "data: [DONE]\n\n";
    transport.mockResolvedValueOnce(new Response(stream, { headers: { "content-type": "text/event-stream" } }));
    const headers = { "x-mycellios-funding": "contribution-credits", "idempotency-key": "stream-request" };
    try {
      const first = await app.inject({ method: "POST", url: "/v1/chat/completions", headers, payload: body });
      expect(first.statusCode).toBe(200); expect(first.body).toContain('"content":"Hi"'); expect(first.body).toContain("data: [DONE]");
      expect(first.body).not.toContain('"cost"');
      expect((await wallet.summary("account", "alice")).availableMicrounits).toBe(1999989);
      const replay = await app.inject({ method: "POST", url: "/v1/chat/completions", headers, payload: body });
      expect(replay.body).toContain('"content":"Hi"'); expect(replay.body).toContain("data: [DONE]");
      expect(transport).toHaveBeenCalledTimes(2);
    } finally { await app.close(); }
  });
  it("checks the user's request budget before contacting paid inference", async () => {
    const { service, transport } = await gateway(); const app = Fastify();
    app.post("/v1/chat/completions", (req, reply) => handleManagedChat(req, reply, service, { userId: "alice", apiKeyId: null }));
    try {
      const response = await app.inject({ method: "POST", url: "/v1/chat/completions", payload: input,
        headers: { "x-mycellios-funding": "contribution-credits", "idempotency-key": "budget-request", "x-mycellios-max-credit-microunits": "1" } });
      expect(response.statusCode).toBe(400); expect(transport).toHaveBeenCalledTimes(1);
      expect(await wallet.reserved("alice")).toBe(0);
    } finally { await app.close(); }
  });
});
