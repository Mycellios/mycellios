import { createServer, type IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import type { AdapterContext, AgentRunRequest, AgentRuntime, AgentRuntimeEvent } from "@mycellios/adapter-kit";
import { DEVICE_MODEL_OFFLINE_ERROR, OPENAI_COMPATIBLE_PROVIDER_ID } from "@mycellios/contracts";
import { DesktopAgentRuntime } from "./desktop-agent-runtime.js";
import { DeviceModelRuntime } from "./device-model-runtime.js";
import { startHostComputerServer } from "./host-computer-server.js";
import { PiAgentRuntime } from "./pi-runtime.js";

const context: AdapterContext = { userId: "owner", spaceId: "space", botId: "mico", runId: "run", traceId: "trace", operationId: "op", signal: new AbortController().signal };
const describe = () => ({ id: "fixture", contractVersion: "1", adapterVersion: "1", capabilities: { streaming: true, tools: true, compaction: false, scripted: true } });
const deviceRequest = (): AgentRunRequest => ({
  botId: "mico", threadId: "thread", runId: "run", instructions: "Owned Mico", prompt: "hello", history: [], tools: [],
  model: { provider: "device", id: "qwen3.5-2b", contextWindow: 16384, maxTokens: 2048 },
});
const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

async function collect(events: AsyncIterable<AgentRuntimeEvent>) {
  const seen: AgentRuntimeEvent[] = [];
  for await (const event of events) seen.push(event);
  return seen;
}

it("never moves a local-model turn to the server, offline or on a server workspace", async () => {
  const fallback = { describe, abort: vi.fn(), run: vi.fn() };
  const offline = new DesktopAgentRuntime({ fallback, transport: vi.fn(), select: async () => ({ available: false, preferred: false }) });
  await expect(collect(offline.run(deviceRequest(), context))).rejects.toThrow(DEVICE_MODEL_OFFLINE_ERROR);
  await expect(collect(offline.run(deviceRequest(), { ...context, cloudWorkspace: true } as AdapterContext))).rejects.toThrow(DEVICE_MODEL_OFFLINE_ERROR);
  expect(fallback.run).not.toHaveBeenCalled();
});

it("sends the PC only the model id: no cloud model channel, key or endpoint", async () => {
  const seen: AgentRunRequest["model"][] = [];
  const engine: AgentRuntime = { describe, abort: vi.fn(), async *run(input) { seen.push(input.model); yield { type: "text", text: "Hi" }; yield { type: "done" }; } };
  const token = "d".repeat(64);
  const host = await startHostComputerServer({ root: tmpdir(), token, hostname: "127.0.0.1", agentRuntime: engine });
  cleanups.push(() => host.close());
  host.setEnabled(true);
  const fallback = { describe, abort: vi.fn(), run: vi.fn() };
  const runtime = new DesktopAgentRuntime({ fallback, select: async () => ({ available: true, preferred: true }),
    transport: (input, ctx) => fetch(`http://127.0.0.1:${host.port}/computer`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(input), signal: ctx.signal }) });
  expect(await collect(runtime.run(deviceRequest(), context))).toEqual([{ type: "text", text: "Hi" }, { type: "done" }]);
  expect(seen).toEqual([expect.objectContaining({ provider: "device", id: "qwen3.5-2b" })]);
  expect(seen[0]!.desktopTransport).toBeUndefined();
  expect(seen[0]!.apiKey).toBeUndefined();
  expect(fallback.run).not.toHaveBeenCalled();
});

it("resolves the model to this PC's loopback server and runs it in light mode", async () => {
  const ordinary = { describe, abort: vi.fn(), run: vi.fn(async function* () { yield { type: "done" as const }; }) };
  const light = { describe, abort: vi.fn(), run: vi.fn(async function* () { yield { type: "done" as const }; }) };
  const resolve = vi.fn(async () => ({ baseUrl: "http://127.0.0.1:4100/v1", apiKey: "per-start-key", contextWindow: 16384 }));
  const runtime = new DeviceModelRuntime(ordinary, light, resolve);
  await collect(runtime.run({ ...deviceRequest(), fallbackModels: [{ provider: "openai", id: "gpt-4o" }] }, context));
  expect(resolve).toHaveBeenCalledWith("qwen3.5-2b");
  const sent = (light.run.mock.calls[0] as unknown as [AgentRunRequest])[0];
  expect(sent.model).toMatchObject({ provider: OPENAI_COMPATIBLE_PROVIDER_ID, id: "qwen3.5-2b", baseUrl: "http://127.0.0.1:4100/v1", apiKey: "per-start-key", allowPrivateEndpoint: true });
  expect(sent.fallbackModels).toBeUndefined();
  expect(ordinary.run).not.toHaveBeenCalled();
  await collect(runtime.run({ ...deviceRequest(), model: { provider: "openai", id: "gpt-4o" } }, context));
  expect(ordinary.run).toHaveBeenCalledTimes(1);
});

it("explains that an older Desktop cannot run local models", async () => {
  const runtime = new DeviceModelRuntime({ describe, abort: vi.fn(), run: vi.fn() }, { describe, abort: vi.fn(), run: vi.fn() }, undefined);
  await expect(collect(runtime.run(deviceRequest(), context))).rejects.toThrow("cannot run models on this PC");
});

it("answers a real Pi turn from an OpenAI-compatible server on loopback, keyed per start", async () => {
  const bodies: { authorization?: string; body: { model?: string; messages?: unknown[] } }[] = [];
  const server = createServer(async (request: IncomingMessage, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    bodies.push({ authorization: request.headers.authorization, body: JSON.parse(raw || "{}") });
    response.writeHead(200, { "content-type": "text/event-stream" });
    const chunk = (delta: object, finish: string | null = null) =>
      `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 1, model: "qwen3.5-2b", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
    response.write(chunk({ role: "assistant", content: "Hola" }));
    response.write(chunk({}, "stop"));
    response.write(`data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 1, model: "qwen3.5-2b", choices: [], usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 } })}\n\n`);
    response.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise((resolve) => server.close(resolve)));
  const port = (server.address() as { port: number }).port;
  const runtime = new DeviceModelRuntime(new PiAgentRuntime(), new PiAgentRuntime({ maxEagerToolSchemas: 12 }),
    async () => ({ baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: "per-start-key", contextWindow: 16384 }));
  const events = await collect(runtime.run(deviceRequest(), context));
  expect(events.filter((event) => event.type === "text").map((event) => (event as { text: string }).text).join("")).toContain("Hola");
  expect(events.at(-1)?.type).toBe("done");
  expect(bodies[0]).toMatchObject({ authorization: "Bearer per-start-key", body: { model: "qwen3.5-2b" } });
});
