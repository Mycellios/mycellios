import { afterEach, expect, it, vi } from "vitest";
import type { AdapterContext, AgentRunRequest, AgentRuntime, AgentRuntimeEvent } from "@rakazo/adapter-kit";
import { isUncertainDesktopRun } from "@rakazo/core";
import { DesktopAgentRuntime } from "./desktop-agent-runtime.js";
import { startHostComputerServer } from "./host-computer-server.js";
import { DesktopAgentRpc } from "./desktop-agent-rpc.js";
import type { HostComputerRequest } from "./host-computer-protocol.js";
import { desktopAgentFrames } from "./desktop-agent-stream.js";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { PiAgentRuntime } from "./pi-runtime.js";
import { createDesktopAgentEngine } from "./desktop-agent-engine.js";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";

const context: AdapterContext = { userId: "owner", spaceId: "space", botId: "mico", runId: "run", traceId: "trace", operationId: "op", signal: new AbortController().signal };
const describe = () => ({ id: "fixture", contractVersion: "1", adapterVersion: "1", capabilities: { streaming: true, tools: true, compaction: false, scripted: true } });
const hosts: Array<Awaited<ReturnType<typeof startHostComputerServer>>> = [];
afterEach(async () => { for (const host of hosts.splice(0)) await host.close(); });
const request = (): AgentRunRequest => ({ botId: "mico", threadId: "thread", runId: "run", instructions: "Owned Mico", prompt: "hello", history: [], tools: [], model: { provider: "openai", id: "gpt-4o", apiKey: "must-not-reach-desktop" } });

it("resumes an approved tool through the real native host once without replaying the original turn", async () => {
  const profile = await mkdtemp(path.join(tmpdir(), "desktop-approval-flow-"));
  const scope = "a".repeat(64), token = "b".repeat(64);
  const engine = createDesktopAgentEngine(profile, () => scope, () => ({
    describe, abort: vi.fn(), async *run(input) {
      const result = await input.executeTool!("web_fetch", {}, "same-effect") as { approved?: boolean };
      if (result.approved) yield { type: "text", text: "Approved result" };
      yield { type: "done" };
    },
  }));
  const host = await startHostComputerServer({ root: profile, token, hostname: "127.0.0.1", agentRuntime: engine });
  host.setEnabled(true);
  const fallback = { describe, abort: vi.fn(), run: vi.fn() };
  const transport = vi.fn((input: HostComputerRequest, ctx: AdapterContext) => fetch(`http://127.0.0.1:${host.port}/computer`, {
    method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(input), signal: ctx.signal,
  }));
  const runtime = new DesktopAgentRuntime({ fallback, transport, select: async () => ({ available: true, preferred: true }) });
  const tool = vi.fn(async () => ({ approved: false }));
  const input = { ...request(), executeTool: tool };
  try {
    for await (const _ of runtime.run(input, context)) {}
    tool.mockResolvedValue({ approved: true });
    const resumed = { ...input, turnCheckpoint: "durable-approved-effect-checkpoint" };
    const events: AgentRuntimeEvent[] = [];
    for await (const event of runtime.run(resumed, context)) events.push(event);
    expect(events).toContainEqual({ type: "text", text: "Approved result" });
    expect(events.at(-1)?.type).toBe("done");
    expect(tool).toHaveBeenCalledTimes(2);
    const starts = transport.mock.calls.map(([input]) => input).filter(input => input.method === "agentRun");
    expect(starts).toMatchObject([{ runId: input.runId, segmentId: undefined }, { runId: input.runId, segmentId: expect.stringMatching(/^[a-f0-9]{64}$/) }]);
    await expect(async () => { for await (const _ of runtime.run(resumed, context)) {} }).rejects.toThrow("already finished");
    expect(tool).toHaveBeenCalledTimes(2);
    expect(fallback.run).not.toHaveBeenCalled();
  } finally { await host.close(); await rm(profile, { recursive: true, force: true }); }
});

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

