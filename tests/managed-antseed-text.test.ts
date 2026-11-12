import {afterEach,describe,expect,it,vi} from "vitest";
import Fastify from "fastify";
import {ManagedAntseedText} from "../src/coordinator/managed-antseed-text.js";
import {readManagedProviderConfig} from "../src/core/managed-provider-config.js";
import {ManagedTextRouter,managedTextBackend} from "../src/coordinator/managed-text-router.js";
import {antseedFixture,operatorSecret,seller} from "./fixtures/managed-antseed.js";

const input={model:"mycellios/managed/antseed/deepseek-test",messages:[{role:"user",content:"Hi"}],max_tokens:256};
const env={MYCELLIOS_MANAGED_PROVIDER_ENABLED:"true",MYCELLIOS_MANAGED_ANTSEED_CONTROL_SECRET:operatorSecret,
  MYCELLIOS_MANAGED_REQUEST_LIMIT_MICROUNITS:"2000000",MYCELLIOS_MANAGED_DAILY_LIMIT_MICROUNITS:"10000000"};
afterEach(()=>vi.useRealTimers());
describe("managed AntSeed operator selection",()=>{
  it("defaults to AntSeed, never takes an OpenRouter or personal key and requires operator limits",()=>{
    expect(readManagedProviderConfig(env)).toMatchObject({upstream:"antseed",antseedControlSecret:operatorSecret});
    expect(readManagedProviderConfig(env)?.openRouterKey).toBeUndefined();
    expect(()=>readManagedProviderConfig({...env,MYCELLIOS_MANAGED_ANTSEED_CONTROL_SECRET:undefined,MYCELLIOS_MANAGED_OPENROUTER_KEY:"personal"})).toThrow("control_required");
    expect(()=>readManagedProviderConfig({...env,MYCELLIOS_MANAGED_DAILY_LIMIT_MICROUNITS:"1"})).toThrow("configuration_invalid");
    expect(()=>readManagedProviderConfig({...env,MYCELLIOS_MANAGED_MEDIA_ENABLED:"true"})).toThrow("media_not_qualified");
    expect(readManagedProviderConfig({...env,MYCELLIOS_MANAGED_PROVIDER_ENABLED:"false"})).toBeUndefined();
  });
  it("refuses remote customer URLs and short control credentials",()=>{
    expect(()=>new ManagedAntseedText(operatorSecret,["*"],fetch,0,"https://attacker.test")).toThrow("configuration_invalid");
    expect(()=>new ManagedAntseedText("customer-key",["*"])).toThrow("configuration_invalid");
  });
});
describe("managed AntSeed catalog and receipts",()=>{
  it("uses the real HTTP transport against an authenticated loopback fixture, including SSE and receipt reads",async()=>{
    const f=antseedFixture(),server=Fastify();
    server.all("/*",async(request,reply)=>{
      if(request.headers["x-antseed-gateway-auth"]!==operatorSecret)return reply.code(401).send({error:"unauthorized"});
      const response=await f.transport("http://127.0.0.1"+request.url,{method:request.method,
        headers:request.headers as Record<string,string>,...(request.method==="POST"?{body:JSON.stringify(request.body)}:{})});
      reply.code(response.status);response.headers.forEach((v,k)=>reply.header(k,v));return reply.send(await response.text());
    });
    const base=await server.listen({host:"127.0.0.1",port:0});
    try {
      const adapter=new ManagedAntseedText(operatorSecret,["*"],fetch,0,base);
      await adapter.refresh();expect(f.posts()).toHaveLength(0);
      const chunks:unknown[]=[];
      expect(await adapter.execute(adapter.quote({...input,stream:true}),v=>chunks.push(v),async()=>{})).toMatchObject({usd:"0.000403",response:{model:input.model}});
      expect(chunks.length).toBeGreaterThan(0);expect(f.posts()).toHaveLength(1);
      const refused=new ManagedAntseedText("wrong-operator-secret-for-fixture",["*"],fetch,0,base);
      await expect(refused.refresh()).rejects.toThrow("managed_upstream_unavailable");expect(f.posts()).toHaveLength(1);
    } finally {await server.close();}
  });
  it("discovers with GET only, labels Mycellios and publishes prices including 4 percent",async()=>{
    const f=antseedFixture(),adapter=new ManagedAntseedText(operatorSecret,["*"],f.transport,0);
    await adapter.refresh();expect(f.posts()).toHaveLength(0);
    expect(adapter.catalog()).toEqual([expect.objectContaining({id:input.model,owned_by:"mycellios",processing:"external",
      pricing:expect.objectContaining({input:"0.00000104",output:"0.000208",serviceFeeBasisPoints:400})})]);
    expect(JSON.stringify(adapter.catalog())).not.toContain(operatorSecret);
    vi.useFakeTimers();vi.advanceTimersByTime(60001);expect(adapter.catalog()).toEqual([]);
  });
  it("does not advertise paid offers with unknown supplier fees, protocol or extra unit charges",async()=>{
    const f=antseedFixture(),adapter=new ManagedAntseedText(operatorSecret,["*"],f.transport);
    await adapter.refresh();expect(adapter.catalog()).toEqual([]);
    const paid=new ManagedAntseedText(operatorSecret,["*"],f.transport,0);
    (f.model.peers[0]! as any).unitBillingModels={video:1};await paid.refresh();expect(paid.catalog()).toEqual([]);
  });
  it("does not round a numeric catalog rate through floating point or treat unknown/missing prices as free",async()=>{
    const f=antseedFixture(),adapter=new ManagedAntseedText(operatorSecret,["*"],f.transport,0);
    f.transport.mockImplementationOnce(async()=>Response.json(f.feed(0)));
    f.transport.mockImplementationOnce(async()=>new Response(JSON.stringify({data:[f.model]})
      .replace('"inputUsdPerMillion":1','"inputUsdPerMillion":1.000000000000000001')));
    await adapter.refresh();expect(adapter.catalog()).toEqual([]);
    delete (f.model.peers[0]! as any).inputUsdPerMillion;
    await adapter.refresh();expect(adapter.catalog()).toEqual([]);
  });
  it("pins provider, service and seller and rejects injected routing/server tools",async()=>{
    const f=antseedFixture(),adapter=new ManagedAntseedText(operatorSecret,["*"],f.transport,0);await adapter.refresh();
    for(const extra of [{provider:{only:["other"]}},{routing:{}},{service:"other"},{plugins:[]},{tools:[{type:"web_search"}]}])
      expect(()=>adapter.quote({...input,...extra})).toThrow();
    const save=vi.fn().mockResolvedValue(undefined),result=await adapter.execute(adapter.quote(input),undefined,save);
    expect(result).toMatchObject({usd:"0.000403",inputTokens:3,outputTokens:2,response:{model:input.model}});
    const call=f.posts()[0]!,headers=new Headers(call[1]!.headers);
    expect(headers.get("x-antseed-gateway-auth")).toBe(operatorSecret);
    expect(headers.get("x-antseed-provider")).toBe("local-llm");
    expect(JSON.parse(Buffer.from(headers.get("x-antseed-routing-policy")!,"base64url").toString())).toMatchObject({allowedPeerIds:[seller],maxInputUsdPerMillion:1,maxOutputUsdPerMillion:200});
    expect(JSON.parse(String(call[1]!.body)).model).toBe(`${seller}@deepseek-test`);
    expect(save).toHaveBeenCalledTimes(2);
  });
  it("does not POST if persisting the intent or authenticating receipts fails",async()=>{
    const f=antseedFixture(),adapter=new ManagedAntseedText(operatorSecret,["*"],f.transport,0);await adapter.refresh();
    await expect(adapter.execute(adapter.quote(input),undefined,async()=>{throw new Error("db unavailable");})).rejects.toThrow("db unavailable");
    expect(f.posts()).toHaveLength(0);
  });
  it("recovers late signed spend without another inference and preserves the public model alias",async()=>{
    const f=antseedFixture({late:true}),adapter=new ManagedAntseedText(operatorSecret,["*"],f.transport,0);
    const router=new ManagedTextRouter([managedTextBackend("antseed",adapter)],[{id:"mycellios/managed/smart",backend:"antseed",model:input.model}]);
    await router.ensureFresh();let saved:unknown;
    await expect(router.execute(router.quote({...input,model:"mycellios/managed/smart"}),undefined,async job=>{saved=structuredClone(job);})).rejects.toThrow("receipt_pending");
    expect(await router.recover(saved)).toBeNull();f.confirm();
    expect(await router.recover(saved)).toMatchObject({usd:"0.000403",response:{model:"mycellios/managed/smart"}});
    expect(f.posts()).toHaveLength(1);
  });
  it("streams without forwarding operator costs and settles with the signed receipt",async()=>{
    const f=antseedFixture(),adapter=new ManagedAntseedText(operatorSecret,["*"],f.transport,0);await adapter.refresh();
    const chunks:unknown[]=[];const result=await adapter.execute(adapter.quote({...input,stream:true}),v=>chunks.push(v),async()=>{});
    expect(chunks).toContainEqual(expect.objectContaining({model:input.model,choices:[{index:0,delta:{content:"Hi"},finish_reason:null}]}));
    expect(result.usd).toBe("0.000403");expect(result.response.choices).toMatchObject([{message:{content:"Hi"}}]);
  });
  it("keeps free sellers at zero and blocks priced fallback with zero policy caps",async()=>{
    const f=antseedFixture({free:true}),adapter=new ManagedAntseedText(operatorSecret,["*"],f.transport);await adapter.refresh();
    const q=adapter.quote(input);expect(q.maximumMicrounits).toBe(0);
    expect((await adapter.execute(q,undefined,async()=>{})).usd).toBe("0");
  });
  it("rejects receipts from another seller, buyer, request or a broken event sequence",async()=>{
    for(const replacement of [{sellerPeerId:"b".repeat(64)},{buyerIdentity:"personal"},{requestId:"other"},{seq:0},{purpose:"routing"}]) {
      const f=antseedFixture({late:true}),adapter=new ManagedAntseedText(operatorSecret,["*"],f.transport,0);await adapter.refresh();let saved:unknown;
      await expect(adapter.execute(adapter.quote(input),undefined,async job=>{saved=structuredClone(job);})).rejects.toThrow("pending");
      f.confirm();f.transport.mockImplementationOnce(async()=>Response.json({...f.feed(0),events:[{...f.events()[0],...replacement}]}));
      await expect(adapter.recover(saved)).rejects.toThrow("antseed_receipt_");expect(f.posts()).toHaveLength(1);
    }
  });
});
