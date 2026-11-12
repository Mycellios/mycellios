import type {ManagedModel,ManagedTextRoute} from "../contracts/managed-provider.js";
import type {GatewayProvider,GatewayQuote} from "./managed-gateway.js";
import type {ManagedTextRequest,ManagedTextResult} from "./managed-openrouter.js";

type Chunk=(v:Record<string,unknown>)=>void;
type Submitted=(job:unknown)=>Promise<void>;
interface BackendQuote extends GatewayQuote {run(chunk?:Chunk,submitted?:Submitted,payload?:unknown):Promise<ManagedTextResult>}
export interface ManagedTextBackend {
 readonly id:string;ensureFresh():Promise<void>;catalog():ManagedModel[];quote(request:ManagedTextRequest):BackendQuote;
 recover?(job:unknown):Promise<ManagedTextResult|null>;
}
/** Keep each adapter's quote type paired with its own execute implementation. */
export function managedTextBackend<Q extends GatewayQuote>(id:string,adapter:GatewayProvider<ManagedTextRequest,Q,ManagedModel>):ManagedTextBackend {
 return {id,ensureFresh:()=>adapter.ensureFresh(),catalog:()=>adapter.catalog(),...(adapter.recover?{recover:(job:unknown)=>adapter.recover!(job)}:{}),quote:request=>{
  const q=adapter.quote(request);return {...q,run:(chunk,submitted,payload)=>adapter.execute(q,chunk,submitted,payload)};
 }};
}
export interface RoutedTextQuote extends GatewayQuote {
 provider:string;publicModel:string;inner:BackendQuote;
 body:{max_tokens?:number;route:{backend:string;model:string;publicModel:string};request:GatewayQuote["body"]};
}

/** First-party model names with private, operator-selected transport. No fallback or payer switching. */
export class ManagedTextRouter {
 readonly provider="mycellios";
 private readonly backends=new Map<string,ManagedTextBackend>();
 private readonly unavailable=new Set<string>();
 private readonly routes:readonly ManagedTextRoute[];
 constructor(backends:readonly ManagedTextBackend[],routes:readonly ManagedTextRoute[]=[]) {
  for(const b of backends){if(!/^[a-z][a-z0-9-]{0,63}$/.test(b.id)||this.backends.has(b.id))throw new Error("managed_backend_invalid");this.backends.set(b.id,b);}
  if(!backends.length||routes.length>100)throw new Error("managed_routes_invalid");
  const ids=new Set<string>();
  for(const r of routes){if(!r||typeof r.id!=="string"||!/^mycellios\/managed\/[A-Za-z0-9._:/-]{1,180}$/.test(r.id)||ids.has(r.id)
   ||!this.backends.has(r.backend)||typeof r.model!=="string"||r.model.length<1||r.model.length>256
   ||(r.name!==undefined&&(typeof r.name!=="string"||!r.name.trim()||r.name.length>200))
   ||Object.keys(r).some(k=>!["id","backend","model","name"].includes(k)))throw new Error("managed_routes_invalid");ids.add(r.id);}
  this.routes=routes.map(r=>({...r}));
 }
 async ensureFresh(){await Promise.all([...this.backends.values()].map(async b=>{try{await b.ensureFresh();this.unavailable.delete(b.id);}catch{this.unavailable.add(b.id);}}));}
 private entries(){
  const result:Array<{route:ManagedTextRoute;backend:ManagedTextBackend;model:ManagedModel}>=[];
  for(const backend of this.backends.values()) {
   if(this.unavailable.has(backend.id))continue;
   const models=backend.catalog().filter(m=>m.modality==="text");
   const routes=this.routes.length?this.routes.filter(r=>r.backend===backend.id):models.map(m=>({id:m.id,backend:backend.id,model:m.id}));
   for(const route of routes){const model=models.find(m=>m.id===route.model);if(model)result.push({route,backend,model});}
  }
  // Colliding automatic names are unavailable rather than silently choosing another payer/backend.
  const counts=new Map<string,number>();for(const e of result)counts.set(e.route.id,(counts.get(e.route.id)??0)+1);
  return result.filter(e=>counts.get(e.route.id)===1);
 }
 catalog():ManagedModel[]{return this.entries().map(({route,model})=>({...model,id:route.id,name:route.name??model.name,owned_by:"mycellios",processing:"external"}));}
 quote(request:ManagedTextRequest):RoutedTextQuote {
  const entry=this.entries().find(e=>e.route.id===request.model);if(!entry)throw new Error("managed_model_unavailable");
  const inner=entry.backend.quote({...request,model:entry.route.model});
  return {maximumUsd:inner.maximumUsd,maximumMicrounits:inner.maximumMicrounits,expiresAt:inner.expiresAt,
   provider:entry.backend.id,publicModel:request.model,inner,fundingCostBasisPoints:inner.fundingCostBasisPoints??0,
   ...(inner.billingContext===undefined?{}:{billingContext:inner.billingContext}),
   body:{...(inner.body.max_tokens===undefined?{}:{max_tokens:inner.body.max_tokens}),route:{backend:entry.backend.id,model:entry.route.model,publicModel:request.model},request:inner.body}};
 }
 async execute(q:RoutedTextQuote,chunk?:Chunk,submitted?:Submitted,payload?:unknown):Promise<ManagedTextResult> {
  const result=await q.inner.run(chunk?v=>chunk({...v,...(v.model?{model:q.publicModel}:{})}):undefined,
   submitted?job=>submitted({backend:q.provider,publicModel:q.publicModel,job}):undefined,payload);
  return {...result,response:{...result.response,model:q.publicModel}};
 }
 async recover(value:unknown):Promise<ManagedTextResult|null> {
  if(!value||typeof value!=="object"||Array.isArray(value))return null;
  const saved=value as {backend:string;publicModel:string;job:unknown};
  const result=await this.backends.get(saved.backend)?.recover?.(saved.job);
  return result?{...result,response:{...result.response,model:saved.publicModel}}:null;
 }
}
