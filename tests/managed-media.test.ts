import {describe,it,expect,vi} from "vitest";
import {ManagedMedia,type MediaOffer} from "../src/coordinator/managed-media.js";
const offer=(kind:MediaOffer["kind"]):MediaOffer=>({id:"mycellios/media/"+kind,upstreamId:"vendor/"+kind,name:kind,kind,maximumUsd:"1",expiresAt:Date.now()+60000,voices:["alloy"],durations:[5]});
describe("managed media without spending",()=>{
 it("normalizes images with actual cost receipts under Mycellios",async()=>{
  const transport=vi.fn<typeof fetch>().mockResolvedValue(new Response('{"data":[{"b64_json":"aGVsbG8=","media_type":"image/png"}],"usage":{"cost":0.04}}',{headers:{"x-generation-id":"gen-image"}}));
  const provider=new ManagedMedia("fixture",[offer("image")],transport,0);
  const q=provider.quote({model:offer("image").id,kind:"image",prompt:"A tree"});
  expect(q.maximumMicrounits).toBe(1040000);
  const result=await provider.execute(q);expect(result.usd).toBe("0.04");expect(result.response.kind).toBe("image");
  expect(String(transport.mock.calls[0]![0]).endsWith("/images")).toBe(true);
 });
 it("uses the dedicated speech route and reads its matching actual-cost generation",async()=>{
  const transport=vi.fn<typeof fetch>().mockResolvedValueOnce(new Response("ID3fixture",{headers:{"content-type":"audio/mpeg","x-generation-id":"gen-speech"}}))
   .mockResolvedValueOnce(new Response('{"data":{"id":"gen-speech","total_cost":0.1}}'));
  const p=new ManagedMedia("fixture",[offer("speech")],transport,0);
  expect((await p.execute(p.quote({model:offer("speech").id,kind:"speech",prompt:"Hola",voice:"alloy"}))).usd).toBe("0.1");
  expect(transport).toHaveBeenCalledTimes(2);
 });
 it("transcribes JSON audio with an authoritative usage cost",async()=>{
  const transport=vi.fn<typeof fetch>().mockResolvedValue(new Response('{"text":"Hola","usage":{"cost":0.01}}',{headers:{"x-generation-id":"gen-transcription"}}));
  const p=new ManagedMedia("fixture",[offer("transcription")],transport,0);
  const data=Buffer.from("RIFF1234WAVEdata").toString("base64");
  expect((await p.execute(p.quote({model:offer("transcription").id,kind:"transcription",audio:{data,format:"wav"}}))).response.text).toBe("Hola");
 });
 it("persists async video identity before polling, never repeats the create",async()=>{
  const transport=vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({id:"video-one",status:"queued"}))
   .mockResolvedValueOnce(new Response('{"id":"video-one","status":"completed","generation_id":"gen-video","usage":{"cost":0.5}}'));
  const p=new ManagedMedia("fixture",[offer("video")],transport,0),persist=vi.fn(async()=>{});
  await expect(p.execute(p.quote({model:offer("video").id,kind:"video",prompt:"A tree",duration:5}),undefined,persist)).rejects.toThrow("pending");
  expect(persist).toHaveBeenCalledWith({id:"video-one",model:offer("video").id,kind:"video"});
  expect((await p.poll({id:"video-one",model:offer("video").id}))?.usd).toBe("0.5");
  expect(transport.mock.calls.filter(c=>c[1]?.method==="POST")).toHaveLength(1);
 });
 it("rejects stale prices, unknown controls and unapproved voices before a paid call",()=>{
  const p=new ManagedMedia("fixture",[offer("speech"),{...offer("image"),expiresAt:0}],fetch,0);
  expect(()=>p.quote({model:offer("speech").id,kind:"speech",prompt:"hello",voice:"unknown"})).toThrow();
  expect(()=>p.quote({model:offer("image").id,kind:"image",prompt:"hello"})).toThrow();
 });
});
describe("durable special-model results",()=>{
 const contract={version:1 as const,sourceDigest:"sha256:"+"a".repeat(64),components:[{unit:"input_token" as const,usd:"0.001"},{unit:"output_token" as const,usd:"0.001"}],controls:{},maxOutputTokens:8192};
 it("recovers speech bytes and a late cost invoice without repeating synthesis",async()=>{
  const transport=vi.fn<typeof fetch>().mockResolvedValueOnce(new Response("ID3fixture",{headers:{"content-type":"audio/mpeg","x-generation-id":"gen-voice"}}))
    .mockResolvedValueOnce(new Response(null,{status:503})).mockResolvedValueOnce(new Response('{"data":{"id":"gen-voice","total_cost":0.001}}'));
  const p=new ManagedMedia("fixture",[offer("speech")],transport,550),saved:unknown[]=[];
  await expect(p.execute(p.quote({model:offer("speech").id,kind:"speech",prompt:"hola",voice:"alloy"}),undefined,async job=>{saved.push(job);})).rejects.toThrow();
  const result=await p.poll(saved[0] as any);expect(result?.usd).toBe("0.001");expect(result?.response.audio).toBeTruthy();
  expect(transport.mock.calls.filter(([,v])=>v?.method==="POST")).toHaveLength(1);
 });
 it("uses authoritative embedding and rerank receipts, and rejects missing/foreign invoices",async()=>{
  const e=offer("embeddings"),r=offer("rerank");
  const transport=vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({id:"embed-one",data:[{index:0,embedding:[0.1,0.2]}]}))
   .mockResolvedValueOnce(new Response('{"data":{"id":"embed-one","total_cost":0.001}}'))
   .mockResolvedValueOnce(new Response('{"id":"rank-one","results":[{"index":0,"relevance_score":0.9}],"usage":{"cost":0.002}}'));
  const p=new ManagedMedia("fixture",[e,r],transport,0);
  expect((await p.execute(p.quote({model:e.id,kind:"embeddings",prompt:"hola"}))).response.embeddings).toBeTruthy();
  expect((await p.execute(p.quote({model:r.id,kind:"rerank",prompt:"hola",documents:["a"]}))).usd).toBe("0.002");
  transport.mockResolvedValueOnce(Response.json({id:"embed-two",data:[{index:0,embedding:[1]}]})).mockResolvedValueOnce(new Response('{"data":{"id":"foreign","total_cost":0}}'));
  await expect(p.execute(p.quote({model:e.id,kind:"embeddings",prompt:"hola"}))).rejects.toThrow("mismatch");
 });
 it("creates a batch once, matches unordered result IDs, bills its aggregate receipt and resumes without another GET",async()=>{
  const batch={...offer("batch"),costContract:contract},transport=vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({id:"batch-one"}))
   .mockResolvedValueOnce(new Response('{"id":"batch-one","status":"completed","usage":{"cost":0.01,"is_byok":false},"results":[{"custom_id":"item-1","error":{"message":"failed"}},{"custom_id":"item-0","response":{"status_code":200,"body":{"choices":[{"message":{"content":"ok"}}]}}}]}'));
  const p=new ManagedMedia("fixture",[batch],transport,0),saved:any[]=[];
  await expect(p.execute(p.quote({model:batch.id,kind:"batch",prompts:["one","two"]}),undefined,async job=>{saved.push(job);})).rejects.toThrow("pending");
  const result=await p.poll(saved[0],async job=>{saved.push(job);});expect(result?.usd).toBe("0.01");expect(result?.response.results).toHaveLength(2);
  await p.poll(saved.at(-1));expect(transport).toHaveBeenCalledTimes(2);expect(transport.mock.calls[1]?.[0]).toContain("/batches/batch-one");
 });
 it("never releases a failed job on a guess, but accepts an explicit zero-cost terminal receipt",async()=>{
  const p=new ManagedMedia("fixture",[],vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({id:"failed-one",status:"failed"}))
   .mockResolvedValueOnce(new Response('{"id":"failed-one","status":"failed","usage":{"cost":0}}')),0);
  await expect(p.poll({id:"failed-one",model:"mycellios/media/movie",kind:"video"})).rejects.toThrow("receipt_missing");
  expect(await p.poll({id:"failed-one",model:"mycellios/media/movie",kind:"video"})).toMatchObject({usd:"0",response:{error:"upstream_job_failed"}});
 });
 it("refuses batch submission without a durable submission callback before any paid call",async()=>{
  const batch={...offer("batch"),costContract:contract},transport=vi.fn(),p=new ManagedMedia("fixture",[batch],transport,0);
  await expect(p.execute(p.quote({model:batch.id,kind:"batch",prompts:["one"]}))).rejects.toThrow("persistence_required");expect(transport).not.toHaveBeenCalled();
 });
 it("calls only the documented alpha Decisions endpoint, preserves a refusal and requires a real cost receipt",async()=>{
  const d=offer("decisions"),transport=vi.fn<typeof fetch>()
   .mockResolvedValueOnce(Response.json({id:"decision-real",answers:{answer:{type:"noul",noul:0.86}},usage:{cost:0.001}}))
   .mockResolvedValueOnce(Response.json({id:"refusal-real",answers:{answer:{type:"refusal"}},usage:{cost:0}}))
   .mockResolvedValueOnce(Response.json({id:"bad-score",answers:{answer:{type:"noul",noul:4}},usage:{cost:0.01}}));
  const p=new ManagedMedia("fixture",[d],transport,0),q=p.quote({model:d.id,kind:"decisions",prompt:"Is this urgent?",state:"The service is down."});
  expect((await p.execute(q)).response.decision).toEqual({type:"noul",probability:0.86});
  expect((await p.execute(q)).response.decision).toEqual({type:"refusal"});
  await expect(p.execute(q)).rejects.toThrow("result_invalid");expect(transport.mock.calls.every(([v])=>v==="https://openrouter.ai/api/alpha/decisions")).toBe(true);
 });
});
