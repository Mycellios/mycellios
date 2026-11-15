import {afterEach,expect,it,vi} from "vitest";
import {startupFetch,STARTUP_READ_TIMEOUT_MS} from "./startup-fetch";
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
it("aborts a stalled startup read, then permits a fresh successful read", async()=>{
 const deadline=new AbortController();
 const timeout=vi.spyOn(AbortSignal,"timeout").mockReturnValue(deadline.signal);
 const transport=vi.fn((_input:unknown,init?:RequestInit)=>new Promise<Response>((_resolve,reject)=>{
  init!.signal!.addEventListener("abort",()=>reject(init!.signal!.reason),{once:true});
 }));vi.stubGlobal("fetch",transport);
 const pending=startupFetch("http://localhost/agent/rpc/bootstrap",{method:"POST"});
 const rejected=expect(pending).rejects.toThrow("startup deadline");
 deadline.abort(new Error("startup deadline"));await rejected;
 expect(timeout).toHaveBeenCalledWith(STARTUP_READ_TIMEOUT_MS);
 transport.mockImplementationOnce(async()=>new Response("{}"));
 expect((await startupFetch("http://localhost/agent/rpc/bootstrap",{method:"POST"})).ok).toBe(true);
});
it("keeps caller cancellation, credentials and the exact request body",async()=>{
 const caller=new AbortController();vi.stubGlobal("fetch",vi.fn(async()=>new Response("{}")));
 const request=new Request("http://localhost/agent/rpc/bootstrap",{method:"POST",body:'{"json":{}}',headers:{"x-rakazo-space-id":"space"}});
 await startupFetch(request,{credentials:"include",signal:caller.signal});
 const [sent,init]=vi.mocked(fetch).mock.calls[0]!;expect(sent).toBe(request);
 expect(init!.credentials).toBe("include");expect((sent as Request).headers.get("x-rakazo-space-id")).toBe("space");
 expect(await(sent as Request).text()).toBe('{"json":{}}');caller.abort();expect(init!.signal!.aborted).toBe(true);
});
it("bounds session reads but leaves sign-in writes and streaming runs untouched",async()=>{
 const timeout=vi.spyOn(AbortSignal,"timeout");vi.stubGlobal("fetch",vi.fn(async()=>new Response("{}")));
 await startupFetch("http://localhost/agent/api/auth/get-session");expect(timeout).toHaveBeenCalledOnce();
 for(const path of ["/api/auth/sign-in/email","/rpc/threads/send","/rpc/threads/subscribe"]){
  const init={method:"POST",body:"{}"};await startupFetch("http://localhost"+path,init);
  expect(vi.mocked(fetch).mock.calls.at(-1)![1]).toBe(init);
 }expect(timeout).toHaveBeenCalledOnce();
});

it("preserves cancellation on browsers without AbortSignal.any",async()=>{
 const original=AbortSignal;
 vi.stubGlobal("AbortSignal",Object.assign(Object.create(original),{any:undefined,timeout:original.timeout}));
 vi.stubGlobal("fetch",vi.fn(async()=>new Response("{}")));
 const caller=new AbortController();await startupFetch("http://localhost/api/auth/get-session",{signal:caller.signal});
 const signal=vi.mocked(fetch).mock.calls[0]![1]!.signal!;caller.abort("stop");expect(signal.aborted).toBe(true);expect(signal.reason).toBe("stop");
});
