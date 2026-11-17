import type { AdapterContext, AgentRuntime } from "@rakazo/adapter-kit";
import { parseDesktopDiagnostic } from "@rakazo/contracts";
import { afterEach, expect, it, vi } from "vitest";
import { DesktopAgentHost } from "./desktop-agent-host.js";
import { DesktopAgentRpc } from "./desktop-agent-rpc.js";

afterEach(() => vi.restoreAllMocks());
const describe = () => ({id:"fixture",contractVersion:"1",adapterVersion:"1",capabilities:{streaming:true,tools:true,compaction:false,scripted:true}});
const context = (signal = new AbortController().signal): AdapterContext => ({userId:"owner",spaceId:"space",botId:"bot",runId:"run",traceId:"trace",operationId:"operation",signal});
const request = () => ({botId:"bot",runId:"run",threadId:"thread",prompt:"fixture",instructions:"fixture",history:[],tools:[],model:{provider:"fixture",id:"fixture"}});

it("completes a native turn and releases its session without inventing a diagnostic",async()=>{
  const runtime:AgentRuntime={describe,abort:vi.fn(),async *run(){yield {type:"done",text:"Confirmed"};}};
  const host=new DesktopAgentHost(runtime),peer=new DesktopAgentRpc(()=>{}),frames=[];
  try {
    for await(const frame of host.run("session",peer.encode(request()),"bot","run",context())) frames.push(frame);
    expect(frames).toHaveLength(1);expect(frames[0]?.kind).toBe("event");
    expect(host.hasSession("session","bot","run")).toBe(false);
    expect(runtime.abort).toHaveBeenCalledWith("run");
  } finally {peer.close();}
});

it("identifies callback drain expiry after the engine ends, without replaying it",async()=>{
  const expired=new AbortController();
  const timeout=vi.spyOn(AbortSignal,"timeout").mockReturnValue(expired.signal);
  const started=vi.fn();
  const runtime:AgentRuntime={describe,abort:vi.fn(),async *run(input){started();void input.onCheckpoint!(()=>"fixture checkpoint","call").catch(()=>undefined);}};
  const host=new DesktopAgentHost(runtime),peer=new DesktopAgentRpc(()=>{});
  const stream=host.run("session",peer.encode({...request(),onCheckpoint:async()=>{}}),"bot","run",context())[Symbol.asyncIterator]();
  try {
    expect((await stream.next()).value?.kind).toBe("rpc");
    await vi.waitFor(()=>expect(timeout).toHaveBeenCalledWith(30_000));
    expired.abort();
    const frame=(await stream.next()).value;
    expect(frame?.kind).toBe("failure");
    if(frame?.kind !== "failure") throw Error("Expected a diagnostic failure");
    expect(parseDesktopDiagnostic((peer.decode(frame.value) as Error).message)).toEqual({code:"callback_drain_timeout",phase:"callback",stage:"callback_drain"});
    expect((await stream.next()).done).toBe(true);expect(started).toHaveBeenCalledOnce();
    expect(host.hasSession("session","bot","run")).toBe(false);
  } finally {await stream.return?.();peer.close();}
});

it("does not misclassify an explicit Stop as callback timeout or retry the turn",async()=>{
  const controller=new AbortController();
  const runtime:AgentRuntime={describe,abort:vi.fn(),async *run(input){void input.onCheckpoint!(()=>"fixture checkpoint","call").catch(()=>undefined);}};
  const host=new DesktopAgentHost(runtime),peer=new DesktopAgentRpc(()=>{});
  const stream=host.run("session",peer.encode({...request(),onCheckpoint:async()=>{}}),"bot","run",context(controller.signal))[Symbol.asyncIterator]();
  try {
    expect((await stream.next()).value?.kind).toBe("rpc");controller.abort();
    expect((await stream.next()).done).toBe(true);
    expect(host.hasSession("session","bot","run")).toBe(false);
  } finally {await stream.return?.();peer.close();}
});
