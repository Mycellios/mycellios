import type { AgentRunRequest, AgentRuntimeEvent, ConnectorTool } from "@rakazo/adapter-kit";
import { PiAgentRuntime } from "@rakazo/adapters";
import { expect, it, vi } from "vitest";
import { startModelEmulator } from "./model-emulator.js";

it("resumes an old unpaged clarification checkpoint inside a real 6k SDK window", async () => {
  const ask: ConnectorTool = {
    name: "ask_user",
    description: "Ask a question",
    inputSchema: { type: "object", properties: { question: { type: "string" } } },
  };
  const tools = [
    ask,
    ...Array.from(
      { length: 24 },
      (_, index): ConnectorTool => ({
        name: `fixture_tool_${index}`,
        description: "Unused schema documentation. ".repeat(150),
        inputSchema: { type: "object", properties: {} },
      }),
    ),
  ];
  const server = await startModelEmulator({
    steps: [
      {
        expect(body) {
          const names = body.tools?.map((tool) => tool.function.name);
          expect(names).toContain("ask_user");
          expect(names).not.toContain("fixture_tool_23");
          expect(body.messages.at(-1)).toMatchObject({
            role: "tool",
            tool_call_id: "ask-date",
            content: "November",
          });
          expect(JSON.stringify(body.messages)).toContain("Japan");
          expect(body.max_tokens ?? body.max_completion_tokens).toBe(1024);
        },
        response: { type: "text", text: "Japan in November." },
      },
    ],
  });
  try {
    const executeTool = vi.fn(async () => ({ ok: true }));
    const request: AgentRunRequest = {
      botId: "fixture-bot",
      threadId: "fixture-thread",
      runId: "fixture-restored-context",
      prompt: "November",
      instructions: "Keep approval boundaries.",
      history: [],
      tools,
      model: { ...server.model, contextWindow: 6144, maxTokens: 1024 },
      executeTool,
      resumeToolResult: { content: [{ type: "text", text: "November" }] },
      turnCheckpoint: JSON.stringify({
        version: 1,
        provider: server.model.provider,
        model: server.model.id,
        systemPrompt: "Keep approval boundaries.",
        pendingToolCallId: "ask-date",
        executionMode: "sequential",
        messages: [
          {
            role: "system",
            content: "Keep approval boundaries.",
            toolsAdded: tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              parameters: tool.inputSchema,
            })),
            timestamp: 1,
          },
          { role: "user", content: "Find a flight to Japan.", timestamp: 2 },
          {
            role: "assistant",
            api: "openai-completions",
            provider: server.model.provider,
            model: server.model.id,
            content: [
              {
                type: "toolCall",
                id: "ask-date",
                name: "ask_user",
                arguments: { question: "When?", options: ["November", "December"] },
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
            timestamp: 3,
          },
        ],
      }),
    };
    const events: AgentRuntimeEvent[] = [];
    try {
      for await (const event of new PiAgentRuntime().run(request)) events.push(event);
    } catch (error) {
      server.assertComplete();
      throw error;
    }
    server.assertComplete();
    expect(events.at(-1)).toEqual({ type: "done", text: "Japan in November." });
    expect(executeTool).not.toHaveBeenCalled();
  } finally {
    await server.close();
  }
});
