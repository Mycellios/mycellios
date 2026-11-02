import { randomUUID } from "node:crypto";
import type { AgentRunRequest, AgentRuntimeEvent, ConnectorTool } from "@rakazo/adapter-kit";
import { PiAgentRuntime } from "../../adapters/src/pi-runtime.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startModelEmulator } from "./model-emulator.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((fn) => fn()));
});
const request = (
  model: AgentRunRequest["model"],
  extra: Partial<AgentRunRequest> = {},
): AgentRunRequest => ({
  botId: "compaction-fixture",
  threadId: "compaction-thread",
  runId: randomUUID(),
  prompt: "Which destination did I choose?",
  instructions: "Answer the current question directly.",
  history: [],
  tools: [],
  model: { ...model, contextWindow: 12288, maxTokens: 1024 },
  ...extra,
});
const collect = async (source: AsyncIterable<AgentRuntimeEvent>) => {
  const events: AgentRuntimeEvent[] = [];
  for await (const event of source) events.push(event);
  return events;
};
const bodyText = (body: unknown) => JSON.stringify(body);

describe("real Pi compaction with offline HTTP/SSE model", () => {
  it.each([false, true])(
    "preserves the summary output budget with thinking off (reasoning=%s)",
    async (reasoning) => {
      const server = await startModelEmulator({
        steps: [
          {
            expect(body) {
              expect(bodyText(body)).toContain("Summarize conversation data");
              expect(body.max_tokens ?? body.max_completion_tokens).toBe(512);
              expect(body.tools ?? []).toHaveLength(0);
            },
            response: { type: "text", text: "The user chose Japan. No actions were taken." },
          },
          {
            expect(body) {
              expect(bodyText(body)).toContain("conversation_summary");
            },
            response: { type: "text", text: "Japan." },
          },
        ],
      });
      cleanups.push(() => server.close());
      const events = await collect(
        new PiAgentRuntime().run(
          request(server.model, {
            model: {
              ...server.model, reasoning, thinkingLevel: "off",
              contextWindow: 6144, maxTokens: 1024,
            },
            history: [{
              id: "large", role: "user",
              content: "Destination: Japan. " + "detail ".repeat(2200),
            }],
          }),
        ),
      ).catch((error) => {
        server.assertComplete();
        throw error;
      });
      server.assertComplete();
      expect(events.at(-1)).toEqual({ type: "done", text: "Japan." });
    },
  );

  it("summarizes large history on the owned connection before answering and records summary usage separately", async () => {
    const server = await startModelEmulator({
      apiKey: "owned-fixture-key",
      steps: [
        {
          expect(body) {
            expect(bodyText(body)).toContain("Summarize conversation data");
            expect(bodyText(body)).toContain("Destination: Japan");
            expect(body.tools ?? []).toHaveLength(0);
          },
          response: {
            type: "text",
            text: "The user's chosen destination is Japan. No tickets were booked.",
          },
        },
        {
          expect(body) {
            expect(bodyText(body)).toContain("conversation_summary");
            expect(bodyText(body)).toContain("Japan");
            expect(bodyText(body)).toContain("Which destination did I choose?");
          },
          response: { type: "tool", id: "checkpoint-once", name: "remember", arguments: {} },
        },
        {
          expect(body) {
            expect(bodyText(body)).toContain("conversation_summary");
            expect(body.messages.filter(message => message.role === "tool" && message.tool_call_id === "checkpoint-once")).toHaveLength(1);
          },
          response: { type: "text", text: "You chose Japan." },
        },
      ],
    });
    cleanups.push(() => server.close());
    const onUsage = vi.fn(async () => {});
    const beforeCall = vi.fn(async (_call: { operationKind: string }) => randomUUID());
    const afterCall = vi.fn(async () => {});
    const history = Array.from({length: 10}, (_, index) => ({
      id: `old-${index}`, role: "user" as const,
      content: `${index === 0 ? "Destination: Japan." : "Earlier notes."} ${"detail ".repeat(450)}`,
    }));
    const original = JSON.stringify(history);
    const checkpoints: Array<{ messages: Array<{role: string; content: unknown}> }> = [];
    const executeTool = vi.fn(async () => ({ok: true}));
    const events = await collect(
      new PiAgentRuntime({ modelCallObserver: { beforeCall, afterCall } }).run(
        request(server.model, {
          history, onUsage, executeTool,
          tools: [{ name: "remember", description: "Remember the chosen destination", inputSchema: {type:"object",properties:{}} }],
          onCheckpoint: async capture => { checkpoints.push(JSON.parse(capture())); },
        }),
      ),
    );
    server.assertComplete();
    expect(events.at(-1)).toEqual({ type: "done", text: "You chose Japan." });
    expect(JSON.stringify(history)).toBe(original);
    const usage = events.filter((event) => event.type === "usage");
    expect(usage).toHaveLength(3);
    expect(usage.map((event) => event.operationKind)).toEqual(["compaction", "answer", "answer"]);
    expect(onUsage).toHaveBeenCalledTimes(3);
    expect(new Set(usage.map((event) => event.callId)).size).toBe(3);
    expect(beforeCall.mock.calls.map(([call]) => call.operationKind)).toEqual([
      "compaction",
      "answer",
      "answer",
    ]);
    expect(afterCall).toHaveBeenCalledTimes(3);
    expect(executeTool).toHaveBeenCalledOnce();
    expect(checkpoints).toHaveLength(1);
    expect(bodyText(checkpoints[0])).toContain("conversation_summary");
    expect(checkpoints[0]!.messages.filter(message => message.role === "user" && bodyText(message.content).includes("Which destination did I choose?"))).toHaveLength(1);
    expect(checkpoints[0]!.messages.length).toBeLessThan(history.length);
  });

  it("recovers one provider overflow without executing a completed tool twice", async () => {
    const save: ConnectorTool = {
      name: "save",
      description: "Save once",
      inputSchema: { type: "object", properties: {} },
    };
    const server = await startModelEmulator({
      apiKey: "owned-fixture-key",
      steps: [
        { expect() {}, response: { type: "tool", id: "save-once", name: "save", arguments: {} } },
        {
          expect() {},
          response: {
            type: "error",
            status: 400,
            message: "context_length_exceeded: maximum context length exceeded",
          },
        },
        {
          expect(body) {
            expect(bodyText(body)).toContain("Summarize conversation data");
            expect(body.tools ?? []).toHaveLength(0);
          },
          response: { type: "text", text: "The chosen destination is Japan." },
        },
        {
          expect(body) {
            expect(bodyText(body)).toContain("conversation_summary");
            expect(
              body.messages.filter(
                (message) => message.role === "tool" && message.tool_call_id === "save-once",
              ),
            ).toHaveLength(1);
            expect(bodyText(body)).toContain("Saved once");
          },
          response: { type: "text", text: "Saved once. You chose Japan." },
        },
      ],
    });
    cleanups.push(() => server.close());
    const executeTool = vi.fn(async () => ({ result: "Saved once" }));
    const events = await collect(
      new PiAgentRuntime().run(
        request(server.model, {
          history: [
            {
              id: "earlier",
              role: "user",
              content: `Chosen destination: Japan. ${"older detail ".repeat(100)}`,
            },
          ],
          prompt: "Save my choice, then tell me the destination.",
          tools: [save],
          executeTool,
        }),
      ),
    ).catch((error) => {
      server.assertComplete();
      throw error;
    });
    server.assertComplete();
    expect(events.at(-1)).toEqual({ type: "done", text: "Saved once. You chose Japan." });
    expect(executeTool).toHaveBeenCalledOnce();
    expect(
      events.filter((event) => event.type === "usage" && event.operationKind === "compaction"),
    ).toHaveLength(1);
  });
});
