import type { AgentRunRequest } from "@mycellios/adapter-kit";
import type { AppendEventInput, Prisma } from "@mycellios/db";
import { appendEventInTransaction } from "@mycellios/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import type * as ComputerLifecycleModule from "./computer-lifecycle.js";
import { createRunExecutor } from "./executor.js";

// Lease rules of native turns (specs/native-engines/spec.md phase 4): with native concurrency
// on, a native side conversation reserves the Mico's computer only before a computer, file or
// command tool, as private Pi tasks do; everything else still reserves it before the turn.
vi.mock("./computer-lifecycle.js", async (importOriginal) => ({
  ...(await importOriginal<typeof ComputerLifecycleModule>()),
  acquireComputerExecutionLease: async () => null,
  provisionComputer: async () => ({ id: "computer-1", kind: "desktop" }),
}));

afterEach(() => vi.unstubAllEnvs());

type ThreadShape = { id: string; botId: string | null; taskBotId: string | null; startedBy: string | null; projectKey: string | null; taskKey: string | null };
const MAIN: ThreadShape = { id: "main", botId: "bot-1", taskBotId: null, startedBy: null, projectKey: null, taskKey: null };
const SIDE: ThreadShape = { id: "side", botId: null, taskBotId: "bot-1", startedBy: "user", projectKey: "mico:bot-1", taskKey: "mico-task:bot-1:side" };

/** One native turn; returns whether the computer lease was taken before the engine started. */
async function turn(thread: ThreadShape, engine: string, options: { flag?: string; busy?: boolean; tool?: string } = {}) {
  vi.stubEnv("MYCELLIOS_NATIVE_CONCURRENCY", options.flag ?? "");
  const run = {
    id: "run-1", botId: "bot-1", threadId: thread.id, taskId: "task-1", spaceId: "space-1", userId: "user-1",
    status: "queued", trigger: "user", sourceMessageId: "source-1", clientNonce: null, leaseFence: 0,
  };
  const leaseTaken = vi.fn(async () => [{ fence: 1 }]);
  let leasedBeforeTurn: number | undefined;
  let toolResult: unknown;
  let offered: AgentRunRequest | undefined;
  const runtimeRun = vi.fn(async function* (request: AgentRunRequest) {
    offered = request;
    leasedBeforeTurn = leaseTaken.mock.calls.length;
    if (options.tool)
      toolResult = await request.executeTool!(options.tool, { path: "notes.txt" }, "call-0").catch((error: unknown) => ({ thrown: String(error) }));
    yield { type: "text" as const, text: "Done." };
    yield { type: "done" as const, text: "Done." };
  });
  const savedEvents: AppendEventInput[] = [];
  const empty = { findMany: async () => [], findFirst: async () => null, findUnique: async () => null, count: async () => 0 };
  const withEmptyModels = <T extends object>(models: T): T =>
    new Proxy(models, {
      get: (target, key) =>
        key in target || typeof key !== "string" || key.startsWith("$") || key === "then" ? Reflect.get(target, key) : empty,
    });
  const bot = {
    id: run.botId, name: "Assistant", title: "Assistant", description: "Test assistant", agentEngine: engine, nativeConfig: null,
    modelProvider: null, modelId: null, thinkingLevel: null, computerId: "computer-1", computerSwitching: false, memoryScope: null,
    computer: { id: "computer-1", kind: "desktop", scope: "dedicated", providerRef: "desktop-1", homeKey: "home-1" },
  };
  const prisma = withEmptyModels({
    user: { findUniqueOrThrow: async () => ({ micoDefaults: {} }), findUnique: vi.fn(async () => null) },
    run: {
      findUnique: vi.fn(async () => run),
      findUniqueOrThrow: vi.fn(async () => run),
      findFirst: vi.fn(async () => null),
      count: vi.fn(async () => 0),
      updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { Object.assign(run, data); return { count: 1 }; }),
    },
    chatGroup: { findMany: vi.fn(async () => []) },
    bot: {
      findUniqueOrThrow: vi.fn(async () => bot),
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => ({ taskConcurrency: 4, agentEngine: engine, thread: { id: MAIN.id } })),
    },
    attempt: { create: vi.fn(async () => ({ id: "attempt-1" })), update: vi.fn(), updateMany: vi.fn(async () => ({ count: 1 })) },
    thread: {
      update: vi.fn(async () => ({ nextMessageSeq: 1, nextEventSeq: savedEvents.length + 1 })),
      findUniqueOrThrow: vi.fn(async () => ({ ...thread, groupId: null, externalConversationId: null, historyCompactionSummary: null,
        historyCompactedUpToSeq: null, nextMessageSeq: 3, contextStartSeq: 0 })),
      // The side conversation belongs to this Mico; nothing else matches.
      findFirst: vi.fn(async ({ where }: { where: { id?: string; taskBotId?: string } }) =>
        where?.taskBotId === "bot-1" && where.id === SIDE.id && thread.id === SIDE.id ? { id: SIDE.id } : null),
    },
    event: { create: vi.fn(async ({ data }: { data: AppendEventInput }) => { savedEvents.push(data); return { ...data, seq: savedEvents.length }; }) },
    message: {
      create: vi.fn(async ({ data }: { data: unknown }) => ({ ...(data as object), id: "message-1" })),
      findMany: vi.fn(async () => []), findUnique: vi.fn(async () => null), findFirst: vi.fn(async () => null),
    },
    task: { findUniqueOrThrow: vi.fn(async () => ({ id: run.taskId, prompt: "Do the work" })), findMany: vi.fn(async () => []) },
    computer: { updateMany: vi.fn(async () => ({ count: 1 })) },
    deploymentSettings: { findUnique: vi.fn(async () => ({ defaultModelProvider: "openrouter", defaultModelId: "fixture-model" })) },
    computerExecutionLease: { updateManyAndReturn: leaseTaken, updateMany: vi.fn(async () => ({ count: 1 })) },
    // Another run of this Mico holds the computer: its SKIP LOCKED lease reads return nothing.
    $queryRaw: vi.fn(async (strings: TemplateStringsArray) =>
      options.busy && strings.join("?").includes("SKIP LOCKED") ? [] : [{ id: "row-1", scope: "dedicated" }]),
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  });
  const executor = createRunExecutor({
    deploymentModelKey: "fixture-model-key",
    contextStrategy: "retrieval",
    prisma,
    runtime: { describe: () => ({ capabilities: { scripted: false } }), run: runtimeRun },
    sandbox: {
      describe: () => ({ capabilities: { graphical: false } }),
      writeFile: vi.fn(async () => undefined),
      readFile: vi.fn(async () => ({ content: Buffer.from("fixture notes") })),
      async *exportWorkspace() { yield* []; },
    },
    home: { commit: vi.fn(async () => "fixture-revision") },
    memory: { read: async () => ({ documents: [] }) },
    memoryProviders: { resolve: async () => null },
    events: {
      append: vi.fn(async (event: AppendEventInput) => appendEventInTransaction(prisma as unknown as Prisma.TransactionClient, event)),
      finalizeRun: vi.fn(async () => ({ continuationRunId: null })),
      pauseRunForInput: vi.fn(async () => ({ continuationRunId: null })),
      notify: vi.fn(async () => undefined),
    },
    jobs: { enqueue: vi.fn(async () => undefined), cancel: vi.fn(async () => undefined) },
    secrets: [],
  } as unknown as Parameters<typeof createRunExecutor>[0]);
  await executor.continueRun(run.id, "worker-1");
  return { runtimeRun, leasedBeforeTurn, leaseTaken, toolResult, offered };
}

