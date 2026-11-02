import { randomUUID } from "node:crypto";
import type { AgentRunRequest, AgentRuntimeEvent, ConnectorTool } from "@rakazo/adapter-kit";
import { PiAgentRuntime } from "@rakazo/adapters";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startModelEmulator } from "./model-emulator.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

const write: ConnectorTool = {
  name: "write_file",
  description: "Save a UTF-8 file",
  inputSchema: {
    type: "object",
    properties: { path: { type: "string" }, content: { type: "string" } },
    required: ["path", "content"],
    additionalProperties: false,
  },
};
// Force schema paging without shrinking the actual turn budget or omitting tools.
const tools = [
  write,
  ...Array.from(
    { length: 24 },
    (_, index): ConnectorTool => ({
      name: `fixture_tool_${index}`,
      description: `An unrelated authorized tool. ${"Detailed schema documentation. ".repeat(100)}`,
      inputSchema: { type: "object", properties: {} },
    }),
  ),
];

const request = (
  model: AgentRunRequest["model"],
  extra: Partial<AgentRunRequest> = {},
): AgentRunRequest => ({
  botId: "fixture-bot",
  threadId: "fixture-thread",
  runId: randomUUID(),
  prompt: "Save hello to notes.txt.",
  instructions: "Complete the requested task.",
  history: [],
  tools,
  model: { ...model, contextWindow: 8192, maxTokens: 1024 },
  ...extra,
});
const collect = async (events: AsyncIterable<AgentRuntimeEvent>) => {
  const result: AgentRuntimeEvent[] = [];
  for await (const event of events) result.push(event);
  return result;
};

describe("real Pi runtime with paged schemas and an offline model fixture", () => {
  it("runs an AntSeed gateway model and tool round trip with its own bearer key", async () => {
    const server = await startModelEmulator({
      modelId: "peer-fixture@text-model",
      apiKey: "antseed_fixture_key",
      responseHeaders: {
        "x-antseed-input-usd-per-million": "0",
        "x-antseed-output-usd-per-million": "0",
      },
      steps: [
        {
          expect(body) {
            expect(body.tools?.some((tool) => tool.function.name === "write_file")).toBe(true);
          },
          response: {
            type: "tool",
            id: "gateway-call",
            name: "write_file",
            arguments: { path: "notes.txt", content: "hello" },
          },
        },
        {
          expect(body) {
            expect(body.messages.at(-1)).toMatchObject({
              role: "tool",
              tool_call_id: "gateway-call",
            });
          },
          response: { type: "text", text: "Saved." },
        },
      ],
    });
    cleanups.push(() => server.close());
    const executeTool = vi.fn(async () => ({ ok: true }));
    const events = await collect(
      new PiAgentRuntime().run(
        request({ ...server.model, provider: "antseed" }, { tools: [write], executeTool }),
      ),
    );
    server.assertComplete();
    expect(executeTool).toHaveBeenCalledOnce();
    expect(events.at(-1)).toEqual({ type: "done", text: "Saved." });
    const usage = events.filter((event) => event.type === "usage");
    expect(usage).toHaveLength(2);
    expect(
      usage.every((event) => event.costUsd === 0 && event.costSource === "provider-reported"),
    ).toBe(true);
  });

  it("preserves an admitted small-window completion budget through the real SDK", async () => {
    const server = await startModelEmulator({
      steps: [
        {
          expect(body) {
            expect(body.max_tokens ?? body.max_completion_tokens).toBe(128);
            expect(body.messages.map((message) => message.role)).toEqual([
              "system",
              "user",
              "assistant",
              "user",
            ]);
            expect(body.messages[2]?.content).toBe("Prior reply.");
          },
          response: { type: "text", text: "Completed." },
        },
      ],
    });
    cleanups.push(() => server.close());
    const events = await collect(
      new PiAgentRuntime().run(
        request(server.model, {
          model: { ...server.model, contextWindow: 4096, maxTokens: 128 },
          tools: [],
          instructions: "Answer directly. ".repeat(160),
          history: [
            { role: "user", content: "Prior question." },
            { role: "assistant", content: "Prior reply." },
          ],
        }),
      ),
    );
    server.assertComplete();
    expect(events.at(-1)).toEqual({ type: "done", text: "Completed." });
  });

  it("searches, loads and invokes the original executor, preserving correlated results", async () => {
    const server = await startModelEmulator({
      steps: [
        {
          expect(body) {
            expect(body.tools?.map((tool) => tool.function.name)).toEqual([
              "__agent_search_tools",
              "__agent_load_tool",
            ]);
          },
          response: {
            type: "tool",
            id: "search",
            name: "__agent_search_tools",
            arguments: { query: "write_file" },
          },
        },
        {
          expect(body) {
            expect(body.messages.at(-1)).toMatchObject({ role: "tool", tool_call_id: "search" });
          },
          response: {
            type: "tool",
            id: "load",
            name: "__agent_load_tool",
            arguments: { id: "write_file" },
          },
        },
        {
          expect(body) {
            expect(body.tools?.some((tool) => tool.function.name === "write_file")).toBe(true);
            expect(body.messages.at(-1)).toMatchObject({ role: "tool", tool_call_id: "load" });
          },
          response: {
            type: "tool",
            id: "write",
            name: "write_file",
            arguments: { path: "notes.txt", content: "hello" },
          },
        },
        {
          expect(body) {
            expect(body.messages.at(-1)).toMatchObject({ role: "tool", tool_call_id: "write" });
          },
          response: { type: "text", text: "Saved." },
        },
      ],
    });
    cleanups.push(() => server.close());
    const executeTool = vi.fn(async (_name: string, _args: Record<string, unknown>) => ({
      ok: true,
    }));
    const events = await collect(new PiAgentRuntime().run(request(server.model, { executeTool })));
    server.assertComplete();
    expect(executeTool).toHaveBeenCalledOnce();
    expect(executeTool.mock.calls[0]?.slice(0, 2)).toEqual([
      "write_file",
      { path: "notes.txt", content: "hello" },
    ]);
    expect(events.at(-1)).toEqual({ type: "done", text: "Saved." });
  });

  it("restores an interrupted metadata load before the next model call without executing a side effect", async () => {
    const server = await startModelEmulator({
      steps: [
        {
          expect(body) {
            expect(body.tools?.some((tool) => tool.function.name === "write_file")).toBe(true);
            expect(body.messages.at(-1)).toMatchObject({ role: "tool", tool_call_id: "load" });
          },
          response: { type: "text", text: "Ready." },
        },
      ],
    });
    cleanups.push(() => server.close());
    const executeTool = vi.fn(async () => ({ ok: true }));
    const turnCheckpoint = JSON.stringify({
      version: 1,
      provider: server.model.provider,
      model: server.model.id,
      systemPrompt: "Complete the requested task.",
      pendingToolCallId: "load",
      executionMode: "sequential",
      messages: [
        {
          role: "assistant",
          api: "openai-completions",
          provider: server.model.provider,
          model: server.model.id,
          content: [
            {
              type: "toolCall",
              id: "load",
              name: "__agent_load_tool",
              arguments: { id: "write_file" },
            },
          ],
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "toolUse",
          timestamp: Date.now(),
        },
      ],
    });
    const events = await collect(
      new PiAgentRuntime().run(request(server.model, { executeTool, turnCheckpoint })),
    ).catch((error) => {
      server.assertComplete();
      throw error;
    });
    server.assertComplete();
    expect(executeTool).not.toHaveBeenCalled();
    expect(events.at(-1)).toEqual({ type: "done", text: "Ready." });
  });
});
