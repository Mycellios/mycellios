import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {BrowserTextReference} from "../src/coordinator/browser-text-reference.js";
import {Gpt2Tokenizer} from "../src/core/gpt2-tokenizer.js";
import {browserTextModel} from "../src/contracts/browser-text.js";
const root=resolve(".cache/browser-text-models",browserTextModel.files["model.onnx"].sha256);
const tokenizer=new Gpt2Tokenizer(await readFile(resolve(root,"vocab.json"),"utf8"),await readFile(resolve(root,"merges.txt"),"utf8"));
if(JSON.stringify(tokenizer.encode("Hello, world!"))!=="[15496,11,995,0]")throw new Error("Tokenizer compatibility failure");
const reference=new BrowserTextReference(root),request={kind:"text" as const,model:"mycellios-browser/gpt2",prompt:"The capital of France is",maxTokens:12};
try{
 const started=performance.now();const result=await reference.generate(request,AbortSignal.timeout(90000));
 console.log(JSON.stringify({model:browserTextModel.id,...result,durationMs:performance.now()-started,thread:"worker"}));
 const cancel=new AbortController(),running=reference.generate({...request,maxTokens:32},cancel.signal);setTimeout(()=>cancel.abort(),20);
 try{await running;throw new Error("Cancellation did not stop the reference");}catch(error){if(!(error instanceof Error)||!error.message.includes("cancelled"))throw error;console.log("In-flight reference worker cancelled without blocking coordinator");}
}finally{await reference.close();}
