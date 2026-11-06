// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
let module: typeof import("./android-host");
const port = { postMessage: vi.fn(), onmessage: undefined as undefined | ((event: { data: string }) => void) };
beforeEach(async () => { vi.resetModules(); port.postMessage.mockClear(); port.onmessage=undefined; window.MycelliosNative=port; module=await import("./android-host"); });
afterEach(() => { delete window.MycelliosNative; });
function reply(data: unknown) { port.onmessage!({data:JSON.stringify(data)}); }
it("receives a shortcut without recording or sending before the owned composer is ready",()=>{
 module.installAndroidHost();reply({type:"dictate"});
 expect(module.takeAndroidShortcut()).toBe(true);expect(module.takeAndroidShortcut()).toBe(false);
 expect(port.postMessage.mock.calls.map(c=>JSON.parse(c[0]).type)).toEqual(["ready"]);
 module.androidChatReady(true);expect(JSON.parse(port.postMessage.mock.lastCall![0]).type).toBe("chat-ready");
});
it("delivers partial/final results only to the current capture and waits for native final on finish",()=>{
 const callbacks={transcript:vi.fn(),final:vi.fn(),error:vi.fn()};const capture=module.startAndroidDictation(callbacks);
 const request=JSON.parse(port.postMessage.mock.lastCall![0]);reply({type:"partial",id:request.id,text:"hello"});
 expect(callbacks.transcript).toHaveBeenCalledWith("hello");capture.finish();expect(callbacks.final).not.toHaveBeenCalled();
 reply({type:"final",id:request.id,text:"hello world"});expect(callbacks.final).toHaveBeenCalledOnce();
 reply({type:"final",id:request.id,text:"duplicate"});expect(callbacks.final).toHaveBeenCalledOnce();
});
it("drops late callbacks after cancellation and unrelated capture results",()=>{
 const callbacks={transcript:vi.fn(),final:vi.fn(),error:vi.fn()};const capture=module.startAndroidDictation(callbacks);
 const {id}=JSON.parse(port.postMessage.mock.lastCall![0]);reply({type:"final",id:"other",text:"wrong"});capture.cancel();reply({type:"final",id,text:"late"});
 expect(callbacks.final).not.toHaveBeenCalled();
});
it("ignores malformed or oversized messages",()=>{
 module.installAndroidHost();port.onmessage!({data:"not json"});port.onmessage!({data:" ".repeat(70000)});
 expect(module.takeAndroidShortcut()).toBe(false);
});
it("has no native capabilities in an ordinary browser",()=>{delete window.MycelliosNative;expect(module.isAndroidHost()).toBe(false);module.installAndroidHost();expect(port.postMessage).not.toHaveBeenCalled();});
