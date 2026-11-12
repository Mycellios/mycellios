import { describe, expect, it, vi } from "vitest";
import { AntseedVideoEditProvider } from "./video-edit-provider.js";
const source={duration:5.9,width:1280,height:720};
const peer={peerId:"peer",protocol:"fal-video",serviceId:"wan",capabilities:{video:{inputs:["video"],requiredInputs:["video"],resolutions:["720p"]}},unitBillingModels:{"fal-video":{components:[{unit:"video_seconds",priceUsd:.02,match:{resolution:"720p",model:"wan"}}]}}};
describe("Antseed edit protocol",()=>{
 it("quotes the whole-second source duration from the advertised seller pricing",async()=>{
  const provider=new AntseedVideoEditProvider(vi.fn(async()=>Response.json({data:[{id:"wan",peers:[peer]}]})) as typeof fetch);
  expect(await provider.offers(source)).toEqual([{model:"wan",seller:"peer",protocol:"fal-video",resolution:"720p",creditsMicros:100000}]);
 });
 it("does not invent prices or admit models that require unavailable reference images",async()=>{
  const provider=new AntseedVideoEditProvider(vi.fn(async()=>Response.json({data:[{id:"wan",peers:[{...peer,unitBillingModels:{}},{...peer,capabilities:{video:{inputs:["video"],requiredInputs:["video","reference_image"],resolutions:["720p"]}}}]}]})) as typeof fetch);
  expect(await provider.offers(source)).toEqual([]);
 });
 it("pins the approved seller, sends inline MP4 and submits exactly once",async()=>{
  const fetcher=vi.fn(async()=>Response.json({request_id:"job"}));const provider=new AntseedVideoEditProvider(fetcher as typeof fetch);
  await provider.create({model:"wan",seller:"peer",protocol:"fal-video",resolution:"720p",creditsMicros:100000},"Rain",Buffer.from("clip"),source);
  const [url,options]=fetcher.mock.calls[0] as unknown as [string,RequestInit];
  expect(url).toContain("/fal/v1/video/queue");expect(JSON.parse(String(options.body))).toMatchObject({model:"peer@wan",duration:"5",video_url:"data:video/mp4;base64,Y2xpcA=="});expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it("refuses an untrusted proxy destination",()=>{expect(()=>new AntseedVideoEditProvider(fetch,"http://attacker.invalid")).toThrow();});
});
