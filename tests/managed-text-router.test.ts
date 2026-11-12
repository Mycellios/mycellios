import {describe,it,expect,vi} from "vitest";
import {managedTextBackend,ManagedTextRouter} from "../src/coordinator/managed-text-router.js";
import type {ManagedModel} from "../src/contracts/managed-provider.js";
const source="mycellios/managed/vendor/text",alias="mycellios/managed/assistant";
function adapter(name:string){
 const row:ManagedModel={id:source,name:"Text",modality:"text",owned_by:"mycellios",processing:"external",pricing:{currency:"credits",unit:"token",serviceFeeBasisPoints:400,input:"0.00000104",output:"0.00000208"}};
 const execute=vi.fn(async(_q:unknown,chunk?: (v:Record<string,unknown>)=>void)=>{chunk?.({model:source,choices:[]});return {receiptId:"receipt-"+name,usd:"0.1",inputTokens:1,outputTokens:1,response:{model:source,choices:[]}};});
 return {provider:name,ensureFresh:vi.fn(async()=>{}),catalog:()=>[row],quote:vi.fn((_req:unknown)=>({maximumUsd:"0.1",maximumMicrounits:104000,expiresAt:Date.now()+60000,body:{max_tokens:10,model:"vendor/text"}})),execute};
}
describe("optional first-party provider with private upstream routing",()=>{
 it("keeps Mycellios identity and public model names through catalog, stream and result",async()=>{
  const a=adapter("openrouter"),r=new ManagedTextRouter([managedTextBackend("openrouter",a)],[{id:alias,backend:"openrouter",model:source,name:"Assistant"}]);
  await r.ensureFresh();expect(r.catalog()).toMatchObject([{id:alias,name:"Assistant",owned_by:"mycellios",pricing:{serviceFeeBasisPoints:400}}]);
  const q=r.quote({model:alias,messages:[{role:"user",content:"Hello"}]});expect(q.provider).toBe("openrouter");
  expect(a.quote.mock.calls[0]![0]).toMatchObject({model:source});const chunk=vi.fn();expect((await r.execute(q,chunk)).response.model).toBe(alias);
  expect(chunk).toHaveBeenCalledWith({model:alias,choices:[]});expect(a.execute).toHaveBeenCalledTimes(1);
 });
 it("can attach another adapter without changing model names, Credit pricing or the user connection",async()=>{
  for(const id of ["openrouter","antseed"]){const a=adapter(id),r=new ManagedTextRouter([managedTextBackend(id,a)],[{id:alias,backend:id,model:source}]);await r.ensureFresh();
   const q=r.quote({model:alias,messages:[]});expect(q.provider).toBe(id);expect(q.maximumMicrounits).toBe(104000);expect((await r.execute(q)).response.model).toBe(alias);}
 });
 it("never falls back to another backend if the selected backend is unavailable",async()=>{
  const a=adapter("openrouter"),b=adapter("antseed");a.ensureFresh.mockRejectedValue(new Error("down"));
  const r=new ManagedTextRouter([managedTextBackend("openrouter",a),managedTextBackend("antseed",b)],[{id:alias,backend:"openrouter",model:source}]);
  await r.ensureFresh();expect(r.catalog()).toEqual([]);expect(()=>r.quote({model:alias,messages:[]})).toThrow("unavailable");expect(a.execute).not.toHaveBeenCalled();expect(b.execute).not.toHaveBeenCalled();
 });
 it("keeps legacy public IDs unless an operator explicitly maps them",async()=>{
  const a=adapter("openrouter"),r=new ManagedTextRouter([managedTextBackend("openrouter",a)]);await r.ensureFresh();expect(r.catalog()[0]?.id).toBe(source);
 });
 it("rejects ambiguous mappings and unregistered adapters instead of guessing",()=>{
  const a=adapter("openrouter"),b=managedTextBackend("openrouter",a);
  expect(()=>new ManagedTextRouter([b],[{id:alias,backend:"unknown",model:source}])).toThrow("invalid");
  expect(()=>new ManagedTextRouter([b],[{id:alias,backend:"openrouter",model:source},{id:alias,backend:"openrouter",model:source}])).toThrow("invalid");
  expect(()=>new ManagedTextRouter([b,b])).toThrow("invalid");
  expect(new ManagedTextRouter([b,managedTextBackend("other",adapter("other"))]).catalog()).toEqual([]);
 });
});
