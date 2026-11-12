import { browserTextTaskSchema } from "../contracts/browser-text.js";

/** Keep ONNX off the UI thread. Pause terminates the worker, including in-flight WASM. */
export class BrowserTextWork {
  private worker: Worker | null = null;
  private busy = false;
  private cancel: (() => void) | null = null;
  constructor(private readonly options: {
    token(): string | null; signal(): AbortSignal; active(): boolean;
    send(type: string, payload: unknown): void; status(text: string): void;
  }) {}
  async execute(value: unknown) {
    const parsed = browserTextTaskSchema.safeParse(value);
    if (!parsed.success || !this.options.active() || this.busy || parsed.data.deadlineAt <= Date.now()) return;
    const task=parsed.data, token=this.options.token(); if(!token)return;
    const signal=AbortSignal.any([this.options.signal(),AbortSignal.timeout(Math.min(110_000,task.deadlineAt-Date.now()))]);
    this.busy=true;
    try {
      this.worker??=new Worker(new URL("./browser-text-worker.ts",import.meta.url),{type:"module"});
      const worker=this.worker;
      this.options.status("Generating text with the complete model on browser CPU…");
      const ids=await new Promise<number[]>((resolve,reject)=>{
        const cleanup=()=>{worker.removeEventListener("message",message);worker.removeEventListener("error",error);signal.removeEventListener("abort",stop);this.cancel=null;};
        const stop=()=>{cleanup();worker.terminate();if(this.worker===worker)this.worker=null;reject(new Error("browser_text_cancelled"));};
        const message=(event:MessageEvent)=>{if(event.data.taskId!==task.taskId)return;cleanup();
          if(event.data.error)reject(new Error("browser_text_worker_failed"));else resolve(event.data.tokenIds);};
        const error=()=>{cleanup();worker.terminate();this.worker=null;reject(new Error("browser_text_worker_failed"));};
        worker.addEventListener("message",message);worker.addEventListener("error",error);signal.addEventListener("abort",stop,{once:true});
        this.cancel=stop;
        if(signal.aborted){stop();return;}
        worker.postMessage({taskId:task.taskId,request:task.request,token});
      });
      if(this.options.active()&&!signal.aborted&&Date.now()<task.deadlineAt)
        this.options.send("text.result",{taskId:task.taskId,leaseId:task.leaseId,artifactId:task.artifactId,tokenIds:ids});
    }catch{
      if(this.options.active()&&!signal.aborted)this.options.send("text.fail",{taskId:task.taskId,leaseId:task.leaseId,artifactId:task.artifactId});
    }finally{this.busy=false;}
  }
  async close(){this.cancel?.();this.cancel=null;this.worker?.terminate();this.worker=null;}
}
