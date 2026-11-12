import { describe, expect, it, vi, afterEach } from "vitest";
import { effectiveFundingCostBasisPoints,managedCharge, markedUpUnitPrice, tokenCost, usdAtoms } from "../src/economy/managed-pricing.js";
import { ManagedOpenRouter, MANAGED_MODEL_PREFIX, parseManagedProviderJson } from "../src/coordinator/managed-openrouter.js";
import { readManagedProviderConfig } from "../src/core/managed-provider-config.js";
import { readManagedTextStream } from "../src/coordinator/managed-text-stream.js";
import { nativeCreditMetadata } from "../src/coordinator/model-credit-pricing.js";
import type { EconomicLedger } from "../src/economy/economic-ledger.js";

const model = { id: "vendor/text", name: "Text model", context_length: 131072,
  architecture: { output_modalities: ["text"] }, pricing: { prompt: "0.000001", completion: "0.000002", request: "0" } };
const request = { model: MANAGED_MODEL_PREFIX + model.id, messages: [{ role: "user", content: "Hello" }], max_tokens: 10 };
afterEach(() => vi.useRealTimers());
describe("managed exact prices", () => {
  it("covers effective supplier fees before adding the Mycellios 4 percent, with no free positive-cost requests",()=>{
    expect(managedCharge("1",550)).toMatchObject({upstreamMicrounits:1000000,fundingCostMicrounits:55000,serviceFeeMicrounits:42200,totalMicrounits:1097200});
    expect(markedUpUnitPrice("0.000001",550)).toBe("0.0000010972");
    expect(managedCharge("0",550).totalMicrounits).toBe(0);
    expect(managedCharge("0.000000000001",550).totalMicrounits).toBe(1);
    expect(()=>managedCharge("1",-1)).toThrow("funding_cost_invalid");
    expect(effectiveFundingCostBasisPoints("105.5","100")).toBe(550);
    expect(effectiveFundingCostBasisPoints("5.8","5")).toBe(1600);
    expect(effectiveFundingCostBasisPoints("1.000001","1")).toBe(1);
    expect(()=>effectiveFundingCostBasisPoints("1","0")).toThrow("funding_receipt_invalid");
  });
  it("publishes native route price bounds without the external 4 percent markup", async () => {
    const resolve = vi.fn().mockResolvedValueOnce({ inputMicrounitsPerToken: 2, outputMicrounitsPerToken: 3 })
      .mockResolvedValueOnce({ inputMicrounitsPerToken: 4, outputMicrounitsPerToken: 1 });
    const ledger = { resolvePricingPolicy: resolve } as unknown as EconomicLedger;
    expect(await nativeCreditMetadata(ledger, { id: "native", replicas: 1, pipelines: 1 })).toEqual({
      processing: "network", creditEligible: true, pricing: { currency: "credits", unit: "token", serviceFeeBasisPoints: 0,
        estimate: "maximum", input: "0.000004", output: "0.000003" } });
  });
  it("does not describe an unpriced native route as free", async () => {
    const ledger = { resolvePricingPolicy: vi.fn().mockResolvedValue(null) } as unknown as EconomicLedger;
    expect(await nativeCreditMetadata(ledger, { id: "native", replicas: 1, pipelines: 0 })).toEqual({ processing: "network", creditEligible: false });
  });
  it.each([["1", 1000000, 40000, 1040000], ["0.25", 250000, 10000, 260000],
    ["0.000001", 1, 1, 2], ["0.0000001", 1, 0, 1], ["1e-6", 1, 1, 2], ["0", 0, 0, 0]])(
    "adds 4 percent once with safe wallet rounding to %s", (usd, cost, fee, total) => {
      expect(managedCharge(usd)).toMatchObject({ upstreamMicrounits: cost, serviceFeeMicrounits: fee, totalMicrounits: total });
    });
  it("preserves tiny unit prices and sums token costs before rounding", () => {
    expect(markedUpUnitPrice("0.000000125")).toBe("0.00000013");
    expect(tokenCost("0.000000125", "0.0000005", 1000000, 1000000)).toBe("0.625");
    expect(managedCharge("0.625").totalMicrounits).toBe(650000);
    expect(usdAtoms("1.25e-7")).toBe(125000000000n);
  });
  it.each(["-1", "NaN", "Infinity", "1,2", "01", "", "1e99", "0.0000000000000000001"])("rejects invalid money %s", v => {
    expect(() => managedCharge(v)).toThrow();
  });
  it("retains source money rather than parsing it through a float", () => {
    expect(parseManagedProviderJson('{"usage":{"cost":0.000000123456789123}}')).toEqual({ usage: { cost: "0.000000123456789123" } });
  });
});
describe("managed private upstream adapter", () => {
  it("discovers every modality, keeps unknown costs unavailable and never sends inference during discovery",async()=>{
    const transport=vi.fn<typeof fetch>().mockResolvedValue(Response.json({data:[model,
      {...model,id:"vendor/image",architecture:{input_modalities:["text"],output_modalities:["image"]}},
      {...model,id:"vendor/embedding",architecture:{output_modalities:["embeddings"]}},
      {...model,id:"vendor/special",pricing:{...model.pricing,unknown_fee:"0.01"}}]}));
    const provider=new ManagedOpenRouter("fixture",["*"],transport,550);await provider.refresh();
    expect(String(transport.mock.calls[0]?.[0]).endsWith("/models?output_modalities=all")).toBe(true);
    expect(provider.inventory()).toHaveLength(4);expect(provider.catalog()).toHaveLength(1);
    expect(provider.inventory().filter(m=>!m.available)).toHaveLength(3);
    expect(transport.mock.calls.every(([,init])=>init?.method==="GET")).toBe(true);
  });
  it("admits exact-zero chat for an unfunded account policy, enforces zero supplier prices and never chooses paid fallback",async()=>{
    const transport=vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({data:[model,{...model,id:"vendor/free",pricing:{prompt:"0",completion:"0"}}]}));
    const provider=new ManagedOpenRouter("fixture",["*"],transport);await provider.refresh();
    expect(provider.catalog().map(m=>m.id)).toEqual(["mycellios/managed/vendor/free"]);
    expect(provider.inventory().find(m=>m.id.endsWith("/text"))?.reason).toBe("funding_cost_not_configured");
    const q=provider.quote({...request,model:"mycellios/managed/vendor/free"});expect(q.maximumMicrounits).toBe(0);
    expect(q.body.provider).toMatchObject({allow_fallbacks:false,require_parameters:true,max_price:{prompt:0,completion:0,request:0,image:0}});
    transport.mockResolvedValueOnce(new Response('{"id":"gen-free","choices":[{}],"usage":{"cost":0,"prompt_tokens":1,"completion_tokens":1}}'));
    expect((await provider.execute(q)).usd).toBe("0");expect(transport.mock.calls.filter(([,i])=>i?.method==="POST")).toHaveLength(1);
  });
  it("reserves fixed per-request charges and tiered token prices with supplier fees and upstream rate caps",async()=>{
    const transport=vi.fn<typeof fetch>().mockResolvedValue(Response.json({data:[{...model,pricing:{...model.pricing,request:"0.1",overrides:[{min_prompt_tokens:100,prompt:"0.000005",request:"0.2"}]}}]}));
    const provider=new ManagedOpenRouter("fixture",["*"],transport,550);await provider.refresh();
    const q=provider.quote(request);expect(Number(q.maximumUsd)).toBeGreaterThan(0.2);
    expect(q.maximumMicrounits).toBe(managedCharge(q.maximumUsd,550).totalMicrounits);
    expect(q.body.provider.max_price).toEqual({prompt:5,completion:2,request:0.2,image:0});
    expect(provider.catalog()[0]?.pricing.request).toBe("0.21944");
  });
  it("automatically discovers more than a hundred compatible models and refreshes new arrivals without a named list",async()=>{
    const rows=Array.from({length:160},(_,i)=>({...model,id:`vendor/model-${i}`}));
    const transport=vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({data:rows})).mockResolvedValueOnce(Response.json({data:[...rows.slice(1),{...model,id:"new-vendor/new-model"}]}));
    const provider=new ManagedOpenRouter("fixture",["*"],transport,0);await provider.refresh();
    expect(provider.catalog()).toHaveLength(160);expect(provider.catalog().every(m=>m.owned_by==="mycellios"&&m.pricing.serviceFeeBasisPoints===400)).toBe(true);
    await provider.refresh();expect(provider.catalog()).toHaveLength(160);
    expect(provider.catalog().some(m=>m.id==="mycellios/managed/new-vendor/new-model")).toBe(true);
    expect(provider.catalog().some(m=>m.id==="mycellios/managed/vendor/model-0")).toBe(false);
    expect(transport.mock.calls.every(([,init])=>init?.method==="GET")).toBe(true);
  });
  it("merges native network and automatically discovered external models into one first-party catalog",async()=>{
    const provider=new ManagedOpenRouter("fixture",["*"],vi.fn<typeof fetch>().mockResolvedValue(Response.json({data:[model]})),0);await provider.refresh();
    const {mycelliosModelCatalog}=await import("../src/coordinator/model-credit-pricing.js");
    const ledger={resolvePricingPolicy:vi.fn().mockResolvedValue({inputMicrounitsPerToken:1,outputMicrounitsPerToken:2})} as unknown as EconomicLedger;
    const catalog=await mycelliosModelCatalog([{id:"network-text",replicas:1,pipelines:0}],ledger,{catalog:async()=>provider.catalog()});
    expect(catalog.data).toHaveLength(2);expect(catalog.data.every(row=>row.owned_by==="mycellios")).toBe(true);
    expect(catalog.data.map(row=>row.processing)).toEqual(["network","external"]);
  });
  async function fixture(rows: unknown[] = [model]) {
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ data: rows }));
    const provider = new ManagedOpenRouter("private-shared-key", [model.id], transport,0);
    await provider.refresh();
    return { provider, transport };
  }
  it("publishes Mycellios and final credits, with honest external processing", async () => {
    const { provider, transport } = await fixture([model, { ...model, id: "not-approved" }]);
    const catalog = provider.catalog();
    expect(catalog).toHaveLength(1);
    expect(catalog[0]).toMatchObject({ owned_by: "mycellios", processing: "external", modality: "text",
      pricing: { input: "0.00000104", output: "0.00000208", serviceFeeBasisPoints: 400 } });
    expect(JSON.stringify(catalog)).not.toContain("openrouter");
    expect(JSON.stringify(catalog)).not.toContain("private-shared-key");
    expect(transport.mock.calls[0]![1]).toMatchObject({ method: "GET", redirect: "error" });
  });
  it.each([{ ...model, pricing: {} }, { ...model, pricing: { ...model.pricing, request: "-1" } },
    { ...model, pricing: { ...model.pricing, web_search: "0.01" },supported_parameters:["web_search_options"] },
    { ...model, architecture: { output_modalities: ["video"] } }, { ...model, architecture: { output_modalities: ["text","image"] } }, { ...model, context_length: 0 }])(
    "does not offer unknown costs or unsupported capabilities", async row => {
      expect((await fixture([row])).provider.catalog()).toEqual([]);
    });
  it("pins the selected upstream model, budgets and sanitized receipt without rerouting", async () => {
    const { provider, transport } = await fixture();
    transport.mockResolvedValueOnce(new Response('{"id":"gen-one","choices":[{"index":0,"message":{"role":"assistant","content":"Hi"},"finish_reason":"stop"}],"usage":{"cost":0.000012,"prompt_tokens":2,"completion_tokens":3}}'));
    const quote = provider.quote({ ...request, store: false });
    const result = await provider.execute(quote);
    expect(quote.maximumMicrounits).toBeGreaterThan(12);
    expect(result.usd).toBe("0.000012");
    expect(result.response).toMatchObject({ model: request.model, usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } });
    const sent = JSON.parse(String(transport.mock.calls[1]![1]!.body));
    expect(sent).toMatchObject({ model: model.id, provider: { allow_fallbacks: false }, max_tokens: 10, stream: false, store: false });
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it("admits optional search pricing without enabling search, and quotes upper bounds for tiered cache/reasoning prices",async()=>{
    const {provider}=await fixture([{...model,pricing:{...model.pricing,web_search:"0.01",internal_reasoning:"0.000003",input_cache_write:"0.000004",overrides:[{min_prompt_tokens:200000,prompt:"0.000005",completion:"0.000006"}]}}]);
    expect(provider.catalog()[0]?.pricing).toMatchObject({input:"0.0000052",output:"0.00000624",estimate:"maximum"});
    const quote=provider.quote(request);expect(quote.body.plugins).toEqual([{id:"web",enabled:false}]);
    expect(()=>provider.quote({...request,plugins:[{id:"web"}]})).toThrow("unsupported");
    expect(()=>provider.quote({...request,tools:[{type:"openrouter:web_search"}]})).toThrow();
  });
  it.each([{ ...request, plugins: [{ id: "web" }] }, { ...request, provider: { order: ["other"] } },
    { ...request, stream: "invalid" }, { ...request, max_tokens: -1 },
    { ...request, store: true },
    { ...request, messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "http://internal/" } }] }] }])(
    "rejects unqualified paid options before a POST", async body => {
      const { provider, transport } = await fixture();
      expect(() => provider.quote(body)).toThrow();
      expect(transport).toHaveBeenCalledTimes(1);
    });
  it("never retries after an uncertain submission or missing cost", async () => {
    const { provider, transport } = await fixture();
    transport.mockRejectedValueOnce(new Error("timeout"));
    await expect(provider.execute(provider.quote(request))).rejects.toThrow("timeout");
    expect(transport).toHaveBeenCalledTimes(2);
    transport.mockResolvedValueOnce(Response.json({ id: "gen-x", choices: [{}], usage: { prompt_tokens: 1, completion_tokens: 2 } }));
    await expect(provider.execute(provider.quote(request))).rejects.toThrow("receipt_missing");
    expect(transport).toHaveBeenCalledTimes(3);
  });
  it("withdraws stale offers instead of advertising old prices", async () => {
    const { provider } = await fixture(); vi.useFakeTimers(); vi.advanceTimersByTime(300001);
    expect(provider.catalog()).toEqual([]);
    expect(() => provider.quote(request)).toThrow("model_unavailable");
  });
});
describe("operator managed configuration", () => {
  it("requires an explicit valid effective funding cost for paid admission, never guesses fees",()=>{
    const env={MYCELLIOS_MANAGED_UPSTREAM:"openrouter",MYCELLIOS_MANAGED_PROVIDER_ENABLED:"true",MYCELLIOS_MANAGED_OPENROUTER_KEY:"fixture",MYCELLIOS_MANAGED_REQUEST_LIMIT_MICROUNITS:"1000000",MYCELLIOS_MANAGED_DAILY_LIMIT_MICROUNITS:"10000000"};
    expect(readManagedProviderConfig(env)?.fundingCostBasisPoints).toBeUndefined();
    expect(readManagedProviderConfig({...env,MYCELLIOS_MANAGED_FUNDING_COST_BASIS_POINTS:"550"})?.fundingCostBasisPoints).toBe(550);
    for(const value of ["","-1","NaN","0.5","100001"])expect(()=>readManagedProviderConfig({...env,MYCELLIOS_MANAGED_FUNDING_COST_BASIS_POINTS:value})).toThrow("funding_cost_invalid");
    expect(()=>readManagedProviderConfig({...env,MYCELLIOS_MANAGED_MEDIA_OFFERS:'[{"maximumUsd":"1"}]'})).toThrow("media_cost_contract_not_qualified");
  });
  it("defaults an explicitly enabled service to automatic catalog discovery, while retaining budget and key requirements",()=>{
    const env={MYCELLIOS_MANAGED_UPSTREAM:"openrouter",MYCELLIOS_MANAGED_PROVIDER_ENABLED:"true",MYCELLIOS_MANAGED_OPENROUTER_KEY:"fixture",MYCELLIOS_MANAGED_REQUEST_LIMIT_MICROUNITS:"1000000",MYCELLIOS_MANAGED_DAILY_LIMIT_MICROUNITS:"10000000"};
    expect(readManagedProviderConfig(env)?.modelAllowlist).toEqual(["*"]);
    expect(readManagedProviderConfig(env)?.mediaEnabled).toBe(false);
    expect(readManagedProviderConfig({...env,MYCELLIOS_MANAGED_MEDIA_ENABLED:"true"})?.mediaEnabled).toBe(true);
    expect(()=>readManagedProviderConfig({...env,MYCELLIOS_MANAGED_MODEL_ALLOWLIST:'["*","vendor/text"]'})).toThrow("invalid");
    expect(readManagedProviderConfig({...env,MYCELLIOS_MANAGED_MODEL_ALLOWLIST:'["vendor/text"]'})?.modelAllowlist).toEqual(["vendor/text"]);
  });
  it("is off by default, even if another provider's key exists", () => {
    expect(readManagedProviderConfig({ OPENROUTER_API_KEY: "personal" })).toBeUndefined();
  });
  it("requires explicit model and spending limits without echoing secrets", () => {
    expect(() => readManagedProviderConfig({ MYCELLIOS_MANAGED_UPSTREAM: "openrouter", MYCELLIOS_MANAGED_PROVIDER_ENABLED: "true", MYCELLIOS_MANAGED_OPENROUTER_KEY: "secret" })).toThrow("managed_configuration_invalid");
    expect(readManagedProviderConfig({ MYCELLIOS_MANAGED_UPSTREAM: "openrouter", MYCELLIOS_MANAGED_PROVIDER_ENABLED: "true", MYCELLIOS_MANAGED_OPENROUTER_KEY: "secret",
      MYCELLIOS_MANAGED_MODEL_ALLOWLIST: '["vendor/text"]', MYCELLIOS_MANAGED_REQUEST_LIMIT_MICROUNITS: "1000000",
      MYCELLIOS_MANAGED_DAILY_LIMIT_MICROUNITS: "10000000" }))
      .toMatchObject({ modelAllowlist: ["vendor/text"], requestLimitMicrounits: 1000000 });
  });
});
describe("managed real SSE parsing", () => {
  const event = (value: unknown) => `data: ${JSON.stringify(value)}\r\n\r\n`;
  const delta = (value: unknown, finish: string | null = null) => ({ id: "gen-stream", created: 1, model: "vendor/text",
    choices: [{ index: 0, delta: value, finish_reason: finish }] });
  const usage = event({ id: "gen-stream", created: 1, choices: [], usage: { cost: 0.00001, prompt_tokens: 2, completion_tokens: 3 } });
  function response(text: string) {
    const bytes = new TextEncoder().encode(text);
    return new Response(new ReadableStream({ start(controller) {
      for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
      controller.close();
    } }));
  }
  it("streams fragmented deltas immediately, preserves exact usage and withholds completion until billing", async () => {
    const chunks: Record<string, unknown>[] = [];
    const result = await readManagedTextStream(response(event(delta({ role: "assistant", content: "Ho" })) + event(delta({ content: "la" }))
      + event(delta({}, "stop")) + usage + "data: [DONE]\r\n\r\n"), AbortSignal.timeout(1000), parseManagedProviderJson, request.model, c => chunks.push(c));
    expect(result).toMatchObject({ usage: { cost: "0.00001" }, choices: [{ message: { content: "Hola" }, finish_reason: "stop" }] });
    expect(chunks[0]).toMatchObject({ model: request.model, choices: [{ delta: { content: "Ho" } }] });
    expect(chunks.flatMap(c => c.choices as Array<{ finish_reason: unknown }>).every(c => c.finish_reason === null)).toBe(true);
    expect(JSON.stringify(chunks)).not.toContain("cost");
  });
  it("assembles incremental ordinary tool calls without the Qwen XML envelope", async () => {
    const text = event(delta({ tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "read", arguments: '{"p":' } }] }))
      + event(delta({ tool_calls: [{ index: 0, function: { arguments: '"x"}' } }] }, "tool_calls")) + usage + "data: [DONE]\n\n";
    const result = await readManagedTextStream(response(text), AbortSignal.timeout(1000), parseManagedProviderJson, request.model);
    expect(result.choices[0]?.message).toMatchObject({ tool_calls: [{ id: "call_1", function: { name: "read", arguments: '{"p":"x"}' } }] });
  });
  it.each([
    event(delta({ content: "partial" })),
    event(delta({ content: "partial" }, "stop")) + "data: [DONE]\n\n",
    event(delta({ content: "partial" })) + usage + "data: [DONE]\n\n",
    event(delta({ content: "partial" })) + event({ error: { message: "private upstream failure" } }),
  ])("rejects incomplete or failed streams rather than claiming a free completed request", async text => {
    await expect(readManagedTextStream(response(text), AbortSignal.timeout(1000), parseManagedProviderJson, request.model)).rejects.toThrow();
  });
});
