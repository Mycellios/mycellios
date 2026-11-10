import type { AgentRunRequest, AgentRuntimeEvent } from "@rakazo/adapter-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  budgetMycelliosChat,
  createMycelliosChatFetch,
  parseMycelliosToolCalls,
  prepareMycelliosChat,
} from "./mycellios-chat.js";
import { PiAgentRuntime } from "./pi-runtime.js";

const endpoint = "https://www.mycellios.com/v1/chat/completions";
const tool = {
  type: "function" as const,
  function: {
    name: "read_file",
    description: "Read a file",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  },
};
const request = {
  model: "qwen3-test",
  messages: [{ role: "user", content: "Read notes.txt" }],
  tools: [tool],
  stream: true,
  max_tokens: 256,
};
const completion = (content: string) => ({
  id: "job-test",
  object: "chat.completion",
  created: 1,
  model: "qwen3-test",
  choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
  usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 },
});
const envelope = (args = { path: "notes.txt" }) =>
  `<tool_call>\n${JSON.stringify({ name: "read_file", arguments: args })}\n</tool_call>`;

afterEach(() => vi.restoreAllMocks());

describe("Mycellios tool compatibility", () => {
  it("rejects an empty native completion instead of presenting a successful reply", async () => {
    const transport = vi.fn(async () => Response.json(completion("")));
    await expect(
      createMycelliosChatFetch(transport)(endpoint, {
        method: "POST",
        body: JSON.stringify(request),
      }),
    ).rejects.toThrow("empty completion");
  });
  it("places Qwen3's non-reasoning control on the current user turn and preserves explicit reasoning", () => {
    const plain = prepareMycelliosChat({ ...request, model: "Qwen/Qwen3-0.6B", tools: [] });
    expect(plain.request.messages).toEqual([
      { role: "user", content: "Read notes.txt\n/no_think" },
    ]);
    const thinking = prepareMycelliosChat({
      ...request,
      model: "Qwen/Qwen3-0.6B",
      tools: [],
      reasoning_effort: "low",
    });
    expect(thinking.request.messages).toEqual([{ role: "user", content: "Read notes.txt" }]);
  });
  it("defaults to supported greedy generation without overwriting an explicit temperature", () => {
    expect(prepareMycelliosChat(request).request.temperature).toBe(0);
    expect(prepareMycelliosChat({ ...request, temperature: 0.3 }).request.temperature).toBe(0.3);
  });
  it("keeps normal providers untouched", async () => {
    const transport = vi.fn(async () => Response.json({ untouched: true }));
    const init = { method: "POST", body: JSON.stringify(request) };
    await createMycelliosChatFetch(transport)("https://other.example/v1/chat/completions", init);
    expect(transport).toHaveBeenCalledWith("https://other.example/v1/chat/completions", init);
  });

  it("replays tool calls and correlated results using the strict text contract", () => {
    const result = prepareMycelliosChat({
      ...request,
      messages: [
        ...request.messages,
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call-1",
              type: "function",
              function: { name: "read_file", arguments: '{"path":"notes.txt"}' },
            },
          ],
        },
        { role: "tool", tool_call_id: "call-1", content: "File contents" },
      ],
      stream_options: { include_usage: true },
    });
    expect(result.request).toMatchObject({ model: "qwen3-test", stream: true, max_tokens: 256 });
    expect(result.request).not.toHaveProperty("tools");
    expect(result.request).not.toHaveProperty("stream_options");
    const messages = result.request.messages as Array<Record<string, unknown>>;
    expect(messages.at(-2)).toEqual({ role: "assistant", content: envelope() });
    expect(messages.at(-1)).toEqual({
      role: "user",
      content:
        '<tool_response>\n{"name":"read_file","result":"File contents"}\n</tool_response>\n/no_think',
    });
    expect(messages[0]?.content).toContain('"name":"read_file"');
  });

  it("preserves the system instructions before full function declarations in the model template", () => {
    const prepared = prepareMycelliosChat({
      ...request,
      messages: [
        { role: "system", content: "Original agent permissions and instructions." },
        ...request.messages,
      ],
    });
    const messages = prepared.request.messages as Array<{ role: string; content: string }>;
    expect(messages).toHaveLength(2);
    expect(messages[0]?.content.startsWith("Original agent permissions and instructions.")).toBe(
      true,
    );
    expect(messages[0]?.content).toContain(JSON.stringify(tool));
  });

  it("parses nested arguments and delimiters inside JSON strings", () => {
    const args = { path: 'a </tool_call> "quoted".txt' };
    const calls = parseMycelliosToolCalls(envelope(args), [tool], false);
    expect(calls[0]?.function).toEqual({ name: "read_file", arguments: JSON.stringify(args) });
    expect(parseMycelliosToolCalls("```xml\n" + envelope() + "\n```", [tool], true)).toEqual([]);
  });

  it("accepts the native empty thinking envelope without losing a tool call", () => {
    expect(
      parseMycelliosToolCalls(`<think>\n\n</think>\n\n${envelope()}`, [tool], false),
    ).toHaveLength(1);
    expect(() => parseMycelliosToolCalls("<think>unfinished", [tool], false)).toThrow(
      "output limit",
    );
  });

  it.each([
    '<tool_call>{"name":"shell","arguments":{}}</tool_call>',
    '<tool_call>{"name":"read_file","arguments":"not an object"}</tool_call>',
    '<tool_call>{"name":"read_file","arguments":{}}',
    envelope() + "unstructured trailing text",
  ])("rejects invalid calls before the executor can use them", (text) => {
    expect(() => parseMycelliosToolCalls(text, [tool], false)).toThrow();
  });

  it("enforces disabled, required, forced and parallel tool choices", () => {
    expect(prepareMycelliosChat({ ...request, tool_choice: "none" }).tools).toEqual([]);
    expect(() =>
      prepareMycelliosChat({ ...request, tools: [], tool_choice: "required" }),
    ).toThrow();
    expect(() =>
      prepareMycelliosChat({
        ...request,
        tool_choice: { type: "function", function: { name: "unknown" } },
      }),
    ).toThrow();
    expect(() => parseMycelliosToolCalls(envelope() + envelope(), [tool], false)).toThrow();
    expect(parseMycelliosToolCalls(envelope() + envelope(), [tool], true)).toHaveLength(2);
  });

  it("does not silently remove images or unsupported controls", () => {
    expect(() => prepareMycelliosChat({ ...request, stop: ["END"] })).toThrow();
    expect(() =>
      prepareMycelliosChat({
        ...request,
        messages: [
          {
            role: "user",
            content: [{ type: "image_url", image_url: { url: "data:image/png;base64,test" } }],
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      prepareMycelliosChat({
        ...request,
        messages: [{ role: "tool", tool_call_id: "unknown", content: "result" }],
      }),
    ).toThrow();
  });

  it("returns SDK tool events and real usage from one native request", async () => {
    const transport = vi.fn(async () => Response.json(completion(envelope())));
    const fetcher = createMycelliosChatFetch(transport);
    const response = await fetcher(endpoint, {
      method: "POST",
      headers: { authorization: "Bearer test-key", "content-length": "1" },
      body: JSON.stringify(request),
    });
    const sent = transport.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(sent[1].headers).get("authorization")).toBe("Bearer test-key");
    expect(new Headers(sent[1].headers).has("content-length")).toBe(false);
    const text = await response.text();
    const frames = text
      .split("\n\n")
      .filter((frame) => frame.startsWith("data: {"))
      .map((frame) => JSON.parse(frame.slice(6)));
    expect(frames[0].id).toBe("job-test");
    expect(frames[0].choices[0].delta.tool_calls[0].function.name).toBe("read_file");
    expect(frames[1].usage).toEqual(completion("").usage);
    expect(frames[1].choices[0].finish_reason).toBe("tool_calls");
  });

  it.each([false, true])(
    "runs the actual Pi tool loop through the compatibility boundary, streaming=%s",
    async (streaming) => {
      const received: Array<Record<string, unknown>> = [];
      const transport: typeof fetch = vi.fn(async (_input, init) => {
        const native = JSON.parse(String(init?.body)) as Record<string, unknown>;
        received.push(native);
        expect(
          (native.messages as Array<{ role: string }>).every((message) =>
            ["system", "user", "assistant"].includes(message.role),
          ),
        ).toBe(true);
        if (received.length > 2) throw new Error("Unexpected extra model call");
        const content = received.length === 1 ? envelope() : "Fixture final answer";
        if (!streaming) return Response.json(completion(content));
        const result = completion(content);
        const { choices: _choices, ...base } = result;
        const chunks: Array<Record<string, unknown>> = [...content].map((text) => ({
          ...base,
          usage: undefined,
          choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
        }));
        chunks.push({
          ...base,
          choices: [{ index: 0, delta: { content: "" }, finish_reason: "stop" }],
        });
        return new Response(
          chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n",
          { headers: { "content-type": "text/event-stream" } },
        );
      });
      const executeTool = vi.fn(async () => ({ text: "Fixture file content" }));
      const run: AgentRunRequest = {
        runId: "mycellios-fixture-run",
        botId: "fixture-bot",
        threadId: "fixture-thread",
        prompt: "Read notes.txt",
        instructions: "Use the tools as needed.",
        history: [],
        model: {
          provider: "openai-compatible",
          id: request.model,
          baseUrl: "https://www.mycellios.com/v1",
          apiKey: "fixture-key",
          contextWindow: 4096,
          maxTokens: 256,
        },
        tools: [
          {
            name: tool.function.name,
            description: tool.function.description,
            inputSchema: tool.function.parameters,
          },
        ],
        executeTool,
      };
      const events: AgentRuntimeEvent[] = [];
      for await (const event of new PiAgentRuntime({ modelFetch: transport }).run(run))
        events.push(event);
      expect(received).toHaveLength(2);
      expect(executeTool).toHaveBeenCalledOnce();
      expect(executeTool.mock.calls[0]).toEqual(
        expect.arrayContaining(["read_file", { path: "notes.txt" }]),
      );
      const messages = received[1]?.messages as Array<{
        role: string;
        name?: string;
        content: string;
      }>;
      const resultMessage = messages.findLast((message) =>
        message.content.startsWith("<tool_response>"),
      );
      expect(resultMessage?.content).toContain('"name":"read_file"');
      expect(resultMessage?.content).toContain("Fixture file content");
      expect(events.some((event) => event.type === "done")).toBe(true);
    },
  );

  it("does not execute a parsed tool when the native stream has no successful terminal event", async () => {
    const executeTool = vi.fn(async () => ({ text: "must not run" }));
    const transport: typeof fetch = async () =>
      new Response(
        `data: ${JSON.stringify({ id: "job-test", created: 1, model: request.model, choices: [{ index: 0, delta: { content: envelope() }, finish_reason: null }] })}\n\n`,
        { headers: { "content-type": "text/event-stream" } },
      );
    const events: AgentRuntimeEvent[] = [];
    await expect(async () => {
      for await (const event of new PiAgentRuntime({ modelFetch: transport }).run({
        runId: "incomplete-stream-fixture",
        botId: "fixture-bot",
        threadId: "fixture-thread",
        prompt: "Read notes.txt",
        instructions: "Use the available tools.",
        history: [],
        model: {
          provider: "openai-compatible",
          id: request.model,
          baseUrl: "https://www.mycellios.com/v1",
          apiKey: "fixture-key",
          contextWindow: 4096,
          maxTokens: 256,
        },
        tools: [
          {
            name: tool.function.name,
            description: tool.function.description,
            inputSchema: tool.function.parameters,
          },
        ],
        executeTool,
      }))
        events.push(event);
    }).rejects.toThrow();
    expect(executeTool).not.toHaveBeenCalled();
    expect(events.some((event) => event.type === "done")).toBe(false);
  });

  it("loads a deferred schema in the real agent loop without sending the full catalog or executing metadata tools", async () => {
    const nativeRequests: Array<Record<string, unknown>> = [];
    const replies = [
      { name: "__agent_search_tools", arguments: { query: "other_0" } },
      { name: "__agent_load_tool", arguments: { id: "other_0" } },
      { name: "other_0", arguments: {} },
    ];
    const transport: typeof fetch = vi.fn(async (_input, init) => {
      nativeRequests.push(JSON.parse(String(init?.body)));
      const call = replies[nativeRequests.length - 1];
      if (nativeRequests.length > 4) throw new Error("Unexpected extra model call");
      return Response.json(
        completion(
          call ? `<tool_call>${JSON.stringify(call)}</tool_call>` : "Fixture final answer",
        ),
      );
    });
    const executeTool = vi.fn(async () => ({ text: "Fixture file content" }));
    const run: AgentRunRequest = {
      runId: "mycellios-catalog-fixture",
      botId: "fixture-bot",
      threadId: "fixture-thread",
      prompt: "Read notes.txt",
      instructions: "Use authorized tools as needed.",
      history: [],
      model: {
        provider: "openai-compatible",
        id: request.model,
        baseUrl: "https://www.mycellios.com/v1",
        apiKey: "fixture-key",
        contextWindow: 8192,
        maxTokens: 256,
      },
      tools: [
        {
          name: tool.function.name,
          description: tool.function.description,
          inputSchema: tool.function.parameters,
        },
        ...Array.from({ length: 30 }, (_, index) => ({
          name: `other_${index}`,
          description: "A large authorized schema ".repeat(35),
          inputSchema: { type: "object", properties: {} },
        })),
      ],
      executeTool,
    };
    const events: AgentRuntimeEvent[] = [];
    for await (const event of new PiAgentRuntime({ modelFetch: transport }).run(run))
      events.push(event);
    expect(nativeRequests).toHaveLength(4);
    expect(
      executeTool,
      JSON.stringify(
        nativeRequests.map((native) =>
          (native.messages as Array<{ role: string }>).filter((message) => message.role === "tool"),
        ),
      ),
    ).toHaveBeenCalledOnce();
    expect(executeTool.mock.calls[0]).toEqual(
      expect.arrayContaining(["other_0", {}]),
    );
    const first = JSON.stringify(nativeRequests[0]);
    expect(first).not.toContain("A large authorized schema");
    // read_file is a core tool, so it is eager; the connector schema stays deferred.
    expect(first).toContain('\\"name\\":\\"read_file\\"');
    expect(first).not.toContain('\\"name\\":\\"other_0\\"');
    expect(JSON.stringify(nativeRequests[2])).toContain('\\"name\\":\\"other_0\\"');
    expect(events.some((event) => event.type === "done")).toBe(true);
  });

  it("propagates transport failures without a fallback completion", async () => {
    const failed = new Response('{"error":{"code":"model_unavailable"}}', { status: 503 });
    const fetcher = createMycelliosChatFetch(vi.fn(async () => failed));
    expect(await fetcher(endpoint, { method: "POST", body: JSON.stringify(request) })).toBe(failed);
  });

  it("cancels a stalled body even when an injected transport ignores cancellation", async () => {
    let cancelled = false;
    const controller = new AbortController();
    const fetcher = createMycelliosChatFetch(
      vi.fn(
        async () =>
          new Response(
            new ReadableStream({
              cancel() {
                cancelled = true;
              },
            }),
          ),
      ),
    );
    const pending = fetcher(endpoint, {
      method: "POST",
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    await Promise.resolve();
    controller.abort();
    await expect(pending).rejects.toThrow();
    expect(cancelled).toBe(true);
  });

  it("bounds response bytes and rejects a missing required call", async () => {
    const huge = createMycelliosChatFetch(vi.fn(async () => new Response("x".repeat(1_048_577))));
    await expect(huge(endpoint, { body: JSON.stringify(request) })).rejects.toThrow(
      "response limit",
    );
    const absent = createMycelliosChatFetch(
      vi.fn(async () => Response.json(completion("A normal answer"))),
    );
    await expect(
      absent(endpoint, { body: JSON.stringify({ ...request, tool_choice: "required" }) }),
    ).rejects.toThrow("required tool");
  });
});


describe("Mycellios wire context budgeting", () => {
  it("reserves space after serializing tools, without dropping instructions or history", () => {
    const prepared = prepareMycelliosChat({ ...request, max_tokens: 1024 });
    const messages = prepared.request.messages as { role: string; content: string }[];
    const input = Math.ceil(messages.reduce((n, m) => n + m.role.length + m.content.length, 0) / 4);
    const result = budgetMycelliosChat(prepared.request, input + 640);
    expect(result.max_tokens).toBe(512);
    expect(result.messages).toBe(prepared.request.messages);
    expect(prepared.request.max_tokens).toBe(1024);
  });
  it("never raises an explicit ceiling or the network default", () => {
    const source = { model: "native", messages: [{ role: "user", content: "hi" }], max_tokens: 64 };
    expect(budgetMycelliosChat(source, 6144)).toBe(source);
    const { max_tokens: _, ...automatic } = source;
    expect(budgetMycelliosChat(automatic, 6144)).toBe(automatic);
    expect(budgetMycelliosChat(automatic, 160).max_tokens).toBe(30);
  });
  it("reports real input overflow before dispatch so compaction can recover", () => {
    expect(() => budgetMycelliosChat({ messages: [{ role: "user", content: "x".repeat(800) }] }, 256))
      .toThrow("context_length_exceeded");
  });
  it("applies the budget on the actual transport and keeps other providers unchanged", async () => {
    const transport = vi.fn<typeof fetch>(async () => Response.json(completion("73")));
    const body = { ...request, stream: false, max_tokens: 1024 };
    const native = prepareMycelliosChat(body).request;
    const messages = native.messages as { role: string; content: string }[];
    const count = Math.ceil(messages.reduce((n, m) => n + m.role.length + m.content.length, 0) / 4);
    const wrapped = createMycelliosChatFetch(transport, { contextWindow: count + 640 });
    await wrapped(endpoint, { method: "POST", body: JSON.stringify(body) });
    const sent = JSON.parse(String(transport.mock.calls[0]?.[1]?.body));
    expect(sent.max_tokens).toBe(512);
    expect(sent.messages).toEqual(messages);
    const init = { method: "POST", body: JSON.stringify(body) };
    await wrapped("https://other.example/v1/chat/completions", init);
    expect(transport.mock.calls[1]?.[1]).toBe(init);
  });
});


describe("Mycellios admission recovery", () => {
  it("adapts one unadmitted no-capacity call without repeating input or changing its saved ceiling", async () => {
    const transport = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ error: { code: "no_capacity" } }, { status: 503 }))
      .mockResolvedValueOnce(Response.json(completion("83")));
    const body = { ...request, stream: false, max_tokens: 1024 };
    await createMycelliosChatFetch(transport, { contextWindow: 6144 })(endpoint, {
      method: "POST", headers: { authorization: "Bearer fixture", "x-mycellios-funding": "contribution-credits" }, body: JSON.stringify(body),
    });
    expect(transport).toHaveBeenCalledTimes(2);
    const first = JSON.parse(String(transport.mock.calls[0]?.[1]?.body));
    const next = JSON.parse(String(transport.mock.calls[1]?.[1]?.body));
    expect(first.max_tokens).toBe(1024); expect(next.max_tokens).toBe(512);
    expect(next.messages).toEqual(first.messages);
    expect(new Headers(transport.mock.calls[1]?.[1]?.headers).get("x-mycellios-funding")).toBe("contribution-credits");
    expect(body.max_tokens).toBe(1024);
  });
  it.each<{ status: number; code: string; responseHeaders: Record<string, string>; requestHeaders: Record<string, string> }>([
    { status: 503, code: "no_capacity", responseHeaders: { "x-network-request-id": "accepted" }, requestHeaders: {} },
    { status: 503, code: "no_capacity", responseHeaders: {}, requestHeaders: { "idempotency-key": "fixed-request" } },
    { status: 503, code: "other_error", responseHeaders: {}, requestHeaders: {} },
    { status: 403, code: "no_capacity", responseHeaders: {}, requestHeaders: {} },
  ])("does not retry accepted, idempotent, unrelated or billing failures (%j)", async ({ status, code, responseHeaders, requestHeaders }) => {
    const transport = vi.fn<typeof fetch>(async () => Response.json({ error: { code } }, { status, headers: responseHeaders }));
    const r = await createMycelliosChatFetch(transport)(endpoint, { method: "POST", headers: requestHeaders, body: JSON.stringify(request) });
    expect(r.status).toBe(status); expect(transport).toHaveBeenCalledTimes(1);
  });
  it("bounds admission recovery to one retry when capacity stays unavailable", async () => {
    const transport = vi.fn<typeof fetch>(async () => Response.json({ error: { code: "no_capacity" } }, { status: 503 }));
    const r = await createMycelliosChatFetch(transport)(endpoint, { method: "POST", body: JSON.stringify(request) });
    expect(r.status).toBe(503); expect(transport).toHaveBeenCalledTimes(2);
  });
});
