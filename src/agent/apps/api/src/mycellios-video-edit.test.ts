import {afterEach,it,expect,vi} from "vitest";
import {RPCHandler} from "@orpc/server/fetch";
import {serializeModelSecret} from "@rakazo/adapters";
import {productBrand,type Actor} from "@rakazo/contracts";
import {createRouter,type RouterDeps} from "./router.js";
const actor:Actor={userId:"alice",spaceId:"personal",email:"alice@test.invalid",isDeploymentOwner:false};
afterEach(()=>vi.unstubAllEnvs());
function setup(){
 const upstream=vi.fn<typeof fetch>().mockResolvedValue(Response.json({enabled:true}));
 const credential={id:"owned",userId:"alice",provider:"openai-compatible",secretId:"secret-one",userPreferences:[]};
 const find=vi.fn(async()=>[credential]);
 const deps={prisma:{userModelCredential:{findMany:find},secret:{findFirst:vi.fn(async()=>({ciphertext:"fixture"}))}},
  secrets:{load:vi.fn(async()=>serializeModelSecret({kind:"openai_compatible",baseUrl:productBrand.apiBaseUrl,apiKey:"fixture-private-key",enabledModelIds:[]}))},
  env:{agentRuntime:"pi",defaultProvider:"openrouter",defaultModel:"unused",webOrigin:"http://127.0.0.1:5192",screenProxySecret:"fixture",sandboxProvider:"fake"},
  dataDir:"C:/scratch/editor-test",modelConnectionFetch:upstream} as unknown as RouterDeps;
 const handler=new RPCHandler(createRouter(deps));
 return {upstream,find,call:async(action:string,owner:Actor|null=actor)=>handler.handle(new Request("http://127.0.0.1/rpc/models/mycelliosVideoEdit",{
  method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({json:{action,payload:JSON.stringify({key:"edit:"+"a".repeat(64)})}}),
 }),{prefix:"/rpc",context:{actor:owner}})};
}
it("refuses anonymous requests without looking up credentials or contacting a provider",async()=>{
 vi.stubEnv("MYCELLIOS_MANAGED_APPS_ENABLED","true");const f=setup(),r=await f.call("info",null);
 expect(r.response?.status).toBe(401);expect(f.find).not.toHaveBeenCalled();expect(f.upstream).not.toHaveBeenCalled();
});
it("keeps the server gate off before credentials or paid requests",async()=>{
 vi.stubEnv("MYCELLIOS_MANAGED_APPS_ENABLED","false");const f=setup(),r=await f.call("execute");
 expect(r.response?.status).toBe(412);expect(f.find).not.toHaveBeenCalled();expect(f.upstream).not.toHaveBeenCalled();
});
it("proxies only the fixed route with the current account credential, never returning that key",async()=>{
 vi.stubEnv("MYCELLIOS_MANAGED_APPS_ENABLED","true");const f=setup(),r=await f.call("info");
 expect(r.response?.status).toBe(200);const value=await r.response!.json();expect(value).toEqual({json:{enabled:true}});
 expect(JSON.stringify(value)).not.toContain("fixture-private-key");expect(f.find.mock.calls[0]?.[0]).toMatchObject({where:{userId:"alice"}});
 expect(f.upstream.mock.calls[0]?.[0]).toBe(productBrand.apiBaseUrl+"/managed/video-edit/info");
 expect(new Headers(f.upstream.mock.calls[0]?.[1]?.headers).get("authorization")).toBe("Bearer fixture-private-key");
});
