import {createHash,randomUUID} from "node:crypto";
import type {StudioScope} from "./apps-studio-runtime.js";
import type {VideoEditProject,VideoEditQuote} from "../../../packages/contracts/src/video-edit.js";

export type EditAction="info"|"quote"|"execute"|"status"|"content";
export class EditNotSubmittedError extends Error {}
export interface ManagedVideoEditService {
 info():Promise<boolean>;
 quote(project:VideoEditProject,prompt:string):Promise<VideoEditQuote>;
 submit(project:VideoEditProject,bytes:Buffer):Promise<void>;
 get(project:VideoEditProject):Promise<{ready:false}|{ready:true;bytes:Buffer;hash:string;credits:number}>;
}
/** Native-owned, authenticated RPC only. No wallet balance, receipt or release from the renderer. */
export function managedVideoEditClient(scope:StudioScope,call:(action:EditAction,payload:unknown)=>Promise<any>):ManagedVideoEditService {
 const digest=(s:string)=>createHash("sha256").update(s).digest("hex");
 return {
  info:async()=>(await call("info",{})).enabled===true,
  quote:async(project,prompt)=>{
   const projectKey=digest(JSON.stringify([scope.server,scope.owner,scope.space,project.id]));
   const request={model:"mycellios/antseed/video-edit",project:projectKey,prompt,
    source:{hash:project.sourceHash,duration:project.duration,width:project.width,height:project.height}};
   const value=await call("quote",request);
   if(!value.offer||typeof value.token!=="string"||!Number.isSafeInteger(value.maximumMicrounits)||value.maximumMicrounits<=0
    || !Number.isFinite(value.expiresAt)||!["fal-video","venice-video"].includes(value.offer.protocol))throw new Error("El presupuesto de Mycellios no es válido.");
   return {id:randomUUID(),model:value.offer.model,seller:value.offer.seller,protocol:value.offer.protocol,resolution:value.offer.resolution,
    creditsMicros:value.maximumMicrounits,expiresAt:new Date(value.expiresAt).toISOString(),sourceHash:project.sourceHash,promptHash:digest(prompt),
    managed:{token:value.token,request,key:"edit:"+projectKey}};
  },
  submit:async(project,bytes)=>{
   if(!project.quote?.managed)throw new Error("Solicita un presupuesto del monedero Mycellios.");
   const q=project.quote.managed;
   const result=await call("execute",{request:q.request,token:q.token,key:q.key,data:bytes.toString("base64")});
   if(result.status==="not_submitted")throw new EditNotSubmittedError(result.code==="insufficient_contribution_credits"?
    "No tienes suficientes créditos. No se ha enviado ni cobrado la edición.":"El presupuesto o el vídeo han cambiado. No se ha enviado ni cobrado la edición.");
  },
  get:async(project)=>{
   if(!project.quote?.managed)throw new Error("Este proyecto no tiene un pago Mycellios recuperable.");
   const key=project.quote.managed.key,value=await call("status",{key});
   if(value.status!=="completed")return {ready:false};
   const receipt=value.response;
   if(!receipt||typeof receipt.artifactHash!=="string"||!Number.isSafeInteger(receipt.mycellios?.creditsMicrounits)
    || receipt.mycellios.creditsMicrounits<0||receipt.mycellios.creditsMicrounits>project.quote.creditsMicros)throw new Error("No se pudo verificar el cobro del vídeo.");
   const file=await call("content",{key});
   if(typeof file.data!=="string"||file.data.length>89_478_488)throw new Error("El resultado supera el límite permitido.");
   const bytes=Buffer.from(file.data,"base64");
   if(bytes.toString("base64")!==file.data||createHash("sha256").update(bytes).digest("hex")!==receipt.artifactHash)throw new Error("El resultado no coincide con el recibo.");
   return {ready:true,bytes,hash:receipt.artifactHash,credits:receipt.mycellios.creditsMicrounits};
  },
 };
}
