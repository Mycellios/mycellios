import {EventEmitter} from "node:events";
import {describe,expect,it,vi} from "vitest";
const f=vi.hoisted(()=>({instances:[] as any[]}));
vi.mock("node:worker_threads",()=>({Worker:class extends EventEmitter{
  postMessage=vi.fn();terminate=vi.fn(async()=>0);
  constructor(){super();f.instances.push(this);}
}}));
import {BrowserTextReference} from "../src/coordinator/browser-text-reference.js";
const request={kind:"text" as const,model:"mycellios-browser/gpt2",prompt:"Hello",maxTokens:4};
const result={text:"Result",inputTokens:1,tokenIds:[123],finishReason:"length"};
describe("trusted reference worker lifecycle",()=>{
  it("requires a matching request result and checks the complete result schema",async()=>{
    f.instances=[];const reference=new BrowserTextReference("test-only"),pending=reference.generate(request,new AbortController().signal);
    const worker=f.instances[0],id=worker.postMessage.mock.calls[0][0].id;
    worker.emit("message",{id:"wrong-id",result});worker.emit("message",{id,result});expect(await pending).toEqual(result);
    await reference.close();expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it("hard-terminates in-flight verification on abort and ignores an old worker's late exit",async()=>{
    f.instances=[];const reference=new BrowserTextReference("test-only"),abort=new AbortController();
    const pending=reference.generate(request,abort.signal),failed=expect(pending).rejects.toThrow("cancelled");
    const old=f.instances[0];abort.abort();await failed;expect(old.terminate).toHaveBeenCalledOnce();
    const next=reference.generate(request,new AbortController().signal),worker=f.instances[1],id=worker.postMessage.mock.calls[0][0].id;
    old.emit("exit",0);worker.emit("message",{id,result});expect(await next).toEqual(result);await reference.close();
  });
  it("refuses an already aborted request without starting a worker",async()=>{
    f.instances=[];const reference=new BrowserTextReference("test-only"),abort=new AbortController();abort.abort();
    await expect(reference.generate(request,abort.signal)).rejects.toThrow();expect(f.instances).toHaveLength(0);
  });
});
