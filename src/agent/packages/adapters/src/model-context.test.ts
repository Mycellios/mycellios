import { MODEL_CONTEXT_TOO_SMALL_ERROR } from "@rakazo/core";
import type { Api, Context, Model } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { ContextBudgetError, selectContext } from "./context-selection.js";
import { prepareModelContextBudget } from "./model-context.js";
import { selectBuiltinToolsForRun } from "./executor.js";
import { resolveCompletionMaxTokens } from "./pi-runtime-limits.js";

const instructions = [
  "You are a helpful assistant for a small bakery. Answer customer questions about opening hours, prices, allergens and custom cake orders. Keep replies short and friendly, and never promise a delivery time you cannot confirm.",
  "When someone asks for a custom cake, collect the date they need it, the number of guests, any dietary restrictions, and the flavor they prefer. Repeat the details back before you save the order, and ask them to confirm.",
  "Every morning, check the shared inventory sheet and tell the team which ingredients are running low. Draft a reorder message but do not send it until someone on the team approves it.",
].join("\n\n");

function typicalBotBudget(contextWindow: number) {
  const tools = selectBuiltinToolsForRun({
    historyRetrievalEnabled: true,
    graphicalToolsAllowed: false,
    groupId: null,
    trigger: "user",
    semanticMemoryEnabled: false,
    messagingChannelRun: false,
  }).map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
  }));
  return {
    contextWindow,
    // A reasoning model reserves the most output room.
    outputReserve: resolveCompletionMaxTokens(undefined, undefined, undefined, true, contextWindow),
    systemPrompt: instructions,
    tools,
  };
}

describe("model context budget", () => {
  const smallModel = { maxTokens: 1024, contextWindow: 6144, reasoning: false } as Model<Api>;
  it("keeps required input and retries only admission with a bounded smaller output ceiling", () => {
    const context: Context = {
      messages: [{ role: "user", content: "protected request", timestamp: 1 }],
    };
    const seen: number[] = [];
    const prepared = prepareModelContextBudget(context, smallModel, 1024, (ctx, m) => {
      seen.push(m.maxTokens);
      if (m.maxTokens > 752) throw new ContextBudgetError(5264, 5120);
      return ctx;
    });
    expect(seen).toEqual([1024, 752]);
    expect(prepared).toEqual({ context, maxTokens: 752 });
    expect(smallModel.maxTokens).toBe(1024);
  });
  it("does not shrink reasoning, overfull input, small limits or unrelated failures", () => {
    const context: Context = { messages: [] };
    for (const [m, cap, error] of [
      [{ ...smallModel, reasoning: true }, 1024, new ContextBudgetError(5264, 5120)],
      [smallModel, 1024, new ContextBudgetError(6144, 5120)],
      [smallModel, 128, new ContextBudgetError(5264, 5120)],
      [smallModel, 1024, new Error("other failure")],
    ] as const) {
      let calls = 0;
      expect(() =>
        prepareModelContextBudget(context, m, cap, () => {
          calls++;
          throw error;
        }),
      ).toThrow(error);
      expect(calls).toBe(1);
    }
  });
  it("fits the real protected-message selector by reducing only output space", () => {
    const selectedModel = { ...smallModel, contextWindow: 4096 };
    const context: Context = {
      messages: [{ role: "user", content: "record ".repeat(1650), timestamp: 1 }],
    };
    const prepare = (ctx: Context, m: Model<Api>) => ({
      ...ctx,
      messages: selectContext(ctx.messages, {
        budget: {
          contextWindow: m.contextWindow,
          outputReserve: m.maxTokens,
          systemPrompt: "Required policy",
          tools: [],
        },
        strategy: "current",
        protectedIndexes: [0],
      }).messages,
    });
    expect(() => prepare(context, selectedModel)).toThrow(ContextBudgetError);
    const result = prepareModelContextBudget(context, selectedModel, 1024, prepare);
    expect(result.maxTokens).toBeGreaterThanOrEqual(256);
    expect(result.maxTokens).toBeLessThan(1024);
    expect(result.context.messages).toEqual(context.messages);
  });
  it("fits a typical bot's instructions and tools in a 32k window", () => {
    const budget = typicalBotBudget(32_768);
    // A byte count alone used to fill the window before any conversation.
    expect(Buffer.byteLength(JSON.stringify(budget.tools), "utf8")).toBeGreaterThan(
      budget.contextWindow - budget.outputReserve,
    );
    const selected = selectContext(
      [{ role: "user", content: "Do you have gluten-free cakes this weekend?" }],
      { budget, strategy: "current" },
    );
    expect(selected.messages).toHaveLength(1);
    expect(selected.estimatedInputTokens).toBeLessThan(budget.contextWindow - budget.outputReserve);
  });

  it("still refuses an 8k window the same tools cannot fit", () => {
    expect(() =>
      selectContext([{ role: "user", content: "hi" }], {
        budget: typicalBotBudget(8_192),
        strategy: "current",
      }),
    ).toThrow(MODEL_CONTEXT_TOO_SMALL_ERROR);
  });
});
