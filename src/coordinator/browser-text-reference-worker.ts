import {parentPort,workerData} from "node:worker_threads";
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {createHash} from "node:crypto";
import * as ort from "onnxruntime-web";
import {BrowserTextDecoder} from "../core/browser-text-decoder.js";
import {browserTextModel} from "../contracts/browser-text.js";

let decoder:Promise<BrowserTextDecoder>|null=null,busy=false;
async function load(){
  const assets:Record<string,Buffer>={};
  for(const [name,pin] of Object.entries(browserTextModel.files)){
    const bytes=await readFile(resolve(workerData.directory,name));
    if(bytes.length!==pin.bytes||createHash("sha256").update(bytes).digest("hex")!==pin.sha256)throw new Error("browser_reference_revision_invalid");assets[name]=bytes;
  }
  return BrowserTextDecoder.load(ort,assets["model.onnx"]!,assets["vocab.json"]!.toString(),assets["merges.txt"]!.toString());
}
parentPort!.on("message",message=>{
  if(busy)return;busy=true;
  void(async()=>{try{decoder??=load();const result=await(await decoder).generate(message.request,AbortSignal.timeout(100000));parentPort!.postMessage({id:message.id,result});}
    catch(error){parentPort!.postMessage({id:message.id,error:"browser_text_reference_failed",
      diagnostic:error instanceof Error?error.message.slice(0,1500):"unknown_reference_error"});}finally{busy=false;}})();
});
