import type { FastifyInstance,FastifyRequest } from "fastify";
import { StripeBillingInbound } from "./billing-inbound.js";
import { WalletTopups } from "../economy/wallet-topups.js";

export function mountWalletTopups(app:FastifyInstance,wallet:WalletTopups,config:{secretKey:string;successUrl:string;cancelUrl:string;
 webhookSecrets:readonly string[];livemode:boolean},account:(req:FastifyRequest)=>{userId:string},transport:typeof fetch=fetch) {
 app.post("/v1/wallet/checkout",async(req,reply)=>{
  const owner=account(req),body=req.body as {dollars?:unknown},key=req.headers["idempotency-key"];
  if(typeof body?.dollars!=="number" || typeof key!=="string")return reply.code(400).send({error:{code:"wallet_topup_invalid"}});
  const quote=await wallet.quote(owner.userId,body.dollars,key);
  const fields=new URLSearchParams({mode:"payment",success_url:config.successUrl,cancel_url:config.cancelUrl,
   "line_items[0][price_data][currency]":"usd","line_items[0][price_data][unit_amount]":String(body.dollars*100),
   "line_items[0][price_data][product_data][name]":`${body.dollars} Mycellios Credits`,"line_items[0][quantity]":"1",
   "metadata[purpose]":"mycellios-wallet-v1","metadata[quote_id]":String(quote.id),"metadata[account_id]":owner.userId,
   "payment_intent_data[metadata][purpose]":"mycellios-wallet-v1","payment_intent_data[metadata][quote_id]":String(quote.id)});
  // Identical checkout retries cannot create a second charge/session at Stripe.
  const response=await transport("https://api.stripe.com/v1/checkout/sessions",{method:"POST",redirect:"error",signal:AbortSignal.timeout(20000),
   headers:{authorization:`Bearer ${config.secretKey}`,"content-type":"application/x-www-form-urlencoded","idempotency-key":"wallet-"+String(quote.id)},body:fields.toString()});
  if(!response.ok){await response.body?.cancel();throw new Error("wallet_checkout_unavailable");}
  const result=await response.json() as {id?:unknown;url?:unknown;livemode?:unknown};
  if(typeof result.id!=="string" || typeof result.url!=="string" || !result.url.startsWith("https://checkout.stripe.com/") || result.livemode!==config.livemode)throw new Error("wallet_checkout_invalid");
  await wallet.bind(String(quote.id),result.id);
  return {url:result.url,credits:body.dollars,currency:"USD"};
 });
 const verifier=new StripeBillingInbound({endpointSecrets:config.webhookSecrets,expectedLivemode:config.livemode});
 app.register(async scope=>{
  scope.removeContentTypeParser("application/json");
  scope.addContentTypeParser("application/json",{parseAs:"buffer",bodyLimit:1_000_000},(_req,body,done)=>done(null,body));
  scope.post("/webhooks/v1/wallet-stripe",async(req,reply)=>{
   const signature=req.headers["stripe-signature"];
   if(typeof signature!=="string" || !Buffer.isBuffer(req.body))return reply.code(401).send({error:{code:"wallet_signature_required"}});
   try{return await wallet.receive(verifier,req.body,signature);}catch{return reply.code(400).send({error:{code:"wallet_payment_rejected"}});}
  });
 });
}