it("keeps the Desktop session open for an observer reply after the engine returns", async () => {
  const token = "d".repeat(64);
  const engine: AgentRuntime = {
    describe, abort: vi.fn(),
    async *run(input) {
      void input.onUsage!({ type: "usage", provider: "fixture", model: "fixture", inputTokens: 1, outputTokens: 1, costUsd: null });
      yield { type: "done", text: "Completed" };
    },
  };
  const host = await startHostComputerServer({ root: tmpdir(), token, hostname: "127.0.0.1", agentRuntime: engine });
  hosts.push(host);
  host.setEnabled(true);
  const fallback = { describe, abort: vi.fn(), run: vi.fn() };
  const transport = vi.fn(async (input: HostComputerRequest, ctx: AdapterContext) => {
    if (input.method === "agentMessage") await new Promise(resolve => setTimeout(resolve, 50));
    return fetch(`http://127.0.0.1:${host.port}/computer`, {
      method: "POST", headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify(input), signal: ctx.signal,
    });
  });
  const runtime = new DesktopAgentRuntime({ fallback, transport, select: async () => ({ available: true, preferred: true }) });
  const events: AgentRuntimeEvent[] = [];
  for await (const event of runtime.run(request(), context)) events.push(event);
  expect(events).toEqual([{ type: "done", text: "Completed" }]);
  expect(transport.mock.calls.map(([input]) => input.method)).toEqual(["agentRun", "agentMessage"]);
  expect(fallback.run).not.toHaveBeenCalled();
});

it("does not publish a completion if the Desktop stream loses its terminal frame", async () => {
  const fallback = { describe, abort: vi.fn(), run: vi.fn() };
  const transport = vi.fn(async () => new Response(JSON.stringify({
    value: { kind: "event", value: { kind: "object", value: [["type", "done"], ["text", "Unconfirmed"]] } },
  }) + "\n"));
  const runtime = new DesktopAgentRuntime({ fallback, transport, select: async () => ({ available: true, preferred: true }) });
  const events: AgentRuntimeEvent[] = [];
  await expect(async () => {
    for await (const event of runtime.run(request(), context)) events.push(event);
  }).rejects.toThrow("disconnected");
  expect(events).toEqual([]);
  expect(transport).toHaveBeenCalledTimes(1);
  expect(fallback.run).not.toHaveBeenCalled();
});

