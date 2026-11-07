import { afterEach, expect, it, vi } from "vitest";
import type { AdapterContext, AgentRunRequest, AgentRuntime, AgentRuntimeEvent } from "@rakazo/adapter-kit";
import { DesktopAgentRuntime } from "./desktop-agent-runtime.js";
import { startHostComputerServer } from "./host-computer-server.js";
import { DesktopAgentRpc } from "./desktop-agent-rpc.js";
import { desktopAgentFrames } from "./desktop-agent-stream.js";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { PiAgentRuntime } from "./pi-runtime.js";

const context: AdapterContext = { userId: "owner", spaceId: "space", botId: "mico", runId: "run", traceId: "trace", operationId: "op", signal: new AbortController().signal };
const describe = () => ({ id: "fixture", contractVersion: "1", adapterVersion: "1", capabilities: { streaming: true, tools: true, compaction: false, scripted: true } });
const hosts: Array<Awaited<ReturnType<typeof startHostComputerServer>>> = [];
afterEach(async () => { for (const host of hosts.splice(0)) await host.close(); });
const request = (): AgentRunRequest => ({ botId: "mico", threadId: "thread", runId: "run", instructions: "Owned Mico", prompt: "hello", history: [], tools: [], model: { provider: "openai", id: "gpt-4o", apiKey: "must-not-reach-desktop" } });

it("runs the engine on Desktop while awaiting account callbacks, checkpoints and nested shell observations", async () => {
  const observed: string[] = [];
  const engine: AgentRuntime = { describe, abort: vi.fn(), async *run(input) {
    observed.push("desktop-engine");
    expect(input.model.apiKey).toBeUndefined(); expect(input.model.oauth).toBeUndefined(); expect(input.model.callObserver).toBeUndefined();
    await input.onCheckpoint!(() => "exact-checkpoint", "call-1");
    const completion = new Promise<void>(resolve => {
      void input.executeTool!("shell", {}, "call-1", undefined, { onShellStillRunning: promise => { void promise.then(value => { observed.push(`shell:${value.code}`); resolve(); }); } });
    });
    await completion;
    await input.onUsage!({ type: "usage", provider: "existing", model: "existing-model", inputTokens: 1, outputTokens: 1, costUsd: null });
    yield { type: "text", text: "OK" }; yield { type: "done" };
  } };
  const host = await startHostComputerServer({ root: tmpdir(), token: "a".repeat(64), hostname: "127.0.0.1", agentRuntime: engine }); hosts.push(host); host.setEnabled(true);
  const fallback = { describe, abort: vi.fn(), run: vi.fn(async function* () { yield { type: "done" as const }; }) };
  const runtime = new DesktopAgentRuntime({ fallback, select: async () => ({ available: true, preferred: true }), transport: (input, ctx) => fetch(`http://127.0.0.1:${host.port}/computer`, { method: "POST", headers: { authorization: `Bearer ${"a".repeat(64)}` }, body: JSON.stringify(input), signal: ctx.signal }) });
  const input = request();
  input.model.callObserver = { beforeCall: async () => { observed.push("reserve"); return "reservation"; }, afterCall: async () => { observed.push("settle"); } };
  input.onCheckpoint = async (capture, id) => { expect(capture()).toBe("exact-checkpoint"); expect(id).toBe("call-1"); observed.push("checkpoint"); };
  input.executeTool = async (_name, _args, _id, _route, observer) => { observer!.onShellStillRunning!(Promise.resolve({ code: 0, stdout: "OK", stderr: "" })); return { running: true }; };
  input.onUsage = async () => { observed.push("usage"); };
  const events: AgentRuntimeEvent[] = []; for await (const event of runtime.run(input, context)) events.push(event);
  expect(events).toEqual([{ type: "text", text: "OK" }, { type: "done" }]);
  expect(observed).toEqual(["desktop-engine", "checkpoint", "shell:0"]);
  expect(fallback.run).not.toHaveBeenCalled();
});

