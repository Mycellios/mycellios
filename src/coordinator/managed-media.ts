import {z} from "zod";
import {addUsd,managedCharge,usdAtoms} from "../economy/managed-pricing.js";
import {parseManagedProviderJson,type ManagedTextResult} from "./managed-openrouter.js";
import {mediaCost} from "./managed-media-cost.js";
import type {MediaOffer} from "../contracts/managed-provider.js";
export type {MediaOffer} from "../contracts/managed-provider.js";

export const MediaRequestSchema=z.object({
 model:z.string().min(1).max(300),kind:z.enum(["image","speech","transcription","video","embeddings","rerank","batch","decisions"]),
 state:z.string().min(1).max(4000).optional(),prompt:z.string().min(1).max(4000).optional(),voice:z.string().max(80).optional(),
 audio:z.object({data:z.string().max(1280100),format:z.enum(["wav","mp3"])}).strict().optional(),
 duration:z.number().int().min(1).max(15).optional(),
 documents:z.array(z.string().min(1).max(4000)).min(1).max(40).optional(),
 prompts:z.array(z.string().min(1).max(4000)).min(1).max(8).optional(),max_tokens:z.number().int().min(1).max(8192).optional(),
}).strict();
export type MediaRequest=z.infer<typeof MediaRequestSchema>;
export interface MediaQuote {maximumUsd:string;maximumMicrounits:number;expiresAt:number;fundingCostBasisPoints?:number;billingContext?:unknown;body:Record<string,unknown>&{max_tokens?:number};offer:MediaOffer}
export interface ManagedMediaJob {id:string;model:string;kind?:string;data?:Record<string,unknown>;receiptId?:string;cost?:string;expected?:number;upstreamId?:string}
const BASE="https://openrouter.ai/api/v1";
type Persist=(job:ManagedMediaJob)=>Promise<void>;
const identity=(v:unknown):v is string=>typeof v==="string"&&/^[A-Za-z0-9_-]{1,256}$/.test(v);
const record=(v:unknown):Record<string,any>=>{if(!v||typeof v!=="object"||Array.isArray(v))throw new Error("managed_media_result_invalid");return v as Record<string,any>;};

