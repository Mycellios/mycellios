import type {FastifyInstance,FastifyRequest} from "fastify";
import {ManagedEditRequestSchema,type ManagedEditRequest,type ManagedEditJob} from "../contracts/video-edit.js";
import type {ManagedGateway} from "./managed-gateway.js";
import {ManagedAntseedEdit,type EditQuote} from "./managed-antseed-edit.js";
import type {ManagedPurchases} from "../economy/managed-purchases.js";
import type {ContributionCreditWallet} from "../economy/contribution-credit-wallet.js";
import type {MeshDatabase} from "../storage/database.js";

export function mountManagedVideoEdit(app:FastifyInstance,provider:ManagedAntseedEdit,
 gateway:ManagedGateway<ManagedEditRequest,EditQuote,ReturnType<ManagedAntseedEdit["catalog"]>[number]>,
 purchases:ManagedPurchases,db:MeshDatabase,wallet:ContributionCreditWallet,
 account:(req:FastifyRequest)=>{userId:string;apiKeyId:string|null}) {
 const keyFor=(body:unknown)=>{const key=(body as {key?:unknown})?.key;if(typeof key!=="string"||!/^edit:[a-f0-9]{64}$/.test(key))throw new Error("video_edit_key_invalid");return key;};
 app.get("/v1/managed/video-edit/info",async req=>{
  const owner=account(req);await provider.ensureFresh();return {enabled:true,balanceMicrounits:(await wallet.summary("account",owner.userId)).availableMicrounits};
 });
 app.post("/v1/managed/video-edit/quote",async req=>{
  const request=ManagedEditRequestSchema.parse(req.body),owner=account(req);
  const value=await gateway.quote(owner.userId,request),offer=provider.quote(request).offer;
  return {...value,offer:{model:offer.model,seller:offer.seller,protocol:offer.protocol,resolution:offer.resolution,creditsMicros:offer.creditsMicros}};
 });
 app.post("/v1/managed/video-edit/execute",{bodyLimit:34_000_000},async(req,reply)=>{
  const owner=account(req),body=req.body as {request:unknown;token:unknown;data:unknown},key=keyFor(req.body);
  const request=ManagedEditRequestSchema.parse(body.request);
  if(key!=="edit:"+request.project||typeof body.token!=="string")throw new Error("video_edit_quote_invalid");
  const replay=await gateway.replayFor(owner.userId,key,request);if(replay)return replay;
  let result;
  try {
   const bytes=await provider.validateSource(request,body.data);
   result=await gateway.execute(owner.userId,owner.apiKeyId,key,request,body.token,undefined,bytes);
  }catch(error){
   const code=error instanceof Error?error.message:"";
   if(["insufficient_contribution_credits","managed_quote_expired_or_changed","managed_price_changed","video_edit_source_changed","video_edit_source_invalid"].includes(code))
    return {status:"not_submitted",code};
   throw error;
  }
  return reply.code(result.status==="completed"?200:202).send(result);
 });
 app.post("/v1/managed/video-edit/status",async req=>{
  const owner=account(req),key=keyFor(req.body),row=await purchases.find(owner.userId,key);
  if(!row||row.provider!==provider.provider)throw new Error("video_edit_purchase_not_found");
  if(row.state==="settled")return {status:"completed",response:JSON.parse(String(row.response_json))};
  if(row.pending_receipt_json)return await gateway.reconcile(owner.userId,key);
  if(typeof row.remote_job_json!=="string")return {status:"pending_reconciliation"};
  const now=Date.now(),lease=now+240000;
  const claim=await db.raw.prepare(`UPDATE economic_managed_purchases SET poll_until=? WHERE usage_id=?
   AND state IN ('submitted','uncertain') AND COALESCE(poll_until,0)<=?`).run(lease,String(row.usage_id),now);
  if(Number(claim.changes)!==1)return {status:"running"};
  try {
   const result=await provider.poll(JSON.parse(row.remote_job_json) as ManagedEditJob,async job=>{
    const saved=await db.raw.prepare("UPDATE economic_managed_purchases SET remote_job_json=? WHERE usage_id=? AND poll_until=?")
     .run(JSON.stringify(job),String(row.usage_id),lease);
    if(Number(saved.changes)!==1)throw new Error("video_edit_poll_claim_lost");
   });
   return result?await gateway.completeKnown(String(row.usage_id),owner.userId,result):{status:"running"};
  }finally{await db.raw.prepare("UPDATE economic_managed_purchases SET poll_until=0 WHERE usage_id=? AND poll_until=?").run(String(row.usage_id),lease);}
 });
 app.post("/v1/managed/video-edit/content",async(req,reply)=>{
  const owner=account(req),row=await purchases.find(owner.userId,keyFor(req.body));
  if(row?.provider!==provider.provider||row.state!=="settled"||typeof row.remote_job_json!=="string")throw new Error("video_edit_result_unavailable");
  const job=JSON.parse(row.remote_job_json) as ManagedEditJob;if(!job.bytes)throw new Error("video_edit_result_unavailable");
  return reply.type("video/mp4").header("cache-control","private, no-store").send(Buffer.from(job.bytes,"base64"));
 });
}
