import {describe,it,expect,vi} from "vitest";
import {ManagedMediaCatalog} from "../src/coordinator/managed-media-catalog.js";
import {ManagedMedia} from "../src/coordinator/managed-media.js";
import {mediaCost,managedAudioSeconds} from "../src/coordinator/managed-media-cost.js";
import type {MediaCostContract} from "../src/contracts/managed-provider.js";
import {managedCharge} from "../src/economy/managed-pricing.js";

const general=(id:string,kind:string,pricing={prompt:"0.00001",completion:"0"})=>({id,name:id,context_length:kind==="transcription"?0:131072,
 architecture:{output_modalities:[kind]},pricing,supported_voices:["alloy"],endpoints:kind==="text"?["/api/v1/batches"]:[]});
function fixture(extraGeneral:unknown[]=[],extraVideo:unknown[]=[],imagePricing:unknown[]=[{billable:"output_image",unit:"image",cost_usd:0.04}]) {
 const transport=vi.fn<typeof fetch>(async(url,init)=>{
  if(init?.method!=="GET")throw new Error("Inference forbidden in metadata tests");
  const path=String(url);
  if(path.endsWith("/models?output_modalities=all"))return Response.json({data:[general("vendor/voice","speech"),general("vendor/stt","transcription"),general("vendor/embed","embeddings"),general("vendor/rank","rerank"),general("vendor/text:batch","text",{prompt:"0.000001",completion:"0.000002"}),...extraGeneral]});
  if(path.endsWith("/videos/models"))return Response.json({data:[{id:"vendor/movie",name:"Movie",supported_durations:[3,5],supported_resolutions:["720p"],supported_aspect_ratios:["16:9"],pricing_skus:{cents_per_video_output_second_720p:"3"}},...extraVideo]});
  if(path.endsWith("/images/models"))return Response.json({data:[{id:"vendor/image",name:"Image"}]});
  if(path.endsWith("/images/models/vendor/image/endpoints"))return Response.json({id:"vendor/image",endpoints:[{provider_tag:"pinned",supported_parameters:{n:{type:"range",min:1,max:1},aspect_ratio:{type:"enum",values:["1:1"]},size:{type:"boolean"}},pricing:imagePricing}]});
  throw new Error("Unexpected metadata path");
 });return {transport,catalog:new ManagedMediaCatalog("fixture",["*"],transport)};
}
export function pcm(seconds=1) {
 const b=Buffer.alloc(44+Math.floor(seconds*32000));b.write("RIFF");b.writeUInt32LE(b.length-8,4);b.write("WAVEfmt ",8);b.writeUInt32LE(16,16);
 b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write("data",36);b.writeUInt32LE(b.length-44,40);return b.toString("base64");
}
describe("bounded media and special model discovery",()=>{
 it("discovers image, character voice, duration STT/video, embeddings, rerank and batch using metadata only",async()=>{
  const {catalog,transport}=fixture(),offers=await catalog.load();
  expect(offers.map(v=>v.kind).sort()).toEqual(["batch","embeddings","image","rerank","speech","transcription","video"]);
  expect(transport.mock.calls.every(([,v])=>v?.method==="GET"&&v.redirect==="error")).toBe(true);
  await catalog.load();expect(transport).toHaveBeenCalledTimes(4);
  expect(offers.every(v=>/^sha256:[a-f0-9]{64}$/.test(v.costContract?.sourceDigest??""))).toBe(true);
 });
 it("calculates signed request bounds from actual characters, PCM duration, cents and each batch line",async()=>{
  const {catalog}=fixture(),offers=await catalog.load(),p=new ManagedMedia("fixture",offers,vi.fn(),550);
  const id=(kind:string)=>offers.find(o=>o.kind===kind)!.id;
  const voice=p.quote({model:id("speech"),kind:"speech",prompt:"Hola",voice:"alloy"});
  expect(voice.maximumUsd).toBe("0.00004");expect(voice.maximumMicrounits).toBe(managedCharge("0.00004",550).totalMicrounits);
  expect(p.quote({model:id("transcription"),kind:"transcription",audio:{data:pcm(1.5),format:"wav"}}).maximumUsd).toBe("0.00002");
  const video=p.quote({model:id("video"),kind:"video",prompt:"Tree",duration:5});expect(video.maximumUsd).toBe("0.15");expect(video.body).toMatchObject({duration:5,resolution:"720p",generate_audio:false});
  const image=p.quote({model:id("image"),kind:"image",prompt:"Tree"});expect(image.maximumUsd).toBe("0.04");expect(image.body.provider).toEqual({only:["pinned"],allow_fallbacks:false});
  const first=p.quote({model:id("batch"),kind:"batch",prompts:["a"],max_tokens:10}),second=p.quote({model:id("batch"),kind:"batch",prompts:["a","a"],max_tokens:10});
  expect(Number(second.maximumUsd)).toBe(Number(first.maximumUsd)*2);expect(first.body.model).toBe("vendor/text");
  expect(Object.keys(first.body).indexOf("requests")).toBeGreaterThan(Object.keys(first.body).indexOf("provider"));
 });
 it("prices the query for every rerank document, not just once",async()=>{
  const {catalog}=fixture(),offers=await catalog.load(),p=new ManagedMedia("fixture",offers,vi.fn(),0),o=offers.find(v=>v.kind==="rerank")!;
  const one=p.quote({model:o.id,kind:"rerank",prompt:"q",documents:["a"]}),two=p.quote({model:o.id,kind:"rerank",prompt:"q",documents:["a","a"]});
  expect(Number(two.maximumUsd)).toBe(Number(one.maximumUsd)*2);
 });
 it("keeps unsupported output-second/token units and unknown video SKUs unavailable",async()=>{
  const {catalog}=fixture([general("vendor/unbounded-voice","speech",{prompt:"0",completion:"0.1"})],[{id:"vendor/unknown-video",pricing_skus:{surprise_fee:"1"}}],[{billable:"output_image",unit:"token",cost_usd:0.01}]);
  const offers=await catalog.load();expect(offers.some(o=>o.kind==="image"||o.upstreamId.includes("unbounded")||o.upstreamId.includes("unknown"))).toBe(false);
  expect(catalog.inventory().length).toBeGreaterThanOrEqual(3);
 });
 it("qualifies text Decisions on their own endpoint and blocks extraction-only or priced web search variants",async()=>{
  const decision={...general("vendor/decision","decisions"),architecture:{input_modalities:["text"],output_modalities:["decisions"]},endpoints:["/api/alpha/decisions"]};
  const {catalog}=fixture([decision,{...decision,id:"vendor/extract",endpoints:["/api/alpha/extractions"]},{...decision,id:"vendor/search",pricing:{prompt:"0",completion:"0",web_search:"0.1"}}]);
  const offers=await catalog.load(),offer=offers.find(v=>v.kind==="decisions")!;expect(offer).toBeTruthy();expect(offers.filter(v=>v.kind==="decisions")).toHaveLength(1);
  const p=new ManagedMedia("fixture",offers,vi.fn(),0),q=p.quote({model:offer.id,kind:"decisions",prompt:"Is this urgent?",state:"Review tomorrow."});
  expect(q.body).toMatchObject({state:"Review tomorrow.",questions:{answer:{type:"noul",instructions:"Is this urgent?"}},provider:{allow_fallbacks:false}});
  expect(Number(q.maximumUsd)).toBeGreaterThan(Number(p.quote({model:offer.id,kind:"decisions",prompt:"Is this urgent?",state:"a"}).maximumUsd));
 });
 it("fails before a paid call for compressed/spoofed audio and caller-injected controls",async()=>{
  const {catalog}=fixture(),offers=await catalog.load(),transport=vi.fn(),p=new ManagedMedia("fixture",offers,transport,0),o=offers.find(v=>v.kind==="transcription")!;
  expect(()=>p.quote({model:o.id,kind:"transcription",audio:{data:Buffer.from("ID3fake").toString("base64"),format:"mp3"}})).toThrow("pcm_wav");
  const forged=Buffer.from(pcm(),"base64");forged.writeUInt32LE(100,40);
  expect(()=>p.quote({model:o.id,kind:"transcription",audio:{data:forged.toString("base64"),format:"wav"}})).toThrow("integrity");
  expect(()=>p.quote({model:o.id,kind:"transcription",audio:{data:pcm(),format:"wav"},provider:{only:["evil"]}} as never)).toThrow();expect(transport).not.toHaveBeenCalled();
 });
 it("supports exact-zero media without a funded policy and preserves decimal discovery fees",async()=>{
  const {catalog}=fixture([],[],[{billable:"output_image",unit:"image",cost_usd:0}]),offers=await catalog.load();
  const p=new ManagedMedia("fixture",offers,vi.fn()),image=offers.find(v=>v.kind==="image")!;
  expect(p.quote({model:image.id,kind:"image",prompt:"x"}).maximumMicrounits).toBe(0);
  expect(p.catalog().map(v=>v.modality)).toEqual(["image"]);
 });
 it("validates native PCM lengths and rejects undeclared cost units",()=>{
  expect(managedAudioSeconds({data:pcm(0.5),format:"wav"})).toBe(1);
  const contract:MediaCostContract={version:1,sourceDigest:"sha256:"+"a".repeat(64),components:[{unit:"surprise" as never,usd:"1"}],controls:{}};
  expect(()=>mediaCost(contract,{prompt:"x"})).toThrow("unit_unsupported");
 });
});
