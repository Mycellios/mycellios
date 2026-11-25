import { request } from "node:http";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import type { AgentRunModel, ModelCallObserver } from "@mycellios/adapter-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { desktopToolModelAccess, desktopToolModelCompletion } from "./desktop-tool-model-bridge.js";
import { startDesktopToolModelEndpoint } from "./desktop-tool-model-endpoint.js";

const provider = vi.hoisted(() => vi.fn());
vi.mock("./pi-runtime.js", () => ({
  resolveRuntimeModel: (config: AgentRunModel) => ({
    models: { streamSimple: provider },
    model: {
      id: config.id, api: "openai-completions", provider: "openai", baseUrl: "https://fixture.invalid",
      cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, contextWindow: 4096, maxTokens: 128,
    },
    apiKey: config.apiKey,
  }),
  reliableModelStream: (_models: unknown, _model: unknown, _context: unknown, options: unknown,
    _maxTokens: unknown, _credential: unknown, open: (options: unknown) => unknown) => open(options),
}));

type Endpoint = Awaited<ReturnType<typeof startDesktopToolModelEndpoint>>;
const endpoints: Endpoint[] = [];
afterEach(async () => {
  await Promise.all(endpoints.splice(0).map((endpoint) => endpoint.close()));
  vi.resetAllMocks();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const prompt = { model: "fixture", messages: [{ role: "user", content: "synthetic input" }], max_tokens: 32 };
const complete = () => Promise.resolve({ text: "synthetic output", stop: "stop" as const, inputTokens: 8, outputTokens: 3 });

function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    const req = request(url, {
      method: "POST", headers: { "content-type": "application/json", ...headers }, agent: false,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("error", reject);
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode!, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
        } catch (error) { reject(error); }
      });
    });
    req.on("error", reject);
    req.end(JSON.stringify(body));
  });
}

async function endpoint(options: Partial<Parameters<typeof startDesktopToolModelEndpoint>[0]> = {}) {
  const local = await startDesktopToolModelEndpoint({
    modelId: "fixture", signal: new AbortController().signal, complete, ...options,
  });
  endpoints.push(local);
  return {
    ...local,
    chat: local.environment.OPENAI_BASE_URL + "/chat/completions",
    messages: local.environment.ANTHROPIC_BASE_URL + "/v1/messages",
    bearer: { authorization: `Bearer ${local.environment.OPENAI_API_KEY}` },
    apiKey: { "x-api-key": local.environment.ANTHROPIC_API_KEY },
  };
}

describe("one-run Desktop model listener", () => {
  it("uses one loopback-only authority with native request formats and separate tokens across runs", async () => {
    const first = await endpoint();
    const second = await endpoint();
    expect(new URL(first.chat).hostname).toBe("127.0.0.1");
    expect(first.environment.OPENAI_API_KEY).not.toBe(second.environment.OPENAI_API_KEY);
    expect(await post(first.chat, prompt, second.bearer)).toMatchObject({ status: 401 });
    const response = await fetch(first.chat, { method: "POST", body: JSON.stringify(prompt),
      headers: { ...first.bearer, "content-type": "application/json" } });
    expect({ status: response.status, body: await response.json() }).toMatchObject({
      status: 200, body: { model: "fixture", choices: [{ message: { content: "synthetic output" } }] },
    });
    expect(await post(first.messages, prompt, first.apiKey)).toMatchObject({
      status: 200, body: { stop_reason: "end_turn", content: [{ text: "synthetic output" }] },
    });
  });

  it("streams text to the OpenAI and Anthropic SDKs before the terminal reply", async () => {
    const release = deferred<void>();
    const local = await endpoint({
      async complete(_input, _signal, onText) {
        await onText?.("early");
        await release.promise;
        await onText?.(" late");
        return { text: "early late", stop: "stop", inputTokens: 4, outputTokens: 2 };
      },
    });
    const openai = new OpenAI({ apiKey: local.environment.OPENAI_API_KEY,
      baseURL: local.environment.OPENAI_BASE_URL, maxRetries: 0 });
    const anthropic = new Anthropic({ apiKey: local.environment.ANTHROPIC_API_KEY,
      baseURL: local.environment.ANTHROPIC_BASE_URL, maxRetries: 0 });
    const oai = await openai.chat.completions.create({
      model: "fixture", messages: [{ role: "user", content: "synthetic input" }], max_tokens: 32, stream: true,
    });
    const claude = await anthropic.messages.create({
      model: "fixture", messages: [{ role: "user", content: "synthetic input" }], max_tokens: 32, stream: true,
    });
    const oaiIterator = oai[Symbol.asyncIterator]();
    const anthropicIterator = claude[Symbol.asyncIterator]();
    try {
      expect((await oaiIterator.next()).value).toMatchObject({ choices: [{ delta: { role: "assistant" } }] });
      expect((await oaiIterator.next()).value).toMatchObject({ choices: [{ delta: { content: "early" } }] });
      expect((await anthropicIterator.next()).value).toMatchObject({ type: "message_start" });
      expect((await anthropicIterator.next()).value).toMatchObject({ type: "content_block_start" });
      expect((await anthropicIterator.next()).value).toMatchObject({ type: "content_block_delta", delta: { text: "early" } });
    } finally {
      release.resolve();
    }
    expect((await oaiIterator.next()).value).toMatchObject({ choices: [{ delta: { content: " late" } }] });
    expect((await oaiIterator.next()).value).toMatchObject({ choices: [{ finish_reason: "stop" }] });
    expect((await oaiIterator.next()).done).toBe(true);
    expect((await anthropicIterator.next()).value).toMatchObject({ type: "content_block_delta", delta: { text: " late" } });
    expect((await anthropicIterator.next()).value).toMatchObject({ type: "content_block_stop" });
    expect((await anthropicIterator.next()).value).toMatchObject({ type: "message_delta", usage: { output_tokens: 2 } });
    expect((await anthropicIterator.next()).value).toMatchObject({ type: "message_stop" });
    expect((await anthropicIterator.next()).done).toBe(true);
  });

  it("refuses unauthenticated requests and unsupported parameters before invoking the model", async () => {
    const run = vi.fn(complete);
    const local = await endpoint({ complete: run });
    expect(await post(local.chat, prompt)).toMatchObject({ status: 401 });
    const deniedHeaders: Record<string, string>[] = [
      { host: "other.invalid" }, { origin: "http://127.0.0.1" }, { "sec-fetch-site": "same-origin" },
    ];
    for (const headers of deniedHeaders) {
      expect(await post(local.chat, prompt, { ...local.bearer, ...headers })).toMatchObject({ status: 403 });
    }
    for (const extra of [{ model: "other" }, { stream: "true" }, { tools: [] }, { max_tokens: 4097 }]) {
      expect(await post(local.chat, { ...prompt, ...extra }, local.bearer)).toMatchObject({ status: 400 });
    }
    expect(await post(local.chat, { ...prompt, messages: [{ role: "user", content: "x".repeat(66_000) }] },
      local.bearer)).toMatchObject({ status: 413 });
    expect(run).not.toHaveBeenCalled();
  });

  it("aborts active calls and removes the listener at run end", async () => {
    const run = new AbortController();
    const started = deferred<void>();
    const stopped = deferred<void>();
    const local = await endpoint({
      signal: run.signal,
      async complete(_input, signal) {
        started.resolve();
        await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
        stopped.resolve();
        signal.throwIfAborted();
        return complete();
      },
    });
    const pending = expect(post(local.chat, prompt, local.bearer)).rejects.toThrow();
    await started.promise;
    run.abort();
    await Promise.all([pending, stopped.promise, local.close()]);
    await expect(post(local.chat, prompt, local.bearer)).rejects.toThrow();
  });
});

