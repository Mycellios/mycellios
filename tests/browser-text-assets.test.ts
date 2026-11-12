import Fastify from "fastify";
import {describe,it,expect,vi} from "vitest";
import {browserOnnxAssets} from "../src/coordinator/browser-onnx-assets.js";
import {browserTextOfferSchema,browserTextRequestSchema,browserTextModel} from "../src/contracts/browser-text.js";
import {BrowserTextHub} from "../src/coordinator/browser-text-hub.js";
import {mycelliosModelCatalog} from "../src/coordinator/model-credit-pricing.js";
import type {BrowserInference} from "../src/coordinator/browser-inference.js";
import type {EconomicLedger} from "../src/economy/economic-ledger.js";
describe("complete browser model admission",()=>{
  it("admits only the pinned pretrained model, bounded text and positive operator rates",()=>{
    const offer={kind:"text",model:"mycellios-browser/gpt2",artifactId:browserTextModel.files["model.onnx"].sha256,costMicrounitsPerToken:50,maxOutputTokens:32};
    expect(browserTextOfferSchema.safeParse(offer).success).toBe(true);
    expect(browserTextOfferSchema.safeParse({...offer,artifactId:"a".repeat(64)}).success).toBe(false);
    expect(browserTextOfferSchema.safeParse({...offer,costMicrounitsPerToken:0}).success).toBe(false);
    expect(browserTextRequestSchema.safeParse({kind:"text",model:offer.model,prompt:"a",maxTokens:33}).success).toBe(false);
  });
  it("serves only installed runtime files with the correct MIME type, never a model or path chosen by a client",async()=>{
    const app=Fastify();browserOnnxAssets(app);
    try{
      const result=await app.inject({url:"/browser/ort/ort-wasm-simd-threaded.mjs"});
      expect(result.statusCode).toBe(200);expect(result.headers["content-type"]).toContain("text/javascript");
      expect((await app.inject({url:"/browser/ort/package.json"})).statusCode).toBe(404);
    }finally{await app.close();}
  });
  it("has no reference or text-work admission until its approved local assets are enabled",async()=>{
    const transport={peers:vi.fn(()=>[]),acquire:vi.fn(()=>true),release:vi.fn(),send:vi.fn(),verified:vi.fn()};
    const hub=new BrowserTextHub(transport);
    expect(()=>hub.inputTokens("hello")).toThrow("not_enabled");
    await expect(hub.execute("worker",{kind:"text",model:"mycellios-browser/gpt2",prompt:"hello",maxTokens:1})).rejects.toThrow("unavailable");
    expect(transport.send).not.toHaveBeenCalled();expect(transport.verified).not.toHaveBeenCalled();
  });
  it("exposes bounded no-tools browser text in the optional Mycellios catalog with credit prices",async()=>{
    const browser={models:()=>[{kind:"text",model:"mycellios-browser/gpt2",costMicrounitsPerToken:50,creditsMicrounitsPerToken:52}]} as unknown as Pick<BrowserInference,"models">;
    const result=await mycelliosModelCatalog([],{} as EconomicLedger,null,browser);
    expect(result.data).toHaveLength(1);expect(result.data[0]).toMatchObject({id:"mycellios-browser/gpt2",owned_by:"mycellios",processing:"network",supports_tools:false,context_length:160,max_input_tokens:128,pricing:{input:"0.000052",output:"0.000052"}});
    expect((await mycelliosModelCatalog([],{} as EconomicLedger,null)).data).toEqual([]);
  });
});
