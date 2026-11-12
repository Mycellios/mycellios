import { describe, expect, it, vi } from "vitest";
import { BrowserTextDecoder } from "../src/core/browser-text-decoder.js";
import type { Gpt2Tokenizer } from "../src/core/gpt2-tokenizer.js";
import type * as Ort from "onnxruntime-web";

function fixture(winners: number[]) {
  const disposed = vi.fn(), feeds: Record<string, { data: BigInt64Array }>[] = [];
  let step=0;
  const session = { inputNames:["input_ids","attention_mask","position_ids"],run:vi.fn(async(input:typeof feeds[number])=>{
    feeds.push(input);const data=new Float32Array(50257).fill(-10);data[winners[step++]!]=5;
    return {logits:{type:"float32",dims:[1,1,50257],getData:async()=>data,dispose:disposed}};
  }), release:vi.fn() };
  const ort = {Tensor:class{constructor(_type:string,readonly data:BigInt64Array,readonly dims:number[]){}dispose=disposed;}};
  const tokenizer = {encode:()=>[10,11],decode:(ids:number[])=>ids.join(",")};
  const decoder=new BrowserTextDecoder(ort as unknown as typeof Ort,session as unknown as Ort.InferenceSession,tokenizer as unknown as Gpt2Tokenizer);
  return {decoder,session,feeds,disposed};
}
const request={kind:"text",model:"mycellios-browser/gpt2",prompt:"hello",maxTokens:3};
describe("complete browser text decoding",()=>{
  it("feeds every token, position and attention mask, greedily decodes and stops at EOS",async()=>{
    const {decoder,feeds,disposed}=fixture([123,50256,456]);
    expect(await decoder.generate(request,new AbortController().signal)).toMatchObject({tokenIds:[123,50256],inputTokens:2,finishReason:"stop"});
    expect(Array.from(feeds[1]!.input_ids!.data)).toEqual([10n,11n,123n]);
    expect(Array.from(feeds[1]!.position_ids!.data)).toEqual([0n,1n,2n]);
    expect(Array.from(feeds[1]!.attention_mask!.data)).toEqual([1n,1n,1n]);
    expect(disposed).toHaveBeenCalledTimes(8);
  });
  it("obeys the exact output bound and reports a length stop",async()=>{
    const {decoder,session}=fixture([42,43,44]);
    expect(await decoder.generate({...request,maxTokens:2},new AbortController().signal)).toMatchObject({tokenIds:[42,43],finishReason:"length"});
    expect(session.run).toHaveBeenCalledTimes(2);
  });
  it("aborts before execution and rejects overlapping generation",async()=>{
    const {decoder,session}=fixture([42,43,44]),control=new AbortController();control.abort();
    await expect(decoder.generate(request,control.signal)).rejects.toThrow();expect(session.run).not.toHaveBeenCalled();
    const running=decoder.generate(request,new AbortController().signal);
    await expect(decoder.generate(request,new AbortController().signal)).rejects.toThrow("busy");await running;
  });
  it("rejects non-finite logits and releases all input/output tensors on error",async()=>{
    const {decoder,session,disposed}=fixture([42]);session.run.mockResolvedValueOnce({logits:{type:"float32",dims:[1,1,50257],getData:async()=>new Float32Array(50257).fill(NaN),dispose:disposed}});
    await expect(decoder.generate(request,new AbortController().signal)).rejects.toThrow("logits_invalid");expect(disposed).toHaveBeenCalledTimes(4);
  });
});
