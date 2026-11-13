import {Worker} from "node:worker_threads";
import {randomUUID} from "node:crypto";
import {browserTextResultSchema,type BrowserTextRequest,type BrowserTextResult} from "../contracts/browser-text.js";

/** Trusted reference runs off the coordinator event loop, with hard cancellation. */
export class BrowserTextReference {
  private worker:Worker|null=null;
  private pending:{id:string;resolve(value:BrowserTextResult):void;reject(error:Error):void}|null=null;
  constructor(private readonly directory:string){}
  private start(){
    const development=import.meta.url.endsWith(".ts");
    const entry=development?new URL("./browser-text-reference-worker.ts",import.meta.url)
      :new URL("./browser-text-reference-worker.js",import.meta.url);
    // Source checkouts use the existing dev loader; release workers execute compiled JS directly.
    const worker=development?new Worker(`import(${JSON.stringify(import.meta.resolve("tsx/esm/api"))}).then(m=>m.tsImport(${JSON.stringify(entry.href)},${JSON.stringify(import.meta.url)})).catch(()=>process.exit(1));`,{
      eval:true,workerData:{directory:this.directory},resourceLimits:{maxOldGenerationSizeMb:512,stackSizeMb:4},
    }):new Worker(entry,{workerData:{directory:this.directory},resourceLimits:{maxOldGenerationSizeMb:512,stackSizeMb:4}});
    worker.on("message",message=>{
      const pending=this.pending;if(!pending||message.id!==pending.id)return;
      this.pending=null;const result=browserTextResultSchema.safeParse(message.result);
      if(!result.success)pending.reject(new Error("browser_text_reference_failed"));else pending.resolve(result.data);
    });
    const fail=()=>{if(this.worker!==worker)return;this.worker=null;this.pending?.reject(new Error("browser_text_reference_failed"));this.pending=null;};
    worker.on("error",fail);worker.on("exit",fail);this.worker=worker;
  }
  async generate(request:BrowserTextRequest,signal:AbortSignal){
    signal.throwIfAborted();if(this.pending)throw new Error("browser_text_reference_busy");if(!this.worker)this.start();
    const abort=()=>{void this.close();};signal.addEventListener("abort",abort,{once:true});
    try{return await new Promise<BrowserTextResult>((resolve,reject)=>{
      const id=randomUUID();this.pending={id,resolve,reject};this.worker!.postMessage({id,request});
    });}finally{signal.removeEventListener("abort",abort);}
  }
  async close(){const worker=this.worker;this.worker=null;this.pending?.reject(new Error("browser_text_reference_cancelled"));this.pending=null;if(worker)await worker.terminate();}
}
