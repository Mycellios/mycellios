import type { AgentRuntimeEvent, ConnectorTool } from "@rakazo/adapter-kit";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fakeAgentState = vi.hoisted(() => ({
  options: ["Berlin", "Seoul", "Toronto"],
  args: undefined as Record<string, unknown> | undefined,
  tools: [] as Array<{
    name: string;
    execute: (toolCallId: string, params: Record<string, unknown>) => Promise<unknown>;
  }>,
}));

vi.mock("@earendil-works/pi-agent-core", () => ({
  Agent: class {
    state = { errorMessage: undefined, messages: [] };
    private readonly tools: typeof fakeAgentState.tools;

    constructor(options: { initialState: { tools: typeof fakeAgentState.tools } }) {
      this.tools = options.initialState.tools;
      fakeAgentState.tools = this.tools;
    }

    subscribe(_listener: unknown) {}

    async prompt() {
      const askUser = this.tools.find((tool) => tool.name === "ask_user");
      if (!askUser) throw new Error("ask_user tool missing");
      await askUser.execute("call-choice-1", {
        question: "Which city should I use?",
        options: fakeAgentState.options,
        ...fakeAgentState.args,
      });
    }

    async waitForIdle() {}

    abort() {}
  },
}));

vi.mock("@earendil-works/pi-ai/providers/all", () => ({
  builtinModels: () => ({
    getModel: (_provider: string, modelId: string) =>
      modelId === "choice-pi-model"
        ? { provider: "test", id: modelId, contextWindow: 32768, maxTokens: 4096 }
        : undefined,
    streamSimple: () => {
      throw new Error("the fake agent must not call a provider");
    },
  }),
}));

vi.mock("./pi-local-provider.js", () => ({
  registerLocalProvider: (models: unknown) => models,
}));

vi.mock("./pi-openai-compatible-provider.js", () => ({
  OPENAI_COMPATIBLE_PROVIDER_ID: "openai-compatible",
  registerOpenAiCompatibleCatalog: (models: unknown) => models,
  registerOpenAiCompatibleRuntime: (models: unknown) => models,
}));

import { builtinAgentTools } from "./builtin-tools.js";
import { PiAgentRuntime } from "./pi-runtime.js";

const choiceTool: ConnectorTool = builtinAgentTools.find(tool => tool.name === "ask_user")!;

const runContext = {
  operationId: "choice-pi",
  traceId: "choice-pi",
  spaceId: "space",
  userId: "user",
  signal: new AbortController().signal,
};

const runRequest = {
  botId: "bot",
  threadId: "thread",
  runId: "run",
  prompt: "ask me which city to use",
  instructions: "Use ask_user for a short list of options.",
  history: [],
  tools: [choiceTool],
  model: { provider: "test", id: "choice-pi-model" },
};

describe("Pi choice asks", () => {
  beforeEach(() => {
    fakeAgentState.args = undefined;
    fakeAgentState.tools = [];
    fakeAgentState.options = ["Berlin", "Seoul", "Toronto"];
  });

  it("emits a tappable ask and stops without a finished-work fallback", async () => {
    const runtime = new PiAgentRuntime();
    const events: AgentRuntimeEvent[] = [];

    for await (const event of runtime.run(runRequest, runContext)) events.push(event);

    expect(events).toContainEqual({
      type: "ask",
      text: "Which city should I use?",
      actions: [
        { id: "choice-1", label: "Berlin" },
        { id: "choice-2", label: "Seoul" },
        { id: "choice-3", label: "Toronto" },
      ],
    });
    expect(
      events.some((event) => event.type === "text" && event.text.includes("I finished the work.")),
    ).toBe(false);
  });

  it("preserves grouped questions and descriptions through the real model-facing schema", async () => {
    fakeAgentState.args = { questions: [
      { question: "Where?", options: [{ label: "Paris", description: "Museums" }, "London"], multiSelect: true },
      { question: "When?" },
    ] };
    const events: AgentRuntimeEvent[] = [];
    for await (const event of new PiAgentRuntime().run(runRequest, runContext)) events.push(event);
    const ask = events.find(event => event.type === "ask");
    expect(ask?.type === "ask" && ask.questions?.[0]?.options[0]?.description).toBe("Museums");
    expect(ask?.type === "ask" && ask.questions?.[1]?.question).toBe("When?");
  });

  it("rejects an empty choice set before emitting an ask", async () => {
    fakeAgentState.options = [];
    const runtime = new PiAgentRuntime();
    const events: AgentRuntimeEvent[] = [];

    await expect(async () => {
      for await (const event of runtime.run(runRequest, runContext)) events.push(event);
    }).rejects.toThrow("ask_user requires two to four unique, non-empty options");
    expect(events.some((event) => event.type === "ask")).toBe(false);
  });
});
