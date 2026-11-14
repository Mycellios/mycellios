import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { ManagedAntseedGateway } from "../src/coordinator/managed-antseed-gateway.js";
import { readManagedProviderConfig } from "../src/core/managed-provider-config.js";
import { managedCharge } from "../src/economy/managed-pricing.js";
import { antseedGatewayFixture, gatewayKey, gatewayModel, gatewaySeller } from "./fixtures/managed-antseed-gateway.js";

const input = {model: gatewayModel, messages: [{role: "user", content: "Hello"}], max_tokens: 10};
const create = (f: ReturnType<typeof antseedGatewayFixture>, funding: number | null = 100) =>
  new ManagedAntseedGateway(gatewayKey, "http://127.0.0.1:8379", ["*"], funding, f.transport, "deepseek-bounded-v1");
afterEach(() => vi.useRealTimers());
describe("managed AntSeed gateway billing boundary (no paid upstream)", () => {
  it("exercises the actual HTTP transport, scoped cookie, SSE and receipt reads against a loopback fixture",async()=>{
    const f=antseedGatewayFixture(),server=Fastify();
    server.all("/*",async(req,reply)=>{
      const response=await f.transport("http://127.0.0.1"+req.url,{method:req.method,headers:req.headers as Record<string,string>,
        ...(req.body===undefined?{}:{body:JSON.stringify(req.body)})});
      reply.code(response.status);response.headers.forEach((v,k)=>reply.header(k,v));
      return reply.send(Buffer.from(await response.arrayBuffer()));
    });
    const base=await server.listen({host:"127.0.0.1",port:0});
    try {
      const a=new ManagedAntseedGateway(gatewayKey,base,["*"],100,fetch,"deepseek-bounded-v1");await a.refresh();
      expect((await a.execute(a.quote({...input,stream:true}),()=>{},async()=>{})).usd).toBe("0.000005");
      expect(f.inference()).toHaveLength(1);
    }finally{await server.close();}
  });
  it("authenticates a key-scoped ledger, discovers without inference, and never publishes secrets", async () => {
    const f = antseedGatewayFixture(), a = create(f); await a.refresh();
    expect(a.catalog()).toMatchObject([{id: gatewayModel, owned_by: "mycellios", processing: "external",
      pricing: {serviceFeeBasisPoints: 400, fundingCostBasisPoints: 100, input: "0.0000005252", output: "0.0000010504", estimate: "maximum"}}]);
    expect(f.inference()).toHaveLength(0); expect(JSON.stringify(a.inventory())).not.toContain(gatewayKey);
    vi.useFakeTimers(); vi.advanceTimersByTime(60001); expect(a.catalog()).toEqual([]);
  });
  it("keeps spend disabled when the actual supplier funding fee is unknown", async () => {
    const f = antseedGatewayFixture(), a = create(f, null); await a.refresh();
    expect(a.catalog()).toEqual([]); expect(a.inventory()[0]?.reason).toBe("funding_cost_not_configured");
    expect(() => a.quote(input)).toThrow("unavailable"); expect(f.inference()).toHaveLength(0);
  });
  it("keeps a stable public model when discovery adds the known vendor namespace",async()=>{
    const f=antseedGatewayFixture();f.model.id="deepseek/deepseek-v4-flash";
    const a=new ManagedAntseedGateway(gatewayKey,"http://127.0.0.1:8379",["deepseek-v4-flash"],100,f.transport,"deepseek-bounded-v1");
    await a.refresh();expect(a.catalog()[0]?.id).toBe(gatewayModel);
    expect(a.quote(input).body.model).toBe(gatewaySeller+"@deepseek-v4-flash");
    expect((await a.execute(a.quote(input),undefined,async()=>{})).usd).toBe("0.000005");expect(f.inference()).toHaveLength(1);
  });
  it("does not treat a namespaced-only seller as the exact bounded service",async()=>{
    const f=antseedGatewayFixture();f.model.id="deepseek/deepseek-v4-flash";f.model.peers[0]!.serviceId=f.model.id;
    const a=create(f);await a.refresh();expect(a.catalog()).toEqual([]);expect(f.inference()).toHaveLength(0);
  });
  it("selects current effective quality among cost-qualified peers and pins the quote across refreshes", async () => {
    const f = antseedGatewayFixture(), a = create(f);
    Object.assign(f.model.peers[0]!, {peerId: "0".repeat(40), effectiveReputationScore: 57});
    const healthy = {...f.model.peers[0]!, peerId: "9".repeat(40), effectiveReputationScore: 78};
    f.model.peers.push(healthy);
    f.model.peers.push({...healthy, peerId: "f".repeat(40), effectiveReputationScore: 99, outputUsdPerMillion: 2});
    await a.refresh(); const q = a.quote(input);
    expect(q.body.model).toBe(healthy.peerId + "@deepseek-v4-flash");
    expect(q.billingContext).toMatchObject({seller: healthy.peerId, input: "0.0000005", output: "0.000001"});
    Object.assign(healthy, {effectiveReputationScore: 2}); await a.refresh();
    expect(a.quote(input).body.model).toBe("0".repeat(40) + "@deepseek-v4-flash");
    expect(q.body.model).toBe("9".repeat(40) + "@deepseek-v4-flash");
    expect(f.inference()).toHaveLength(0);
  });
  it.each([undefined, null, "99", -1, 101, Number.NaN, Number.POSITIVE_INFINITY])(
    "does not trust missing or malformed effective quality %s", async score => {
      const f = antseedGatewayFixture(), a = create(f);
      Object.assign(f.model.peers[0]!, {effectiveReputationScore: score});
      f.model.peers.push({...f.model.peers[0]!, peerId: "b".repeat(40), effectiveReputationScore: 1} as any);
      await a.refresh(); expect(a.quote(input).body.model).toBe("b".repeat(40) + "@deepseek-v4-flash");
      expect(f.inference()).toHaveLength(0);
    });
  it("reserves the gateway-enforced upper bound including USDC rounding, funding fees and 4 percent", async () => {
    const f = antseedGatewayFixture(), a = create(f); await a.refresh();
    const q = a.quote(input), body = JSON.stringify(q.body);
    const micro = Math.ceil((Buffer.byteLength(body) + 8192 + 64) * 0.5 + 10);
    expect(q.maximumMicrounits).toBe(managedCharge(String(micro / 1000000), 100).totalMicrounits);
    expect(q.body.model).toBe(gatewaySeller + "@deepseek-v4-flash");
    expect(q.maximumMicrounits).toBeGreaterThan(4000);
  });
  it("persists intent and response before billing and obtains the actual attributed cost", async () => {
    const f = antseedGatewayFixture(), a = create(f); await a.refresh(); const jobs: unknown[] = [];
    const r = await a.execute(a.quote(input), undefined, async j => {jobs.push(structuredClone(j));});
    expect(jobs).toHaveLength(3); expect((jobs[0] as any).response).toBeUndefined();
    expect(r).toMatchObject({usd: "0.000005", inputTokens: 4, outputTokens: 2, response: {model: gatewayModel}});
    expect(managedCharge(r.usd, 100).totalMicrounits).toBe(6); expect(f.inference()).toHaveLength(1);
    expect(JSON.stringify(jobs)).not.toContain(gatewayKey);
    expect(new Headers(f.inference()[0]![1]?.headers).get("x-antseed-provider")).toBe("openai");
  });
  it("does not submit inference if the durable intent cannot be saved", async () => {
    const f = antseedGatewayFixture(), a = create(f); await a.refresh();
    await expect(a.execute(a.quote(input), undefined, async () => {throw Error("db down");})).rejects.toThrow("db down");
    expect(f.inference()).toHaveLength(0);
  });
  it("keeps a legacy gateway answer and settles its unique key/nonce/seller ledger receipt without a tag header", async () => {
    const f = antseedGatewayFixture(), a = create(f); f.omitGatewayTag(); await a.refresh(); const jobs: any[] = [];
    const result = await a.execute(a.quote({...input,stream:true}), undefined, async j => {jobs.push(structuredClone(j));});
    expect(jobs).toHaveLength(2); expect(jobs[1].tag).toBeUndefined();
    expect(jobs[1].response.choices[0].message.content).toBe("Hi");
    expect(result.receiptId).toBe("antseed-gateway:key-fixture:" + f.row.tag);
    expect(result.usd).toBe("0.000005"); expect(f.inference()).toHaveLength(1);
    expect((await a.recover(jobs[1]))?.receiptId).toBe(result.receiptId);
    expect(f.inference()).toHaveLength(1);
  });
  it("settles the paired legacy envelope against the actual token receipt without replaying inference", async () => {
    const f=antseedGatewayFixture();f.omitGatewayTag();
    const transport:typeof fetch=async(u,init)=>{
      const r=await f.transport(u,init);
      if(!String(u).endsWith("/v1/chat/completions"))return r;
      const rows=(await r.text()).split("\n").filter(l=>l.startsWith("data: {")).map(l=>JSON.parse(l.slice(6)));
      rows.unshift({id:"envelope",choices:[{index:0,delta:{role:"assistant",content:""},finish_reason:null}]});
      rows.at(-1)!.id="envelope";
      return new Response(rows.map(v=>`data: ${JSON.stringify(v)}\n\n`).join("")+"data: [DONE]\n\n",{headers:r.headers});
    };
    const a=new ManagedAntseedGateway(gatewayKey,"http://127.0.0.1:8379",["*"],100,transport,"deepseek-bounded-v1");await a.refresh();
    const result=await a.execute(a.quote({...input,stream:true}),undefined,async()=>{});
    expect(result.response.choices).toMatchObject([{message:{content:"Hi"}}]);expect(result.usd).toBe("0.000005");expect(f.inference()).toHaveLength(1);
  });
  it.each([{tag: "not-a-gateway-tag"}, {keyId: "other"}, {sellerPeerId: "b".repeat(40)}, {model: "other"}])(
    "still rejects a mismatched legacy receipt %j", async patch => {
      const f = antseedGatewayFixture(), a = create(f); f.omitGatewayTag(); await a.refresh(); Object.assign(f.row,patch);
      await expect(a.execute(a.quote(input),undefined,async()=>{})).rejects.toThrow("receipt_mismatch");
      expect(f.inference()).toHaveLength(1);
    });
  it("recovers late billing with ledger GETs and never repeats inference", async () => {
    const f = antseedGatewayFixture(), a = create(f); await a.refresh(); f.pending(true); let saved: unknown;
    await expect(a.execute(a.quote(input), undefined, async j => {saved = structuredClone(j);})).rejects.toThrow("receipt_pending");
    expect(await a.recover(saved)).toBeNull(); f.pending(false);
    expect(await a.recover(saved)).toMatchObject({usd: "0.000005"}); expect(f.inference()).toHaveLength(1);
  });
  it("waits for the signed spend feed after the final text frame using GETs only",async()=>{
    const f=antseedGatewayFixture();f.pending(true);let reads=0;
    const transport:typeof fetch=async(u,init)=>{
      const r=await f.transport(u,init);
      if(String(u).includes("/console/api/requests?q=mycellios-")&&!String(u).includes("preflight")&&++reads===1)f.pending(false);
      return r;
    };
    const a=new ManagedAntseedGateway(gatewayKey,"http://127.0.0.1:8379",["*"],100,transport,"deepseek-bounded-v1");await a.refresh();
    expect((await a.execute(a.quote({...input,stream:true}),undefined,async()=>{})).usd).toBe("0.000005");
    expect(reads).toBe(2);expect(f.inference()).toHaveLength(1);
  });
  it("leaves a lost response uncertain without inventing a refund or another paid request", async () => {
    const f = antseedGatewayFixture(), a = create(f); await a.refresh(); f.fail(); let saved: unknown;
    await expect(a.execute(a.quote(input), undefined, async j => {saved = structuredClone(j);})).rejects.toThrow("connection lost");
    expect(await a.recover(saved)).toBeNull(); expect(f.inference()).toHaveLength(1);
  });
  it.each([{inputTokens: 1}, {cachedInputTokens: 0}, {outputTokens: 1}, {spent: null}, {finishedAt: null}, {status: 502}])(
    "does not settle partial or unavailable receipt %j", async patch => {
      const f = antseedGatewayFixture(), a = create(f); await a.refresh(); Object.assign(f.row, patch);
      await expect(a.execute(a.quote(input), undefined, async () => {})).rejects.toThrow("receipt_pending");
      expect(f.inference()).toHaveLength(1);
    });
  it.each([{keyId: "other"}, {sellerPeerId: "b".repeat(40)}, {tag: "gw_other"}, {model: "other"}, {method: "GET"}, {path: "/other"}])(
    "refuses mismatched invoice %j", async patch => {
      const f = antseedGatewayFixture(), a = create(f); await a.refresh(); Object.assign(f.row, patch);
      await expect(a.execute(a.quote(input), undefined, async () => {})).rejects.toThrow("receipt_mismatch");
    });
  it("rejects duplicated charges for a single durable request", async () => {
    const f = antseedGatewayFixture(), a = create(f); await a.refresh(); f.duplicates();
    await expect(a.execute(a.quote(input), undefined, async () => {})).rejects.toThrow("ambiguous");
  });
  it("requires an explicit zero-cost receipt rather than treating absent spend as free", async () => {
    const f = antseedGatewayFixture(), a = create(f); await a.refresh(); f.row.spent = "0"; let saved: unknown;
    await expect(a.execute(a.quote(input), undefined, async j => {saved = structuredClone(j);})).rejects.toThrow("receipt_pending");
    f.row.servedFree = true; expect((await a.recover(saved))?.usd).toBe("0");
    expect(managedCharge("0", 100).totalMicrounits).toBe(0);
  });
  it("streams content and checkpoints the final response before waiting for the receipt", async () => {
    const f = antseedGatewayFixture(), a = create(f); await a.refresh(); const chunks: unknown[] = [];
    const r = await a.execute(a.quote({...input, stream: true}), c => {chunks.push(c);}, async () => {});
    expect(chunks).toContainEqual(expect.objectContaining({model: gatewayModel})); expect(r.response.choices).toMatchObject([{message: {content: "Hi"}}]);
  });
  it.each([{provider: {}}, {plugins: []}, {user: "victim"}, {max_completion_tokens: 10}, {tools: [{type: "web_search"}]}, {n: 2}])(
    "blocks unbudgeted routing, user attribution and paid tools %j", async extra => {
      const f = antseedGatewayFixture(), a = create(f); await a.refresh(); expect(() => a.quote({...input, ...extra})).toThrow(); expect(f.inference()).toHaveLength(0);
    });
  it.each(["other-model", "other/deepseek-v4-flash"]) ("does not sell an unqualified model %s", async name => {
    const f = antseedGatewayFixture(); f.model.id = name; const a = create(f); await a.refresh(); expect(a.catalog()).toEqual([]);
  });
  it("rejects unsafe transports, wrong secrets and an unqualified gateway contract", () => {
    expect(() => new ManagedAntseedGateway(gatewayKey, "http://example.com", ["*"], 0, fetch, "deepseek-bounded-v1")).toThrow();
    expect(() => new ManagedAntseedGateway(gatewayKey, "https://example.com", ["*"], 0)).toThrow();
  });
  it("loads the operator key from a private file without mistaking it for a buyer control secret", () => {
    const dir = mkdtempSync(join(tmpdir(), "mycellios-gateway-key-")), file = join(dir, "key");
    try {
      writeFileSync(file, gatewayKey);
      const env = {MYCELLIOS_MANAGED_PROVIDER_ENABLED: "true", MYCELLIOS_MANAGED_UPSTREAM: "antseed-gateway",
        MYCELLIOS_MANAGED_ANTSEED_GATEWAY_KEY_FILE: file, MYCELLIOS_MANAGED_ANTSEED_GATEWAY_BASE_URL: "https://example.com/gateway",
        MYCELLIOS_MANAGED_ANTSEED_GATEWAY_CONTRACT: "deepseek-bounded-v1", MYCELLIOS_MANAGED_REQUEST_LIMIT_MICROUNITS: "10000",
        MYCELLIOS_MANAGED_DAILY_LIMIT_MICROUNITS: "1000000"};
      expect(readManagedProviderConfig(env)).toMatchObject({antseedGatewayKey: gatewayKey, upstream: "antseed-gateway"});
      expect(() => readManagedProviderConfig({...env, MYCELLIOS_MANAGED_FUNDING_COST_BASIS_POINTS: "2"})).toThrow("funded_envelope_required");
      expect(readManagedProviderConfig({...env, MYCELLIOS_MANAGED_FUNDING_COST_BASIS_POINTS: "2", MYCELLIOS_MANAGED_TOTAL_LIMIT_MICROUNITS: "10402080"}))
        .toMatchObject({fundingCostBasisPoints: 2, totalLimitMicrounits: 10402080});
      expect(() => readManagedProviderConfig({...env, MYCELLIOS_MANAGED_TOTAL_LIMIT_MICROUNITS: "0"})).toThrow("budget_invalid");
      expect(() => readManagedProviderConfig({...env, MYCELLIOS_MANAGED_ANTSEED_GATEWAY_KEY: gatewayKey})).toThrow("ambiguous");
      expect(() => readManagedProviderConfig({...env, MYCELLIOS_MANAGED_MEDIA_ENABLED: "true"})).toThrow("not_qualified");
    } finally {rmSync(dir, {recursive: true});}
  });
});
