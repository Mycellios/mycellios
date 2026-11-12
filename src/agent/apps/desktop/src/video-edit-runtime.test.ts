import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { VideoEditRuntime } from "./video-edit-runtime.js";
import type { VideoEditProject } from "../../../packages/contracts/src/video-edit.js";
const dirs: string[]=[];
afterEach(async()=>{for(const dir of dirs.splice(0))await rm(dir,{recursive:true,force:true});});
const scope={owner:"one",space:"space",server:"local"};
const source=Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from("ftyp"),Buffer.alloc(40)]);
async function fixture(connected=true) {
 const root=await mkdtemp(path.join(os.tmpdir(),"mycellios-video-edit-test-"));dirs.push(root);
 const offer={model:"wan-edit",seller:"seller",protocol:"fal-video" as const,resolution:"720p",creditsMicros:200000};
 const provider={offers:vi.fn(async()=>[offer]),create:vi.fn(async()=>"job-1"),retrieve:vi.fn(async()=>({status:"ready" as const,bytes:source}))};
 const credits={reserve:vi.fn(async()=>{}),settle:vi.fn(async()=>{}),release:vi.fn(async()=>{})};
 const command=vi.fn(async()=>JSON.stringify({format:{duration:"5.3"},streams:[{codec_type:"video",codec_name:"h264",width:1280,height:720}]}));
 const runtime=new VideoEditRuntime(root,provider,connected?credits:undefined,command);
 const request=(input:any,identity=scope)=>runtime.request(identity,input,async()=>true);
 const project=await request({action:"import",name:"clip.mp4",data:source.toString("base64")}) as VideoEditProject;
 const quote=await request({action:"quote",id:project.id,prompt:"Make it rain"}) as VideoEditProject;
 return {root,provider,credits,runtime,request,project,quote};
}
describe("local video edit lifecycle",()=>{
 it("reserves once before creating and settles only after validating a delivered video",async()=>{
  const f=await fixture();const input={action:"submit",id:f.project.id,quoteId:f.quote.quote!.id};
  await Promise.all([f.request(input),f.request(input)]);
  expect(f.provider.create).toHaveBeenCalledTimes(1);expect(f.credits.reserve).toHaveBeenCalledTimes(1);expect(f.credits.settle).not.toHaveBeenCalled();
  expect(await f.request({action:"get",id:f.project.id})).toMatchObject({status:"ready"});
  await f.request({action:"get",id:f.project.id});expect(f.credits.settle).toHaveBeenCalledTimes(1);
 });
 it("blocks paid submission when no authoritative credits adapter is connected",async()=>{
  const f=await fixture(false);await expect(f.request({action:"submit",id:f.project.id,quoteId:f.quote.quote!.id})).rejects.toThrow("no está conectado");expect(f.provider.create).not.toHaveBeenCalled();
 });
 it("does not replay an uncertain create, including after restarting the local runtime",async()=>{
  const f=await fixture();f.provider.create.mockRejectedValueOnce(new Error("timeout"));
  const input={action:"submit",id:f.project.id,quoteId:f.quote.quote!.id};
  expect(await f.request(input)).toMatchObject({status:"uncertain"});
  const restarted=new VideoEditRuntime(f.root,f.provider,f.credits);
  await restarted.request(scope,input as any,async()=>true);
  expect(f.provider.create).toHaveBeenCalledTimes(1);expect(f.credits.release).not.toHaveBeenCalled();
 });
 it("rejects changed prices and foreign projects before reserving or uploading",async()=>{
  const f=await fixture();f.provider.offers.mockResolvedValueOnce([{...f.quote.quote!,creditsMicros:300000}]);
  await expect(f.request({action:"submit",id:f.project.id,quoteId:f.quote.quote!.id})).rejects.toThrow("han cambiado");
  await expect(f.request({action:"get",id:f.project.id},{...scope,owner:"other"})).rejects.toThrow();
  expect(f.provider.create).not.toHaveBeenCalled();expect(f.credits.reserve).not.toHaveBeenCalled();
 });
 it("never uploads when the wallet refuses the reservation",async()=>{
  const f=await fixture();f.credits.reserve.mockRejectedValueOnce(new Error("Insufficient credits"));
  await expect(f.request({action:"submit",id:f.project.id,quoteId:f.quote.quote!.id})).rejects.toThrow("Insufficient");expect(f.provider.create).not.toHaveBeenCalled();
 });
 it("releases a failed job once and keeps it from being submitted again",async()=>{
  const f=await fixture();await f.request({action:"submit",id:f.project.id,quoteId:f.quote.quote!.id});
  f.provider.retrieve.mockResolvedValueOnce({status:"failed"} as any);
  expect(await f.request({action:"get",id:f.project.id})).toMatchObject({status:"failed"});
  await f.request({action:"get",id:f.project.id});await f.request({action:"submit",id:f.project.id,quoteId:f.quote.quote!.id});
  expect(f.credits.release).toHaveBeenCalledTimes(1);expect(f.credits.settle).not.toHaveBeenCalled();expect(f.provider.create).toHaveBeenCalledTimes(1);
 });
 it("rechecks access before dispatch and does not settle invalid output",async()=>{
  const f=await fixture();await expect(f.runtime.request(scope,{action:"get",id:f.project.id},async()=>false)).rejects.toThrow("sesión");
  await f.request({action:"submit",id:f.project.id,quoteId:f.quote.quote!.id});
  f.provider.retrieve.mockResolvedValueOnce({status:"ready",bytes:Buffer.from("not a video")});
  await expect(f.request({action:"get",id:f.project.id})).rejects.toThrow("MP4 válido");expect(f.credits.settle).not.toHaveBeenCalled();
 });
});
