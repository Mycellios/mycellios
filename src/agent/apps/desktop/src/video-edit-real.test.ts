import { expect, it } from "vitest";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { VideoEditRuntime, type VideoEditCredits } from "./video-edit-runtime.js";
import { studioCommand } from "./apps-studio-runtime.js";
import {managedVideoEditClient} from "./video-edit-wallet.js";
import {createHash} from "node:crypto";
import type { VideoEditProject } from "../../../packages/contracts/src/video-edit.js";

/** Real MP4 transport/validation and local transformation; explicitly NOT model inference or real money. */
it.skipIf(!process.env.MYCELLIOS_FFMPEG_PATH || !process.env.MYCELLIOS_FFPROBE_PATH)("imports, edits, validates and recovers a real local MP4 with a test-only wallet",async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),"mycellios-video-physical-"));
 try {
  const ffmpeg=process.env.MYCELLIOS_FFMPEG_PATH!;
  const source=path.join(root,"test-source.mp4"), result=path.join(root,"test-result.mp4");
  await studioCommand(ffmpeg,["-y","-f","lavfi","-i","testsrc=size=320x240:rate=24","-t","3","-c:v","libx264","-pix_fmt","yuv420p","-threads","2",source],root,AbortSignal.timeout(30_000));
  let available=1_000_000, held=0, spent=0, creates=0;
  const records=new Map<string,string>();
  const credits:VideoEditCredits={
   reserve:async(_s,key,micros)=>{if(records.has(key))return;if(available<micros)throw new Error("Insufficient test credits");available-=micros;held+=micros;records.set(key,"reserved");},
   settle:async(_s,key,micros)=>{if(records.get(key)==="settled")return;if(records.get(key)!=="reserved")throw new Error("Missing test hold");held-=micros;spent+=micros;records.set(key,"settled");},
   release:async()=>{throw new Error("Unexpected refund in successful test");},
  };
  const offer={model:"local-ffmpeg-test-not-ai",seller:"test-only",protocol:"fal-video" as const,resolution:"240p",creditsMicros:100000};
  const provider={offers:async()=>[offer],create:async()=>{creates++;await studioCommand(ffmpeg,["-y","-i",source,"-vf","hue=s=0","-c:v","libx264","-threads","2",result],root,AbortSignal.timeout(30_000));return "local-test-job";},retrieve:async()=>({status:"ready" as const,bytes:await readFile(result)})};
  const runtime=new VideoEditRuntime(path.join(root,"projects"),provider,credits);
  const scope={owner:"test-account-not-real-money",space:"test-space",server:"local-test"};
  const request=(input:any)=>runtime.request(scope,input,async()=>true);
  const imported=await request({action:"import",name:"test-source.mp4",data:(await readFile(source)).toString("base64")}) as VideoEditProject;
  const quoted=await request({action:"quote",id:imported.id,prompt:"Local test: remove saturation; not AI"}) as VideoEditProject;
  await request({action:"submit",id:imported.id,quoteId:quoted.quote!.id});
  expect({available,held,spent,creates}).toEqual({available:900000,held:100000,spent:0,creates:1});
  const ready=await request({action:"get",id:imported.id}) as VideoEditProject;
  expect(ready.status).toBe("ready");expect(ready.resultHash).not.toBe(ready.sourceHash);
  await new VideoEditRuntime(path.join(root,"projects"),provider,credits).request(scope,{action:"get",id:imported.id},async()=>true);
  expect({available,held,spent,creates}).toEqual({available:900000,held:0,spent:100000,creates:1});
  let managedCreates=0;
  const output=await readFile(result),outputHash=createHash("sha256").update(output).digest("hex");
  const managed=managedVideoEditClient(scope,async(action,payload:any)=>{
   if(action==="quote")return {token:"fixture-signed-quote",maximumMicrounits:104000,expiresAt:Date.now()+60000,offer:{model:"local-ffmpeg-test-not-ai",seller:"test-only",protocol:"fal-video",resolution:"240p"}};
   if(action==="execute"){managedCreates++;expect(Buffer.from(payload.data,"base64")).toEqual(await readFile(source));return {status:"pending_reconciliation"};}
   if(action==="status")return {status:"completed",response:{artifactHash:outputHash,mycellios:{creditsMicrounits:104000}}};
   if(action==="content")return {data:output.toString("base64")};
   return {enabled:true};
  });
  const managedRoot=path.join(root,"managed-projects"),managedRuntime=new VideoEditRuntime(managedRoot,provider);
  const managedRequest=(input:any)=>managedRuntime.request(scope,input,async()=>true,managed);
  const importedManaged=await managedRequest({action:"import",name:"source.mp4",data:(await readFile(source)).toString("base64")}) as VideoEditProject;
  const managedQuote=await managedRequest({action:"quote",id:importedManaged.id,prompt:"Local MP4 test, not model inference"}) as VideoEditProject;
  await managedRequest({action:"submit",id:importedManaged.id,quoteId:managedQuote.quote!.id});
  const managedReady=await new VideoEditRuntime(managedRoot,provider).request(scope,{action:"get",id:importedManaged.id},async()=>true,managed) as VideoEditProject;
  expect(managedReady).toMatchObject({status:"ready",chargedCreditsMicros:104000,resultHash:outputHash});expect(managedCreates).toBe(1);
  if(process.env.VIDEO_EDIT_PROOF_DIRECTORY){
   const out=process.env.VIDEO_EDIT_PROOF_DIRECTORY;await mkdir(out,{recursive:true});await copyFile(source,path.join(out,"original.mp4"));await copyFile(result,path.join(out,"edited-local-test.mp4"));
   await writeFile(path.join(out,"receipt.json"),JSON.stringify({qualification:"real MP4 local FFmpeg test; NOT generative inference; NOT real Credits",inputHash:ready.sourceHash,outputHash:ready.resultHash,duration:ready.duration,available,held,spent,creates,managed:{creates:managedCreates,chargedTestCreditsMicros:managedReady.chargedCreditsMicros,resultHash:managedReady.resultHash}},null,2));
  }
 } finally {await rm(root,{recursive:true,force:true});}
},60_000);
