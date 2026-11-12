import type { FastifyInstance,FastifyRequest } from "fastify";
import { ManagedMedia,MediaRequestSchema,type MediaRequest,type MediaQuote } from "./managed-media.js";
import type { ManagedGateway } from "./managed-gateway.js";
import type { ManagedPurchases } from "../economy/managed-purchases.js";

export function mountManagedMediaRoutes(app:FastifyInstance, provider:ManagedMedia,
 gateway:ManagedGateway<MediaRequest,MediaQuote,ReturnType<ManagedMedia["catalog"]>[number]>, purchases:ManagedPurchases,
 account:(req:FastifyRequest)=>{userId:string;apiKeyId:string|null}) {
 app.get("/v1/managed/media/models",async req=>{account(req);await provider.ensureFresh();return {provider:"Mycellios",data:await gateway.catalog()};});
 app.post("/v1/managed/media/quote",{bodyLimit:12_000_000},async(req)=>{
  return await gateway.quote(account(req).userId,MediaRequestSchema.parse(req.body));
 });
 app.post("/v1/managed/media/execute",{bodyLimit:12_000_000},async(req,reply)=>{
  const owner=account(req),input=req.body as {request:unknown;quoteToken:string},key=req.headers["idempotency-key"];
  if(typeof key!=="string" || typeof input?.quoteToken!=="string")return reply.code(400).send({error:{code:"managed_request_invalid"}});
  try {
   const result=await gateway.execute(owner.userId,owner.apiKeyId,key,MediaRequestSchema.parse(input.request),input.quoteToken);
   return reply.code(result.status==="completed"?200:202).send(result);
  }catch(error){
   const code=error instanceof Error?error.message:"";
   if(["insufficient_contribution_credits","managed_quote_expired_or_changed","managed_price_changed","managed_operator_budget_exceeded"].includes(code)
      &&!(await purchases.find(owner.userId,key)))return {status:"not_submitted",code};
   throw new Error("managed_media_request_unconfirmed");
  }
 });
 app.post("/v1/managed/media/status",async(req,reply)=>{
  const owner=account(req), key=(req.body as {idempotencyKey?:unknown})?.idempotencyKey;
  if(typeof key!=="string" || key.length<8 || key.length>200)return reply.code(400).send({error:{code:"managed_request_invalid"}});
  const row=await purchases.find(owner.userId,key);
  if(!row||row.provider!==provider.provider||!String(row.model).startsWith("mycellios/media/"))return reply.code(404).send({error:{code:"managed_request_not_found"}});
  if(row.state==="settled")return {status:"completed",response:JSON.parse(String(row.response_json))};
  if(row.pending_receipt_json)return await gateway.reconcile(owner.userId,key);
  if(typeof row.remote_job_json!=="string")return {status:"pending_reconciliation",requestId:row.usage_id};
  const lease=await purchases.claimPoll(String(row.usage_id),owner.userId);
  if(lease===null)return {status:"running",requestId:row.usage_id};
  try {
  const result=await provider.poll(JSON.parse(row.remote_job_json),job=>purchases.savePollJob(String(row.usage_id),owner.userId,lease,job));
  if(!result)return {status:"running",requestId:row.usage_id};
  // Concurrent polls may both see completion. The billing claim serializes inside the wallet;
  // a later poll replays the persisted response instead of making another paid request.
  try {return await gateway.completeKnown(String(row.usage_id),owner.userId,result);}
  catch {const latest=await purchases.find(owner.userId,key);if(latest?.state==="settled")return {status:"completed",response:JSON.parse(String(latest.response_json))};throw new Error("managed_media_reconciliation_required");}
  }finally{await purchases.releasePoll(String(row.usage_id),lease);}
 });
 app.post("/v1/managed/media/content",async(req,reply)=>{
  const owner=account(req),key=(req.body as {idempotencyKey?:unknown})?.idempotencyKey;
  if(typeof key!=="string" || key.length>200)return reply.code(400).send({error:{code:"managed_request_invalid"}});
  const row=await purchases.find(owner.userId,key);
  if(row?.provider!==provider.provider||!String(row.model).startsWith("mycellios/media/")||row?.state!=="settled" || typeof row.remote_job_json!=="string")return reply.code(404).send({error:{code:"managed_result_unavailable"}});
  const job=JSON.parse(row.remote_job_json) as {id:string;kind?:string};
  if(job.kind!=="video")return reply.code(404).send({error:{code:"managed_result_unavailable"}});
  return reply.type("video/mp4").header("cache-control","private, no-store").send(await provider.content(job.id));
 });
}
