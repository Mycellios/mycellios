import { browserTextModel, browserTextRequestSchema } from "../contracts/browser-text";
import { BrowserTextDecoder } from "../core/browser-text-decoder";
import type * as Ort from "onnxruntime-web";

let decoder:Promise<BrowserTextDecoder>|null=null;
async function load(token:string){
  const assets:Record<string,Uint8Array>={};
  for(const [name,pinned] of Object.entries(browserTextModel.files)){
    const response=await fetch(`/mobile/v1/text/${browserTextModel.files["model.onnx"].sha256}/${name}`,{
      headers:{authorization:`Bearer ${token}`},credentials:"omit",redirect:"error",signal:AbortSignal.timeout(90000)});
    if(!response.ok||Number(response.headers.get("content-length"))>pinned.bytes)throw new Error("browser_text_asset_unavailable");
    const bytes=new Uint8Array(await response.arrayBuffer());
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),b=>b.toString(16).padStart(2,"0")).join("");
    if(bytes.length!==pinned.bytes||hash!==pinned.sha256)throw new Error("browser_text_revision_invalid");
    assets[name]=bytes;
  }
  const runtimePath="/browser/ort/ort.wasm.min.mjs";
  const ort=await import(/* @vite-ignore */ runtimePath) as typeof Ort;
  ort.env.wasm.wasmPaths="/browser/ort/";
  return BrowserTextDecoder.load(ort,assets["model.onnx"]!,new TextDecoder().decode(assets["vocab.json"]),new TextDecoder().decode(assets["merges.txt"]));
}
let busy=false;
self.addEventListener("message",event=>{
  const {taskId,request,token}=event.data;
  if(busy||typeof taskId!=="string"||typeof token!=="string")return;
  busy=true;
  void(async()=>{
    try{
      const input=browserTextRequestSchema.parse(request);decoder??=load(token);
      const result=await(await decoder).generate(input,AbortSignal.timeout(100000));
      self.postMessage({taskId,tokenIds:result.tokenIds});
    }catch{self.postMessage({taskId,error:"browser_text_worker_failed"});decoder=null;}
    finally{busy=false;}
  })();
});