/** Server-derived unit contracts; live configuration cannot supply arbitrary USD maxima. */
export class ManagedMedia {
 readonly provider="openrouter";
 private offers:readonly MediaOffer[];
 private pending:Promise<void>|null=null;
 constructor(private readonly key:string,offers:readonly MediaOffer[],private readonly transport:typeof fetch=fetch,
   private readonly fundingCostBasisPoints:number|null=null,private readonly discover?:()=>Promise<readonly MediaOffer[]>) {
  this.offers=offers;this.validate(offers);
 }
 private validate(offers:readonly MediaOffer[]) {
  const ids=new Set<string>();
  for(const o of offers){
   if(!o.id.startsWith("mycellios/media/")||ids.has(o.id)||!/^[-A-Za-z0-9._:]+\/[-A-Za-z0-9._:/]{1,220}$/.test(o.upstreamId)
     || !["image","speech","transcription","video","embeddings","rerank","batch","decisions"].includes(o.kind)||!Number.isSafeInteger(o.expiresAt))throw new Error("managed_media_offer_invalid");
   managedCharge(o.maximumUsd);ids.add(o.id);
  }
 }
 async ensureFresh() {
  if(!this.discover)return;
  this.pending??=(async()=>{const offers=await this.discover!();this.validate(offers);this.offers=offers;})().finally(()=>{this.pending=null;});
  await this.pending;
 }
 catalog(){return this.offers.filter(o=>o.expiresAt>Date.now()&&(this.fundingCostBasisPoints!==null||usdAtoms(o.maximumUsd)===0n)).map(o=>({
  id:o.id,name:o.name,modality:o.kind,provider:"Mycellios",processing:"external",currency:"credits",serviceFeeBasisPoints:400,
  maximumCreditsMicrounits:managedCharge(o.maximumUsd,this.fundingCostBasisPoints??0).totalMicrounits,estimate:"maximum",voices:o.voices??[],durations:o.durations??[],
 }));}
 quote(raw:MediaRequest):MediaQuote {
  const req=MediaRequestSchema.parse(raw),offer=this.offers.find(o=>o.id===req.model&&o.kind===req.kind&&o.expiresAt>Date.now());
  if(!offer)throw new Error("managed_media_model_unavailable");
  if(this.fundingCostBasisPoints===null&&usdAtoms(offer.maximumUsd)!==0n)throw new Error("managed_funding_cost_not_configured");
  const allowed=new Set(["model","kind",...(req.kind==="transcription"?["audio"]:req.kind==="batch"?["prompts","max_tokens"]:
    req.kind==="decisions"?["prompt","state"]:req.kind==="rerank"?["prompt","documents"]:req.kind==="speech"?["prompt","voice"]:req.kind==="video"?["prompt","duration"]:["prompt"])]);
  if(Object.keys(req).some(k=>!allowed.has(k)))throw new Error("managed_media_input_invalid");
  const controls=offer.costContract?.controls??{},provider=controls.providerTag?{only:[controls.providerTag],allow_fallbacks:false}:undefined;
  const fixed={...(controls.resolution?{resolution:controls.resolution}:{}),...(controls.size?{size:controls.size}:{}),
    ...(controls.aspect_ratio?{aspect_ratio:controls.aspect_ratio}:{}),...(controls.quality?{quality:controls.quality}:{}),...(controls.output_format?{output_format:controls.output_format}:{})};
  let body:Record<string,unknown>&{max_tokens?:number}={model:offer.upstreamId};
  if(req.kind==="transcription") {
   if(!req.audio)throw new Error("managed_media_input_invalid");
   if(!offer.costContract){const a=Buffer.from(req.audio.data,"base64");if(a.length<12||a.toString("base64")!==req.audio.data||a.toString("ascii",0,4)!=="RIFF"||a.toString("ascii",8,12)!=="WAVE")throw new Error("managed_audio_invalid");}
   body.input_audio=req.audio;
  } else if(req.kind==="batch") {
   if(!req.prompts?.length||!offer.costContract?.maxOutputTokens)throw new Error("managed_media_input_invalid");
   const output=req.max_tokens??256;
   if(output>offer.costContract.maxOutputTokens)throw new Error("managed_output_bound_missing");
   body={endpoint:"/v1/chat/completions",model:offer.upstreamId,provider:{allow_fallbacks:false},completion_window:"24h",
    requests:req.prompts.map((prompt,index)=>({custom_id:"item-"+index,body:{messages:[{role:"user",content:prompt}],max_tokens:output,stream:false,store:false}}))};
  } else {
   if(!req.prompt)throw new Error("managed_media_input_invalid");
   if(req.kind==="speech") {
    if(!req.voice||!offer.voices?.includes(req.voice))throw new Error("managed_voice_unavailable");
    body={...body,input:req.prompt,voice:req.voice,response_format:"mp3"};
   } else if(req.kind==="video") {
    if(!req.duration||!offer.durations?.includes(req.duration))throw new Error("managed_media_input_invalid");
    body={...body,prompt:req.prompt,duration:req.duration,generate_audio:false,...fixed};
   } else if(req.kind==="embeddings")body={...body,input:req.prompt,encoding_format:"float",provider:{allow_fallbacks:false}};
   else if(req.kind==="rerank") {
    if(!req.documents?.length)throw new Error("managed_documents_required");
    body={...body,query:req.prompt,documents:req.documents,top_n:req.documents.length,return_documents:false,provider:{allow_fallbacks:false}};
   } else if(req.kind==="decisions") {
    if(!req.state)throw new Error("managed_decisions_state_required");
    body={...body,state:req.state,questions:{answer:{type:"noul",instructions:req.prompt}},provider:{allow_fallbacks:false}};
   } else body={...body,prompt:req.prompt,n:1,...fixed,...(provider?{provider}:{})};
  }
  const maximumUsd=offer.costContract?(req.kind==="batch"?addUsd(...req.prompts!.map(prompt=>mediaCost(offer.costContract!,{prompt,max_tokens:req.max_tokens??256}))):mediaCost(offer.costContract,req)):offer.maximumUsd;
  return {offer,body,maximumUsd,billingContext:offer.costContract??null,fundingCostBasisPoints:this.fundingCostBasisPoints??0,
   maximumMicrounits:managedCharge(maximumUsd,this.fundingCostBasisPoints??0).totalMicrounits,expiresAt:Math.min(offer.expiresAt,Date.now()+60000)};
 }
 private async call(path:string,body?:Record<string,unknown>) {
  const response=await this.transport(path==="/decisions"?"https://openrouter.ai/api/alpha/decisions":BASE+path,{method:body?"POST":"GET",redirect:"error",signal:AbortSignal.timeout(120000),
   headers:{authorization:"Bearer "+this.key,"content-type":"application/json"},...(body?{body:JSON.stringify(body)}:{})});
  if(!response.ok){await response.body?.cancel();throw new Error("managed_media_upstream_failed");}return response;
 }
 private async bytes(response:Response,maximum=16777216){
  const reader=response.body?.getReader();if(!reader)throw new Error("managed_media_empty");let length=0;const chunks:Uint8Array[]=[];
  try{while(true){const v=await reader.read();if(v.done)break;length+=v.value.length;if(length>maximum)throw new Error("managed_media_too_large");chunks.push(v.value);}return Buffer.concat(chunks);}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 }
 private async json(response:Response){return record(parseManagedProviderJson((await this.bytes(response)).toString("utf8")));}
 private result(id:unknown,cost:unknown,data:Record<string,unknown>):ManagedTextResult {
  if(!identity(id)||typeof cost!=="string")throw new Error("managed_media_receipt_missing");managedCharge(cost);
  return {receiptId:id,usd:cost,inputTokens:0,outputTokens:0,response:{...data,provider:"Mycellios"}};
 }
 private async invoice(job:ManagedMediaJob,persist?:Persist) {
  if(job.cost===undefined){const invoice=await this.json(await this.call("/generation?id="+encodeURIComponent(job.receiptId??job.id)));
   if(invoice.data?.id!==(job.receiptId??job.id)||invoice.data?.is_byok===true)throw new Error("managed_media_receipt_mismatch");
   if(typeof invoice.data?.total_cost!=="string")throw new Error("managed_media_receipt_missing");job={...job,cost:invoice.data.total_cost};await persist?.(job);
  }
  return this.result(job.receiptId??job.id,job.cost,job.data??{});
 }
 async execute(q:MediaQuote,_chunk?:(v:Record<string,unknown>)=>void,submitted?:Persist):Promise<ManagedTextResult> {
  if(q.expiresAt<=Date.now())throw new Error("managed_quote_expired");
  const kind=q.offer.kind;
  if(["video","batch"].includes(kind)&&!submitted)throw new Error("managed_media_persistence_required");
  const path=kind==="image"?"/images":kind==="speech"?"/audio/speech":kind==="transcription"?"/audio/transcriptions":kind==="video"?"/videos":kind==="batch"?"/batches":"/"+kind;
  const response=await this.call(path,q.body),generation=response.headers.get("x-generation-id");
  if(kind==="speech") {
   if(!identity(generation)||!response.headers.get("content-type")?.startsWith("audio/mpeg")){await response.body?.cancel();throw new Error("managed_media_receipt_missing");}
   const bytes=await this.bytes(response);
   if(bytes.length<4||!(bytes.toString("ascii",0,3)==="ID3"||(bytes[0]===255&&(bytes[1]!&224)===224)))throw new Error("managed_media_result_invalid");
   const job:ManagedMediaJob={id:generation,kind:"receipt",model:q.offer.id,receiptId:generation,data:{kind,model:q.offer.id,audio:{data:bytes.toString("base64"),mediaType:"audio/mpeg"}}};
   await submitted?.(job);return this.invoice(job,submitted);
  }
  const value=await this.json(response);
  if(kind==="video"||kind==="batch") {
   if(!identity(value.id))throw new Error("managed_media_job_invalid");
   await submitted!({id:value.id,model:q.offer.id,kind,...(kind==="batch"?{expected:(q.body.requests as unknown[]).length,upstreamId:q.offer.upstreamId}:{})});
   throw new Error("managed_media_job_pending");
  }
  if(value.usage?.is_byok===true)throw new Error("managed_media_billing_mode_unsupported");
  const data:Record<string,unknown>={model:q.offer.id,kind};
  if(kind==="transcription") {if(typeof value.text!=="string"||value.text.length>65536)throw new Error("managed_media_result_invalid");data.text=value.text;}
  else if(kind==="image") {
   if(!Array.isArray(value.data)||value.data.length!==1||value.data.some((v:any)=>typeof v.b64_json!=="string"||!["image/png","image/jpeg","image/webp"].includes(v.media_type)||!v.b64_json.length||Buffer.from(v.b64_json,"base64").toString("base64")!==v.b64_json))throw new Error("managed_media_result_invalid");
   data.images=value.data.map((v:any)=>({b64_json:v.b64_json,media_type:v.media_type}));
  } else if(kind==="embeddings") {
   if(!Array.isArray(value.data)||value.data.length!==1||value.data[0]?.index!==0||!Array.isArray(value.data[0]?.embedding)||!value.data[0].embedding.length||value.data[0].embedding.length>65536||value.data[0].embedding.some((v:unknown)=>typeof v!=="number"||!Number.isFinite(v)))throw new Error("managed_media_result_invalid");data.embeddings=value.data;
  } else if(kind==="decisions") {
   const answer=value.answers?.answer;
   if(!answer||!["noul","refusal"].includes(answer.type)||answer.type==="noul"&&(typeof answer.noul!=="number"||!Number.isFinite(answer.noul)||answer.noul<0||answer.noul>1))throw new Error("managed_media_result_invalid");
   data.decision=answer.type==="refusal"?{type:"refusal"}:{type:"noul",probability:answer.noul};
  } else {
   if(!Array.isArray(value.results)||value.results.length!==Number(q.body.top_n)||value.results.some((v:any)=>!Number.isInteger(v.index)||v.index<0||v.index>=Number(q.body.top_n)||typeof v.relevance_score!=="number"||!Number.isFinite(v.relevance_score))||new Set(value.results.map((v:any)=>v.index)).size!==value.results.length)throw new Error("managed_media_result_invalid");data.results=value.results.map((v:any)=>({index:v.index,relevance_score:v.relevance_score}));
  }
  const id=generation??value.id;if(!identity(id))throw new Error("managed_media_receipt_missing");
  const job:ManagedMediaJob={id,receiptId:id,model:q.offer.id,kind:"receipt",data,...(typeof value.usage?.cost==="string"?{cost:value.usage.cost}:{})};
  await submitted?.(job);return this.invoice(job,submitted);
 }
 async poll(job:ManagedMediaJob,persist?:Persist):Promise<ManagedTextResult|null> {
  if(!identity(job.id))throw new Error("managed_media_job_invalid");
  if(job.kind==="receipt"||job.kind==="speech")return this.invoice({...job,receiptId:job.receiptId??job.id},persist);
  if(job.kind==="batch") {
   const value=await this.json(await this.call("/batches/"+job.id));
   if(value.id!==job.id||value.usage?.is_byok===true)throw new Error("managed_media_job_invalid");
   if(!["completed","failed","cancelled","expired"].includes(value.status))return null;
   if(typeof value.usage?.cost!=="string")throw new Error("managed_media_receipt_missing");
   const rawResults=Array.isArray(value.results)?value.results:value.status!=="completed"&&value.request_counts?.completed===0?[]:null;
   if(!rawResults)throw new Error("managed_media_receipt_missing");
   const rows=rawResults.map(record);
   if(rows.length>Number(job.expected)||new Set(rows.map((v:any)=>v.custom_id)).size!==rows.length||rows.some((v:any)=>typeof v.custom_id!=="string"||!/^item-\d+$/.test(v.custom_id)||Number(v.custom_id.slice(5))>=Number(job.expected)))throw new Error("managed_batch_result_mismatch");
   if(value.status==="completed"&&rows.length!==job.expected)throw new Error("managed_batch_result_mismatch");
   const results=rows.map((v:any)=>({id:v.custom_id,status:v.response?.status_code??null,text:v.response?.body?.choices?.[0]?.message?.content??null,error:v.error||v.response?.status_code!==200?"upstream_request_failed":null}));
   const ready:ManagedMediaJob={...job,kind:"receipt",receiptId:job.id,cost:value.usage.cost,data:{kind:"batch",model:job.model,status:value.status,results}};
   await persist?.(ready);return this.invoice(ready,persist);
  }
  const value=await this.json(await this.call("/videos/"+job.id));
  if(value.id!==job.id||value.usage?.is_byok===true)throw new Error("managed_media_job_invalid");
  if(["failed","cancelled","expired"].includes(value.status))return this.result(value.generation_id??value.id,value.usage?.cost,{kind:"video",model:job.model,status:value.status,error:"upstream_job_failed"});
  if(value.status!=="completed")return null;
  return this.result(value.generation_id,value.usage?.cost,{kind:"video",model:job.model,video:{jobId:job.id}});
 }
 async content(jobId:string) {
  if(!identity(jobId))throw new Error("managed_media_job_invalid");const r=await this.call("/videos/"+jobId+"/content");
  if(!r.headers.get("content-type")?.startsWith("video/mp4")){await r.body?.cancel();throw new Error("managed_media_result_invalid");}
  const bytes=await this.bytes(r,67108864);if(bytes.length<12||bytes.toString("ascii",4,8)!=="ftyp")throw new Error("managed_media_result_invalid");return bytes;
 }
}