it("runs new turns in cloud when Desktop is offline and preserves bound work", async () => {
  const fallback = { describe, abort: vi.fn(), run: vi.fn(async function* () { yield { type: "done" as const }; }) };
  const transport = vi.fn();
  const old = new DesktopAgentRuntime({ fallback, transport, select: async () => ({ available: false, preferred: false }) });
  for await (const _ of old.run(request(), context)) {}
  expect(fallback.run).toHaveBeenCalledTimes(1);
  const offline = new DesktopAgentRuntime({ fallback, transport, select: async () => ({ available: false, preferred: true }) });
  const fresh = { ...request(), resumeToolResult: { content: [{ type: "text" as const, text: "hello" }] } };
  for await (const _ of offline.run(fresh, context)) {}
  expect(fallback.run).toHaveBeenCalledTimes(2);
  expect(fallback.run).toHaveBeenLastCalledWith(
    expect.objectContaining({ instructions: expect.stringContaining("This turn runs on the server") }),
    context,
  );
  for (const [input, scope] of [
    [request(), { ...context, projectSessionId: "project" }],
    [{ ...request(), resumeFromCheckpoint: "checkpoint" }, context],
    [{ ...fresh, turnCheckpoint: "durable-checkpoint" }, context],
  ] as const) {
    await expect(async () => { for await (const _ of offline.run(input, scope)) {} }).rejects.toThrow("bound");
  }
  expect(fallback.run).toHaveBeenCalledTimes(2);
  expect(transport).not.toHaveBeenCalled();
});

it("never replays or falls back after dispatch or a truncated native stream", async () => {
  const fallback = { describe, abort: vi.fn(), run: vi.fn() };
  const transport = vi.fn(async () => new Response('{"value":{"kind":"event","value":{"kind":"object","value":[["type","text"],["text","partial"]]}}}\n'));
  const runtime = new DesktopAgentRuntime({ fallback, transport, select: async () => ({ available: true, preferred: true }) });
  await expect(async () => { for await (const _ of runtime.run(request(), context)) {} }).rejects.toThrow("disconnected");
  expect(transport).toHaveBeenCalledTimes(1); expect(fallback.run).not.toHaveBeenCalled();
});

it("continues a pinned cloud turn without probing a reconnected Desktop", async () => {
  const fallback = { describe, abort: vi.fn(), run: vi.fn(async function* () { yield { type: "done" as const }; }) };
  const select = vi.fn();
  const transport = vi.fn();
  const runtime = new DesktopAgentRuntime({ fallback, transport, select });
  const input = { ...request(), turnCheckpoint: "server-checkpoint" };
  const cloudWorkspace = { workerId: "worker", runFence: 3 };
  for await (const _ of runtime.run(input, { ...context, cloudWorkspace })) {}
  expect(fallback.run).toHaveBeenCalledWith(
    expect.objectContaining({ turnCheckpoint: "server-checkpoint" }),
    expect.objectContaining({ cloudWorkspace }),
  );
  expect(select).not.toHaveBeenCalled();
  expect(transport).not.toHaveBeenCalled();
});

it("preserves binary input and opaque marker-looking objects without interpreting them as callbacks", () => {
  const rpc = new DesktopAgentRpc(() => undefined);
  const input = { image: new Uint8Array([0, 255]), opaque: { kind: "function", value: "not-a-callback" } };
  expect(rpc.decode(rpc.encode(input))).toEqual(input); rpc.close();
});

it("requires native completion rather than treating EOF or abort as success", async () => {
  await expect(async () => { for await (const _ of desktopAgentFrames(new Response(""), context.signal)) {} }).rejects.toThrow("disconnected");
  const controller = new AbortController(); controller.abort();
  await expect(async () => { for await (const _ of desktopAgentFrames(new Response(""), controller.signal)) {} }).rejects.toThrow();
});