it("runs new turns in cloud only when Desktop is not preferred and preserves bound work", async () => {
  const fallback = { describe, abort: vi.fn(), run: vi.fn(async function* () { yield { type: "done" as const }; }) };
  const transport = vi.fn();
  const old = new DesktopAgentRuntime({ fallback, transport, select: async () => ({ available: false, preferred: false }) });
  for await (const _ of old.run(request(), context)) {}
  expect(fallback.run).toHaveBeenCalledTimes(1);
  const offline = new DesktopAgentRuntime({ fallback, transport, select: async () => ({ available: false, preferred: true }) });
  const fresh = { ...request(), resumeToolResult: { content: [{ type: "text" as const, text: "hello" }] } };
  await expect(async () => { for await (const _ of offline.run(fresh, context)) {} }).rejects.toThrow(
    "did not move to the cloud",
  );
  expect(fallback.run).toHaveBeenCalledTimes(1);
  for (const [input, scope] of [
    [request(), { ...context, projectSessionId: "project" }],
    [{ ...request(), resumeFromCheckpoint: "checkpoint" }, context],
    [{ ...fresh, turnCheckpoint: "durable-checkpoint" }, context],
  ] as const) {
    await expect(async () => { for await (const _ of offline.run(input, scope)) {} }).rejects.toThrow("bound");
  }
  expect(fallback.run).toHaveBeenCalledTimes(1);
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

it("distinguishes a lost Desktop transport from a returned provider failure", async () => {
  const fallback = { describe, abort: vi.fn(), run: vi.fn() };
  const providerFailure = '429: {"error":{"code":"quota_exhausted"}}';
  const transport = vi.fn()
    .mockRejectedValueOnce(new Error("fetch failed"))
    .mockResolvedValueOnce(new Response(JSON.stringify({
      value: { kind: "failure", value: { kind: "error", value: ["ModelAccountError", providerFailure] } },
    }) + "\n"));
  const runtime = new DesktopAgentRuntime({ fallback, transport, select: async () => ({ available: true, preferred: true }) });
  const run = async () => { for await (const _ of runtime.run(request(), context)) {} };
  const disconnected = await run().catch((error: Error) => error);
  expect(disconnected).toBeInstanceOf(Error);
  expect(isUncertainDesktopRun(disconnected?.message)).toBe(true);
  await expect(run()).rejects.toMatchObject({ name: "ModelAccountError", message: providerFailure });
  expect(fallback.run).not.toHaveBeenCalled();
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

it("redelivers a completed tool result when its acknowledgement is lost", async () => {
  const token = "e".repeat(64);
  let release!: () => void;
  const hold = new Promise<void>((resolve) => { release = resolve; });
  let toolCalls = 0;
  const engine: AgentRuntime = {
    describe, abort: vi.fn(),
    async *run(input) {
      const value = await input.executeTool!("shell", { command: "echo hi" }, "call-1") as { stdout?: string };
      yield { type: "text", text: String(value.stdout) };
      await hold;
      yield { type: "done" };
    },
  };
  const host = await startHostComputerServer({ root: tmpdir(), token, hostname: "127.0.0.1", agentRuntime: engine });
  hosts.push(host);
  host.setEnabled(true);
  let acknowledgements = 0;
  const transport = vi.fn(async (input: HostComputerRequest, ctx: AdapterContext) => {
    const response = await fetch(`http://127.0.0.1:${host.port}/computer`, {
      method: "POST", headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify(input), signal: ctx.signal,
    });
    if (input.method !== "agentMessage") return response;
    acknowledgements += 1;
    if (acknowledgements === 1) {
      await response.body?.cancel();
      return new Response(`${JSON.stringify({ value: { accepted: true } })}\n`);
    }
    release();
    return response;
  });
  const fallback = { describe, abort: vi.fn(), run: vi.fn() };
  const runtime = new DesktopAgentRuntime({ fallback, transport, select: async () => ({ available: true, preferred: true }) });
  const input = request();
  input.executeTool = async () => { toolCalls += 1; return { code: 0, stdout: "ok", stderr: "" }; };
  const events: AgentRuntimeEvent[] = [];
  for await (const event of runtime.run(input, context)) events.push(event);
  expect(events).toEqual([{ type: "text", text: "ok" }, { type: "done" }]);
  expect(toolCalls).toBe(1);
  expect(acknowledgements).toBe(2);
  expect(fallback.run).not.toHaveBeenCalled();
});

it("delivers a finished command result when the executor heartbeat marks the PC unavailable", async () => {
  const token = "f".repeat(64);
  const engine: AgentRuntime = {
    describe, abort: vi.fn(),
    async *run(input) {
      const value = await input.executeTool!("shell", { command: "echo hi" }, "call-1") as { stdout?: string };
      yield { type: "text", text: String(value.stdout) };
      yield { type: "done" };
    },
  };
  const host = await startHostComputerServer({ root: tmpdir(), token, hostname: "127.0.0.1", agentRuntime: engine });
  hosts.push(host);
  host.setEnabled(true);
  const fallback = { describe, abort: vi.fn(), run: vi.fn() };
  const runtime = new DesktopAgentRuntime({
    fallback,
    select: async () => ({ available: true, preferred: true }),
    transport: (input, ctx) => fetch(`http://127.0.0.1:${host.port}/computer`, {
      method: "POST", headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify(input), signal: ctx.signal,
    }),
  });
  const input = request();
  input.executeTool = async () => {
    host.setEnabled(false, false);
    return { code: 0, stdout: "ok", stderr: "" };
  };
  const events: AgentRuntimeEvent[] = [];
  for await (const event of runtime.run(input, context)) events.push(event);
  expect(events).toEqual([{ type: "text", text: "ok" }, { type: "done" }]);
  expect(fallback.run).not.toHaveBeenCalled();
});
