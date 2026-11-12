import {describe,it,expect,vi} from "vitest";
import {createHash} from "node:crypto";
import {ManagedAntseedEdit} from "../src/coordinator/managed-antseed-edit.js";
import type {ManagedEditJob} from "../src/contracts/video-edit.js";
const bytes=Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from("ftyp"),Buffer.alloc(40)]);
const source={duration:5.3,width:1280,height:720};
const input={model:"mycellios/antseed/video-edit" as const,project:"a".repeat(64),prompt:"Make it rain",source:{...source,hash:createHash("sha256").update(bytes).digest("hex")}};
const peer={peerId:"peer",provider:"seller-video",serviceId:"wan",protocol:"fal-video",capabilities:{video:{inputs:["video"],requiredInputs:["video"],resolutions:["720p"]}},unitBillingModels:{"fal-video":{components:[{unit:"video_seconds",priceUsd:0.02,match:{resolution:"720p",model:"wan"}}]}}};
const catalog=()=>Response.json({data:[{id:"wan",peers:[peer]}]});
const feed=(events:unknown[]=[],extra={})=>Response.json({bootId:"boot-one",oldestSeq:1,cursor:events.length,events,capabilities:["video-budget"],...extra});
describe("managed AntSeed editor without any real network spend",()=>{
 it("prices exact seller units and adds 4 percent once, without sending a clip for a quote",async()=>{
  const fetcher=vi.fn<typeof fetch>().mockResolvedValue(catalog());const p=new ManagedAntseedEdit("fixture",fetcher,async()=>source);await p.ensureFresh();
  expect(p.quote(input)).toMatchObject({maximumUsd:"0.1",maximumMicrounits:104000});
  expect(fetcher).toHaveBeenCalledTimes(1);expect(fetcher.mock.calls[0]![1]?.method).toBe("GET");
 });
 it("pins provider and seller and uses fal request_id with string duration, persisting before queue",async()=>{
  const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(catalog()).mockResolvedValueOnce(feed()).mockResolvedValueOnce(Response.json({request_id:"fal-job"}));
  const p=new ManagedAntseedEdit("fixture",fetcher,async()=>source);await p.ensureFresh();const save=vi.fn(async(_job:unknown)=>{});
  await expect(p.execute(p.quote(input),undefined,save,bytes)).rejects.toThrow("pending");
  expect(save.mock.calls).toHaveLength(2);expect(save.mock.calls[0]![0]).toMatchObject({id:""});expect(save.mock.calls[1]![0]).toMatchObject({id:"fal-job"});
  const options=fetcher.mock.calls[2]![1]!;expect(JSON.parse(String(options.body))).toMatchObject({model:"peer@wan",duration:"5",video_url:"data:video/mp4;base64,"+bytes.toString("base64")});
  expect(options.headers).toMatchObject({"x-antseed-provider":"seller-video","x-antseed-service":"wan","x-antseed-max-video-usdc":"100000"});
  expect(save.mock.invocationCallOrder[0]).toBeLessThan(fetcher.mock.invocationCallOrder[2]!);
 });
 it("persists delivered bytes before reading exact attributed spend, then resumes without another download",async()=>{
  const job:ManagedEditJob={id:"fal-job",offer:{model:"wan",seller:"peer",provider:"seller-video",service:"wan",protocol:"fal-video",resolution:"720p",upstreamUsd:"0.1",creditsMicros:104000},tag:"tag-one",downloadRequestId:"request-one",bootId:"boot-one",cursor:0};
  const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(bytes,{headers:{"content-type":"video/mp4"}})).mockResolvedValueOnce(feed())
   .mockResolvedValueOnce(feed([{seq:1,tag:"tag-one",requestId:"request-one",sellerPeerId:"peer",buyerIdentity:"default",amountUsdc:"100000"}]));
  const p=new ManagedAntseedEdit("fixture",fetcher,async()=>source);let saved=job;
  expect(await p.poll(job,async v=>{saved=v;})).toBeNull();expect(saved.bytes).toBe(bytes.toString("base64"));
  expect(await p.poll(saved,async()=>{})).toMatchObject({usd:"0.1",receiptId:"antseed:boot-one:tag-one"});
  expect(fetcher.mock.calls.filter(([,v])=>v?.method==="POST")).toHaveLength(1);
 });
 it("refuses source hash or probe mismatches before any buyer call",async()=>{
  const fetcher=vi.fn<typeof fetch>(),p=new ManagedAntseedEdit("fixture",fetcher,async()=>({...source,width:1920}));
  await expect(p.validateSource(input,bytes.toString("base64"))).rejects.toThrow("changed");
  await expect(p.validateSource({...input,source:{...input.source,hash:"b".repeat(64)}},bytes.toString("base64"))).rejects.toThrow("changed");
  expect(fetcher).not.toHaveBeenCalled();
 });
 it("never bills missing, truncated, foreign or over-budget spend as a successful edit",async()=>{
  const offer={model:"wan",seller:"peer",provider:"video",service:"wan",protocol:"fal-video" as const,resolution:"720p",upstreamUsd:"0.1",creditsMicros:104000};
  const job={id:"job",offer,tag:"tag",downloadRequestId:"req",bootId:"boot-one",cursor:0,bytes:bytes.toString("base64")};
  for(const change of [{oldestSeq:5},{bootId:"lost"},{events:[{seq:1,tag:"tag",requestId:"req",sellerPeerId:"wrong",buyerIdentity:"default",amountUsdc:"100000"}]},{events:[{seq:1,tag:"tag",requestId:"req",sellerPeerId:"peer",buyerIdentity:"default",amountUsdc:"200000"}]}]) {
   const p=new ManagedAntseedEdit("fixture",vi.fn<typeof fetch>().mockResolvedValue(feed([],change)),async()=>source);
   await expect(p.poll(job,async()=>{})).rejects.toThrow();
  }
 });
 it("does not admit unsupported billing dimensions or a price without exact USDC precision",async()=>{
  const fetcher=vi.fn<typeof fetch>().mockResolvedValue(Response.json({data:[{id:"wan",peers:[{...peer,unitBillingModels:{"fal-video":{components:[{unit:"video_seconds",priceUsd:0.00000001}]}}}]}]}));
  const p=new ManagedAntseedEdit("fixture",fetcher);await p.ensureFresh();expect(()=>p.quote(input)).toThrow("no_compatible_offer");
 });
});
