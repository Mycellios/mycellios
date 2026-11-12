import {afterEach,it,expect,vi} from "vitest";
import {RPCHandler} from "@orpc/server/fetch";
import {serializeModelSecret} from "@rakazo/adapters";
import {productBrand,type Actor} from "@rakazo/contracts";
import {createRouter,type RouterDeps} from "./router.js";
const actor:Actor={userId:"alice",spaceId:"personal",email:"alice@test.invalid",isDeploymentOwner:false};
afterEach(()=>vi.unstubAllEnvs());
function setup() {
 const upstream=vi.fn<typeof fetch>().mockResolvedValue(Response.json({data:[]})),lookup=vi.fn(async()=>[{id:"owned",userId:"alice",provider:"openai-compatible",secretId:"one",userPreferences:[]}]);
 const deps={prisma:{userModelCredential:{findMany:lookup},secret:{findFirst:vi.fn(async()=>({ciphertext:"fixture"}))}},
  secrets:{load:vi.fn(async()=>serializeModelSecret({kind:"openai_compatible",baseUrl:productBrand.apiBaseUrl,apiKey:"private-fixture",enabledModelIds:[]}))},
  env:{sandboxProvider:"fake"},modelConnectionFetch:upstream} as unknown as RouterDeps;
 const handler=new RPCHandler(createRouter(deps));
 return {upstream,lookup,call:async(action:string,expectedUserId?:string,owner:Actor|null=actor)=>{
  const result=await handler.handle(new Request("http://127.0.0.1/rpc/models/mycelliosMedia",{method:"POST",headers:{"content-type":"application/json"},
   body:JSON.stringify({json:{action,expectedUserId,payload:JSON.stringify({idempotencyKey:"owned-key"}),key:"owned-media-key"}})}),{prefix:"/rpc",context:{actor:owner}});
  return result.response!;
 }};
}
it("keeps managed media off before reading credentials or spending",async()=>{
 vi.stubEnv("MYCELLIOS_MANAGED_APPS_ENABLED","false");const f=setup();expect((await f.call("execute","alice")).status).toBe(412);expect(f.lookup).not.toHaveBeenCalled();expect(f.upstream).not.toHaveBeenCalled();
});
it.each([undefined,"bob"])("rejects a missing or changed account before any credential lookup: %s",async owner=>{
 vi.stubEnv("MYCELLIOS_MANAGED_APPS_ENABLED","true");const f=setup();expect((await f.call("execute",owner)).status).toBe(403);expect(f.lookup).not.toHaveBeenCalled();expect(f.upstream).not.toHaveBeenCalled();
});
it("discovers without an inference POST and returns the authenticated viewer",async()=>{
 vi.stubEnv("MYCELLIOS_MANAGED_APPS_ENABLED","true");const f=setup(),response=await f.call("models");expect(response.status).toBe(200);
 expect(await response.json()).toEqual({json:{data:[],viewer:"alice"}});expect(f.upstream.mock.calls[0]?.[0]).toBe(productBrand.apiBaseUrl+"/managed/media/models");
 expect(f.upstream.mock.calls[0]?.[1]?.method).toBe("GET");
});
it("recovers a missing submitted response without creating a second job",async()=>{
 vi.stubEnv("MYCELLIOS_MANAGED_APPS_ENABLED","true");const f=setup();f.upstream.mockResolvedValue(new Response(null,{status:404}));
 const response=await f.call("status","alice");expect(response.status).toBe(200);expect(await response.json()).toEqual({json:{status:"not_submitted"}});
 expect(f.upstream.mock.calls).toHaveLength(1);expect(String(f.upstream.mock.calls[0]?.[0])).toContain("/status");
});
it("never returns the saved provider key or forwards a caller-selected URL",async()=>{
 vi.stubEnv("MYCELLIOS_MANAGED_APPS_ENABLED","true");const f=setup(),response=await f.call("quote","alice");expect(response.status).toBe(200);
 expect(await response.text()).not.toContain("private-fixture");expect(f.upstream.mock.calls[0]?.[0]).toBe(productBrand.apiBaseUrl+"/managed/media/quote");
});