it("cancels the owned stream exactly once when the local client aborts", async () => {
  const opened = deferred<void>();
  const finished = deferred<{ events: unknown[]; done: boolean }>();
  const cancel = vi.fn(async () => { finished.resolve({ events: [], done: true }); });
  const complete = desktopToolModelCompletion({
    modelId: "fixture",
    async open() {
      opened.resolve();
      return { read: () => finished.promise, cancel };
    },
  });
  const client = new AbortController();
  const pending = expect(complete({ messages: [{ role: "user", text: "synthetic input" }], maxTokens: 32 },
    client.signal)).rejects.toThrow();
  await opened.promise;
  client.abort();
  await pending;
  expect(cancel).toHaveBeenCalledOnce();
});

describe("owned server model admission", () => {
  it("connects the loopback request to ordinary server metering before the owned stream opens", async () => {
    const run = new AbortController();
    const wallet: ModelCallObserver = {
      beforeCall: vi.fn().mockResolvedValueOnce("reservation").mockRejectedValueOnce(new Error("Exceeds approved budget")),
      afterCall: vi.fn(),
    };
    const allowed = { provider: "openai", id: "fixture", apiKey: "fixture-server-key", callObserver: wallet };
    const accounting = { runId: "run", userId: "owner", operationKind: "answer" as const,
      onUsage: async () => undefined, push() {} };
    const message: AssistantMessage = {
      role: "assistant", content: [{ type: "text", text: "verified" }], timestamp: Date.now(),
      api: "openai-completions", provider: "openai", model: "fixture", stopReason: "stop",
      usage: { input: 8, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 11,
        cost: { input: 0.000008, output: 0.000003, cacheRead: 0, cacheWrite: 0, total: 0.000011 } },
    };
    provider.mockImplementation((_model, _context, options) => {
      expect(wallet.beforeCall).toHaveBeenCalledWith(expect.objectContaining({ runId: "run", maxCostUsd: 0.004128 }));
      expect(options).toMatchObject({ apiKey: "fixture-server-key", maxRetries: 0 });
      const stream = createAssistantMessageEventStream();
      stream.push({ type: "done", reason: "stop", message });
      stream.end(message);
      return stream;
    });
    const access = desktopToolModelAccess(allowed, run.signal, new Set(), accounting);
    expect(() => desktopToolModelAccess({ ...allowed, callObserver: undefined }, run.signal, new Set(), accounting)).toThrow("metered model");
    const local = await endpoint({ signal: run.signal, complete: desktopToolModelCompletion(access) });
    expect(JSON.stringify(local.environment)).not.toContain("fixture-server-key");
    expect(await post(local.chat, prompt, local.bearer)).toMatchObject({
      status: 200, body: { choices: [{ message: { content: "verified" } }] },
    });
    expect(wallet.afterCall).toHaveBeenCalledWith("reservation", expect.objectContaining({ costUsd: 0.000011, inputTokens: 8, outputTokens: 3 }));
    expect(await post(local.messages, prompt, local.apiKey)).toMatchObject({ status: 502 });
    expect(provider).toHaveBeenCalledOnce();
  });
});
