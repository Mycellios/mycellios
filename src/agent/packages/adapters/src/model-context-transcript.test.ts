import type { Api, Context, Model } from "@earendil-works/pi-ai";
import { getCurrentSystemPrompt, getCurrentTools, Type } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { ContextBudgetError, selectContext } from "./context-selection.js";
import { modelContextForAdmission, prepareModelContextBudget } from "./model-context.js";

const model = {
  provider: "openai-compatible",
  api: "openai-completions",
  reasoning: false,
  contextWindow: 6144,
  maxTokens: 1024,
} as Model<Api>;

describe("current transcript admission", () => {
  it("budgets the actual tool state while preserving instructions, answer and call correlation", () => {
    const context: Context = {
      messages: [
        {
          role: "system",
          content: "Never send email without approval.",
          sections: { task: "Old task" },
          toolsAdded: [
            {
              name: "obsolete",
              description: "old schema ".repeat(4000),
              parameters: Type.Object({}),
            },
          ],
          timestamp: 1,
        },
        {
          role: "assistant",
          content: [
            { type: "toolCall", id: "ask-1", name: "ask_user", arguments: { question: "When?" } },
          ],
          timestamp: 2,
        } as never,
        {
          role: "toolResult",
          toolCallId: "ask-1",
          toolName: "ask_user",
          content: [{ type: "text", text: "In November" }],
          isError: false,
          timestamp: 3,
        },
        {
          role: "system",
          content: "",
          sections: { task: "Find a flight to Japan" },
          toolsRemoved: [{ name: "obsolete" }],
          toolsAdded: [
            { name: "ask_user", description: "Ask the user", parameters: Type.Object({}) },
          ],
          timestamp: 4,
        },
      ],
    };
    const prepare = (ctx: Context) => ({
      ...ctx,
      messages: selectContext(ctx.messages, {
        budget: { contextWindow: 6144, outputReserve: 1024, systemPrompt: "", tools: [] },
        strategy: "retrieval",
      }).messages,
    });
    expect(() => prepare(context)).toThrow(ContextBudgetError);
    const result = prepareModelContextBudget(context, model, 1024, (ctx, m) =>
      prepare(modelContextForAdmission(ctx, m)),
    ).context;
    expect(getCurrentTools(result.messages).map((tool) => tool.name)).toEqual(["ask_user"]);
    expect(getCurrentSystemPrompt(result.messages)).toContain("Never send email without approval.");
    expect(getCurrentSystemPrompt(result.messages)).toContain("Find a flight to Japan");
    expect(getCurrentSystemPrompt(result.messages)).not.toContain("Old task");
    expect(result.messages.filter((message) => message.role !== "system")).toEqual(
      context.messages.filter((message) => message.role !== "system"),
    );
    expect(context.messages).toHaveLength(4);
  });

  it("retains genuinely oversized instructions and leaves reasoning transcripts unchanged", () => {
    const context: Context = {
      messages: [{ role: "system", content: "Required policy. ".repeat(3000), timestamp: 1 }],
    };
    const prepare = (ctx: Context) => {
      selectContext(ctx.messages, {
        budget: { contextWindow: 6144, outputReserve: 1024, systemPrompt: "", tools: [] },
        strategy: "retrieval",
      });
      return ctx;
    };
    expect(() => prepareModelContextBudget(context, model, 1024, prepare)).toThrow(
      ContextBudgetError,
    );
    expect(
      prepareModelContextBudget(context, { ...model, reasoning: true }, 1024, (ctx) => ctx).context,
    ).toBe(context);
  });
});