describe("computer lease of native turns", () => {
  it("keeps reserving the computer before every native turn while native concurrency is off", async () => {
    for (const thread of [MAIN, SIDE]) {
      const { runtimeRun, leasedBeforeTurn } = await turn(thread, "codex", { flag: "0" });
      expect(runtimeRun).toHaveBeenCalled();
      expect(leasedBeforeTurn).toBe(1);
    }
  });

  it("reserves it only before a computer tool in a native side conversation once enabled", async () => {
    for (const engine of ["codex", "claude", "opencode"]) {
      const { leasedBeforeTurn, leaseTaken, toolResult } = await turn(SIDE, engine, { flag: "1", tool: "read_file" });
      expect(leasedBeforeTurn).toBe(0);
      expect(leaseTaken).toHaveBeenCalledTimes(1);
      expect(toolResult).not.toEqual(expect.objectContaining({ code: "COMPUTER_BUSY" }));
    }
  });

  it("tells a native side conversation the computer is busy instead of running the action", async () => {
    const { leasedBeforeTurn, toolResult, runtimeRun } = await turn(SIDE, "claude", { flag: "1", busy: true, tool: "read_file" });
    expect(runtimeRun).toHaveBeenCalled();
    expect(leasedBeforeTurn).toBe(0);
    expect(toolResult).toEqual(expect.objectContaining({
      code: "COMPUTER_BUSY",
      error: expect.stringContaining("No computer action was executed"),
    }));
  });

  it("still reserves it before the turn in the main chat and for a generic ACP agent", async () => {
    expect((await turn(MAIN, "codex", { flag: "1" })).leasedBeforeTurn).toBe(1);
    expect((await turn(SIDE, "acp", { flag: "1" })).leasedBeforeTurn).toBe(1);
  });
});
