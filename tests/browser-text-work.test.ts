import {afterEach,describe,expect,it,vi} from "vitest";
import {BrowserTextWork} from "../src/mobile/browser-text-work.js";
import {browserTextModel} from "../src/contracts/browser-text.js";
class FakeWorker extends EventTarget {
  static instances:FakeWorker[]=[];
  terminate=vi.fn();postMessage=vi.fn();
  constructor(){super();FakeWorker.instances.push(this);}
}
const task={taskId:"32cb4b44-cd2e-45d5-966e-b876f4c4dba0",leaseId:"42cb4b44-cd2e-45d5-966e-b876f4c4dba0",artifactId:browserTextModel.files["model.onnx"].sha256,
  request:{kind:"text",model:"mycellios-browser/gpt2",prompt:"Hello",maxTokens:4},deadlineAt:Date.now()+110000};
function fixture(){
  FakeWorker.instances=[];vi.stubGlobal("Worker",FakeWorker);
  const controller=new AbortController(),send=vi.fn(),active=vi.fn(()=>true);
  return {worker:new BrowserTextWork({token:()=>"test-proof",signal:()=>controller.signal,active,send,status:vi.fn()}),controller,send,active};
}
afterEach(()=>vi.unstubAllGlobals());
describe("nonblocking complete-model browser work",()=>{
  it("runs outside the UI thread, binds the current task and returns only that task's result",async()=>{
    const {worker,send}=fixture(),running=worker.execute(task),thread=FakeWorker.instances[0]!;
    thread.dispatchEvent(new MessageEvent("message",{data:{taskId:"wrong-task",tokenIds:[1]}}));expect(send).not.toHaveBeenCalled();
    thread.dispatchEvent(new MessageEvent("message",{data:{taskId:task.taskId,tokenIds:[123]}}));await running;
    expect(send).toHaveBeenCalledWith("text.result",{taskId:task.taskId,leaseId:task.leaseId,artifactId:task.artifactId,tokenIds:[123]});
    await worker.close();expect(thread.terminate).toHaveBeenCalled();
  });
  it("terminates in-flight WASM immediately on pause and never sends a payable result",async()=>{
    const {worker,controller,send,active}=fixture(),running=worker.execute(task),thread=FakeWorker.instances[0]!;
    active.mockReturnValue(false);controller.abort();await worker.close();await running;
    expect(thread.terminate).toHaveBeenCalled();expect(send).not.toHaveBeenCalled();
  });
  it("rejects expired requests and prevents two simultaneous tasks",async()=>{
    const {worker,send}=fixture();await worker.execute({...task,deadlineAt:Date.now()-1});expect(FakeWorker.instances).toHaveLength(0);
    const running=worker.execute(task);await worker.execute(task);expect(FakeWorker.instances).toHaveLength(1);
    await worker.close();await running;expect(send).toHaveBeenCalledWith("text.fail",expect.anything());
  });
});
