import {createHash,randomUUID} from "node:crypto";
import {ManagedEditRequestSchema,type ManagedEditRequest,type ManagedEditOffer,type ManagedEditJob} from "../contracts/video-edit.js";
import {managedCharge,usdAtoms} from "../economy/managed-pricing.js";
import type {ManagedTextResult} from "./managed-openrouter.js";
import {probeManagedEdit} from "./video-edit-probe.js";

export type EditQuote={maximumUsd:string;maximumMicrounits:number;expiresAt:number;body:Record<string,unknown>&{max_tokens?:number};offer:ManagedEditOffer;request:ManagedEditRequest};
const base="http://127.0.0.1:8377",hash=(b:Uint8Array)=>createHash("sha256").update(b).digest("hex");
const decimal=(n:bigint,scale=18)=>`${n/10n**BigInt(scale)}.${(n%10n**BigInt(scale)).toString().padStart(scale,"0")}`.replace(/\.?0+$/,"");
const safeId=(v:unknown):v is string=>typeof v==="string"&&/^[A-Za-z0-9._:/-]{1,256}$/.test(v);

/** Dedicated operator buyer only; it is never the customer's USDC wallet. */
export class ManagedAntseedEdit {
 readonly provider="antseed-video-edit";
 private models:any[]=[];private fresh=0;
 constructor(private readonly controlSecret:string,private readonly fetcher:typeof fetch=fetch,
  private readonly probe=probeManagedEdit) {if(!controlSecret)throw new Error("antseed_operator_control_required");}
 private async request(route:string,body?:unknown,headers:Record<string,string>={},deadline?:AbortSignal) {
  const response=await this.fetcher(base+route,{method:body?"POST":"GET",redirect:"error",signal:AbortSignal.any([AbortSignal.timeout(120000),...(deadline?[deadline]:[])]),
   headers:{"content-type":"application/json","x-antseed-gateway-auth":this.controlSecret,...headers},...(body?{body:JSON.stringify(body)}:{})});
  if(!response.ok){await response.body?.cancel();throw new Error("antseed_edit_unavailable");}return response;
 }
 private async bytes(response:Response,max=2_000_000) {
  const reader=response.body?.getReader();if(!reader)throw new Error("antseed_edit_empty");const parts:Uint8Array[]=[];let length=0;
  try{while(true){const v=await reader.read();if(v.done)break;length+=v.value.length;if(length>max)throw new Error("antseed_edit_too_large");parts.push(v.value);}return Buffer.concat(parts);}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 }
 private async json(response:Response) {
  const parse=JSON.parse as (s:string,r:(k:string,v:any,c?:{source?:string})=>any)=>any;
  return parse((await this.bytes(response)).toString("utf8"),(k,v,c)=>{if(k==="priceUsd"&&typeof v==="number"){if(!c?.source)throw new Error("exact_money_parser_required");return c.source;}return v;});
 }
 async ensureFresh(){if(Date.now()-this.fresh<5000)return;const v=await this.json(await this.request("/v1/models?type=videos"));if(!Array.isArray(v.data))throw new Error("antseed_catalog_invalid");this.models=v.data;this.fresh=Date.now();}
 catalog(){return this.fresh>Date.now()-5000?[{id:"mycellios/antseed/video-edit",provider:"Mycellios",processing:"external"}]:[];}
 quote(raw:ManagedEditRequest):EditQuote {
  const request=ManagedEditRequestSchema.parse(raw),offers:ManagedEditOffer[]=[];
  if(this.fresh<Date.now()-5000)throw new Error("antseed_prices_expired");
  for(const model of this.models) for(const peer of Array.isArray(model.peers)?model.peers:[]) {
   const v=peer.capabilities?.video;
   if(!safeId(model.id)||!safeId(peer.peerId)||!safeId(peer.provider)||!safeId(peer.serviceId)
    || !["fal-video","venice-video"].includes(peer.protocol)||!v?.inputs?.includes("video")
    || (v.requiredInputs??[]).some((i:string)=>!["video","text"].includes(i))
    || (Array.isArray(v.durationsSeconds)&&!v.durationsSeconds.includes(Math.floor(request.source.duration)))
    || (Number.isFinite(v.maxDurationSeconds)&&request.source.duration>v.maxDurationSeconds))continue;
   for(const resolution of Array.isArray(v.resolutions)?v.resolutions:[]) {
    if(typeof resolution!=="string"||!/^\d{3,4}[pP]$/.test(resolution))continue;
    const components=peer.unitBillingModels?.[peer.protocol]?.components;if(!Array.isArray(components))continue;
    const parts=components.filter((c:any)=>(!c.match?.resolution||c.match.resolution===resolution)&&(!c.match?.model||c.match.model===peer.serviceId));
    if(!parts.length||parts.some((c:any)=>!["video_seconds","video_generations"].includes(c.unit)||typeof c.priceUsd!=="string"||Object.keys(c.match??{}).some(k=>!["resolution","model"].includes(k))))continue;
    try {
     const atoms=parts.reduce((sum:bigint,c:any)=>sum+usdAtoms(c.priceUsd)*BigInt(c.unit==="video_seconds"?Math.floor(request.source.duration):1),0n);
     // Admit only exact USDC precision and <= $1, where no opening-fee policy is needed.
     if(atoms<=0n||atoms>10n**18n||atoms%10n**12n!==0n)continue;
     const upstreamUsd=decimal(atoms),creditsMicros=managedCharge(upstreamUsd).totalMicrounits;
     offers.push({model:model.id,seller:peer.peerId,provider:peer.provider,service:peer.serviceId,protocol:peer.protocol,resolution,upstreamUsd,creditsMicros});
    }catch{/* Unsupported precision/pricing is never represented as free. */}
   }
  }
  offers.sort((a,b)=>a.creditsMicros-b.creditsMicros||JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const offer=offers[0];if(!offer)throw new Error("antseed_edit_no_compatible_offer");
  return {maximumUsd:offer.upstreamUsd,maximumMicrounits:offer.creditsMicros,expiresAt:Date.now()+60000,offer,request,
   body:{model:`${offer.seller}@${offer.model}`,provider:offer.provider,service:offer.service,protocol:offer.protocol,
    resolution:offer.resolution,duration:Math.floor(request.source.duration),prompt:request.prompt}};
 }
 async validateSource(request:ManagedEditRequest,data:unknown) {
  if(typeof data!=="string"||data.length>33_554_432)throw new Error("video_edit_source_invalid");const bytes=Buffer.from(data,"base64");
  if(!bytes.length||bytes.length>24*1024*1024||bytes.toString("base64")!==data||hash(bytes)!==request.source.hash)throw new Error("video_edit_source_changed");
  const actual=await this.probe(bytes);
  if(Math.abs(actual.duration-request.source.duration)>0.001||actual.width!==request.source.width||actual.height!==request.source.height)throw new Error("video_edit_source_changed");
  return bytes;
 }
 private async feed(after:number,deadline?:AbortSignal) {const v=await this.json(await this.request("/_antseed/attributed-spend?after="+after,undefined,{},deadline));
  if(typeof v.bootId!=="string"||!Number.isSafeInteger(v.cursor)||!Number.isSafeInteger(v.oldestSeq)||!Array.isArray(v.events)||!v.capabilities?.includes("video-budget"))throw new Error("antseed_receipt_feed_required");return v;}
 async execute(q:EditQuote,_chunk?:unknown,submitted?:(job:unknown)=>Promise<void>,payload?:unknown):Promise<ManagedTextResult> {
  if(!Buffer.isBuffer(payload)||q.expiresAt<=Date.now()||!submitted)throw new Error("antseed_edit_admission_invalid");
  const baseline=await this.feed(0),tag=randomUUID(),downloadRequestId=randomUUID();
  // A saved intent precedes queueing. It can be reviewed after a lost queue response.
  const intent={id:"",offer:q.offer,tag,bootId:baseline.bootId,cursor:baseline.cursor,downloadRequestId};await submitted(intent);
  const b=q.body,{provider,service,protocol,...body}=b;
  const response=await this.request(protocol==="fal-video"?"/fal/v1/video/queue":"/api/v1/video/queue",
   {...body,video_url:`data:video/mp4;base64,${payload.toString("base64")}`,duration:protocol==="fal-video"?String(body.duration):`${body.duration}s`},
   {"x-antseed-provider":String(provider),"x-antseed-service":String(service),"x-antseed-request-id":randomUUID(),"x-antseed-attribution-tag":tag,
    "x-antseed-max-video-usdc":String(managedCharge(q.maximumUsd).upstreamMicrounits)});
  const value=await this.json(response),id=protocol==="fal-video"?value.request_id:value.queue_id;
  if(typeof id!=="string"||!id||id.length>512)throw new Error("antseed_job_identity_missing");
  await submitted({...intent,id});throw new Error("antseed_edit_pending");
 }
 /** Saved bytes survive missing/late receipts. Polls never create another job. */
 async poll(job:ManagedEditJob,save:(job:ManagedEditJob)=>Promise<void>):Promise<ManagedTextResult|null> {
  const deadline=AbortSignal.timeout(180000);
  if(!job.id)return null;
  if(!job.bytes) {
   const fal=job.offer.protocol==="fal-video";
   const response=await this.request(fal?"/fal/v1/video/retrieve":"/api/v1/video/retrieve",
    {model:`${job.offer.seller}@${job.offer.model}`,[fal?"request_id":"queue_id"]:job.id},
    {"x-antseed-provider":job.offer.provider,"x-antseed-service":job.offer.service,"x-antseed-request-id":job.downloadRequestId,"x-antseed-attribution-tag":job.tag},deadline);
   if(response.headers.get("content-type")?.split(";")[0]!=="video/mp4") {await this.bytes(response,100000);return null;}
   const bytes=await this.bytes(response,64*1024*1024);
   job={...job,bytes:bytes.toString("base64"),artifactHash:hash(bytes)};await save(job);
  }
  const bytes=Buffer.from(job.bytes!,"base64");await this.probe(bytes);
  let cursor=job.cursor,total=0n;const sequences:number[]=[];
  for(let page=0;page<100;page++) {
   const feed=await this.feed(cursor,deadline);
   if(feed.bootId!==job.bootId||feed.oldestSeq>cursor+1)throw new Error("antseed_receipt_history_lost");
   for(const e of feed.events)if(e.tag===job.tag) {
    if(e.sellerPeerId.toLowerCase()!==job.offer.seller.toLowerCase()||e.buyerIdentity!=="default"||e.purpose
     || typeof e.requestId!=="string"||typeof e.amountUsdc!=="string"||!/^\d{1,15}$/.test(e.amountUsdc)||!Number.isSafeInteger(e.seq)||e.seq<=cursor)throw new Error("antseed_receipt_mismatch");
    total+=BigInt(e.amountUsdc);sequences.push(e.seq);
   }
   if(feed.events.length<1000)break;
   if(feed.cursor<=cursor||page===99)throw new Error("antseed_receipt_history_incomplete");cursor=feed.cursor;
  }
  if(total===0n)return null;
  // Only exact attributed spend is billable. A partial/extra/mismatched receipt needs review.
  if(total!==BigInt(managedCharge(job.offer.upstreamUsd).upstreamMicrounits))throw new Error("antseed_receipt_amount_unconfirmed");
  return {receiptId:`antseed:${job.bootId}:${job.tag}`,usd:decimal(total,6),inputTokens:0,outputTokens:0,
   response:{model:"mycellios/antseed/video-edit",kind:"video-edit",artifactHash:job.artifactHash,receiptSequences:sequences}};
 }
}