it("Stop cancels only the owned local engine without replay or cloud substitution",async()=>{
 let finish!:()=>void;const stopped=new Promise<void>(resolve=>{finish=resolve;});
 const engine:AgentRuntime={describe,abort:vi.fn(),async *run(_input,owned){
  try{yield{type:"progress",text:"started"};await new Promise<void>(resolve=>{if(owned?.signal?.aborted)resolve();else owned?.signal?.addEventListener("abort",()=>resolve(),{once:true});});}
  finally{finish();}
 }};
 const host=await startHostComputerServer({root:tmpdir(),token:"c".repeat(64),hostname:"127.0.0.1",agentRuntime:engine});hosts.push(host);host.setEnabled(true);
 const fallback={describe,abort:vi.fn(),run:vi.fn()};
 const runtime=new DesktopAgentRuntime({fallback,select:async()=>({available:true,preferred:true}),transport:(input,ctx)=>fetch(`http://127.0.0.1:${host.port}/computer`,{method:"POST",headers:{authorization:`Bearer ${"c".repeat(64)}`},body:JSON.stringify(input),signal:ctx.signal})});
 const controller=new AbortController(),iterator=runtime.run(request(),{...context,signal:controller.signal})[Symbol.asyncIterator]();
 expect((await iterator.next()).value).toEqual({type:"progress",text:"started"});
 controller.abort();await expect(iterator.next()).rejects.toThrow();await stopped;
 expect(fallback.run).not.toHaveBeenCalled();
});

it("keeps actual provider credentials and producer-side billing in cloud while Pi runs on Desktop", async () => {
  const calls: string[] = [];
  const provider = createServer((req, res) => {
    expect(req.headers.authorization).toBe("Bearer cloud-only-provider-key"); calls.push("provider");
    req.resume();
    res.writeHead(200, { "content-type": "text/event-stream" });
    const chunk = (delta: object, finish: string | null, usage?: object) => res.write(`data: ${JSON.stringify({ id: "request-1", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason: finish }], ...(usage ? { usage } : {}) })}\n\n`);
    chunk({ role: "assistant", content: "OK" }, null);
    chunk({}, "stop", { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 });
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>(resolve => provider.listen(0, "127.0.0.1", resolve));
  const address = provider.address(); if (!address || typeof address === "string") throw Error("fixture");
  const host = await startHostComputerServer({ root: tmpdir(), token: "b".repeat(64), hostname: "127.0.0.1", agentRuntime: new PiAgentRuntime() }); hosts.push(host); host.setEnabled(true);
  const runtime = new DesktopAgentRuntime({ fallback: { describe, abort: vi.fn(), run: vi.fn() }, select: async () => ({ available: true, preferred: true }), transport: (input, ctx) => {
    expect(JSON.stringify(input)).not.toContain("cloud-only-provider-key");
    return fetch(`http://127.0.0.1:${host.port}/computer`, { method: "POST", headers: { authorization: `Bearer ${"b".repeat(64)}` }, body: JSON.stringify(input), signal: ctx.signal });
  } });
  const input = request();
  input.model = { provider: "openai-compatible", id: "fixture", apiKey: "cloud-only-provider-key", baseUrl: `http://127.0.0.1:${address.port}/v1`, allowPrivateEndpoint: true, maxTokens: 128, contextWindow: 8192, callObserver: {
    beforeCall: async () => { calls.push("reserve"); return "reservation"; }, afterCall: async () => { calls.push("settle"); },
  } };
  input.onUsage = async () => { calls.push("usage"); };
  input.allowSilentEmpty = true;
  try {
    const events: AgentRuntimeEvent[] = []; for await (const event of runtime.run(input, context)) events.push(event);
    expect(events.filter(e => e.type === "text").map(e => e.type === "text" ? e.text : "").join("")).toBe("OK");
    expect(events.some(e => e.type === "usage" && e.accounted === true)).toBe(true);
    expect(calls).toEqual(["reserve", "provider", "settle", "usage"]);
  } finally { provider.closeAllConnections(); await new Promise<void>(resolve => provider.close(() => resolve())); }
});
