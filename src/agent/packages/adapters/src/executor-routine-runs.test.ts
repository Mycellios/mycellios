import type { AgentRunRequest } from "@mycellios/adapter-kit";
import type { AppendEventInput, Prisma } from "@mycellios/db";
import { appendEventInTransaction } from "@mycellios/db";
import { describe, expect, it, vi } from "vitest";
import type * as ComputerLifecycleModule from "./computer-lifecycle.js";
import {
  createRunExecutor,
  ROUTINE_FAILURE_SURFACE_ERROR,
  ROUTINE_SILENT_REPLY_GUIDANCE,
} from "./executor.js";
import { ROUTINE_RUN_SCHEDULE_UPDATE_ERROR } from "./schedule-tools.js";

vi.mock("./computer-lifecycle.js", async (importOriginal) => ({
  ...(await importOriginal<typeof ComputerLifecycleModule>()),
  acquireComputerExecutionLease: async () => null,
  provisionComputer: async () => ({ id: "computer-1", kind: "desktop" }),
}));

type ThreadShape = {
  id: string;
  botId: string | null;
  taskBotId: string | null;
  startedBy: string | null;
  projectKey: string | null;
  taskKey: string | null;
};

const MAIN: ThreadShape = {
  id: "main",
  botId: "bot-1",
  taskBotId: null,
  startedBy: null,
  projectKey: null,
  taskKey: null,
};
const ROUTINE: ThreadShape = {
  id: "routine-thread",
  botId: null,
  taskBotId: "bot-1",
  startedBy: "routine",
  projectKey: "routine:routine-1",
  taskKey: "routine:routine-1",
};
const routineRow = {
  id: "routine-1",
  spaceId: "space-1",
  botId: "bot-1",
  userId: "user-1",
  threadId: "routine-thread",
  name: "Price watch",
  prompt: "Check the prices",
  crons: ["0 8 * * *"],
  timezone: "UTC",
  active: true,
  watch: null,
  lastRunAt: null,
  nextRunAt: new Date("2026-11-23T08:00:00.000Z"),
};
const finalized = (finalizeRun: ReturnType<typeof vi.fn>) =>
  (finalizeRun.mock.calls.at(-1) as unknown as [Record<string, unknown>])[0];

/** One turn with a fake runtime that may call tools; returns what the runtime was offered. */
async function turn(
  thread: ThreadShape,
  options: {
    trigger?: string;
    calls?: Array<{ name: string; args: Record<string, unknown> }>;
    taskReport?: { runId: string; threadId: string; seq: number };
    clientNonce?: string | null;
    routineId?: string | null;
    reply?: string;
    routine?: Record<string, unknown> | null;
  } = {},
) {
  const run = {
    id: "run-1",
    botId: "bot-1",
    threadId: thread.id,
    taskId: "task-1",
    spaceId: "space-1",
    userId: "user-1",
    status: "queued",
    trigger: options.trigger ?? "user",
    sourceMessageId: null,
    clientNonce: options.clientNonce ?? null,
    routineId: options.routineId === undefined ? "routine-1" : options.routineId,
    startedAt: new Date("2026-11-22T08:00:00.000Z"),
    leaseFence: 0,
  };
  const results: unknown[] = [];
  let offered: AgentRunRequest | undefined;
  const runtimeRun = vi.fn(async function* (request: AgentRunRequest) {
    offered = request;
    for (const [index, call] of (options.calls ?? []).entries())
      results.push(
        await request.executeTool!(call.name, call.args, `call-${index}`).catch(
          (error: unknown) => ({ thrown: String(error) }),
        ),
      );
    const reply = options.reply ?? "Done.";
    if (reply) yield { type: "text" as const, text: reply };
    yield { type: "done" as const, text: reply };
  });
  const savedEvents: AppendEventInput[] = [];
  // Models this fixture does not describe read as empty (approval rules, preferences, ...).
  const empty = {
    findMany: async () => [],
    findFirst: async () => null,
    findUnique: async () => null,
    count: async () => 0,
  };
  const withEmptyModels = <T extends object>(models: T): T =>
    new Proxy(models, {
      get: (target, key) =>
        key in target || typeof key !== "string" || key.startsWith("$") || key === "then"
          ? Reflect.get(target, key)
          : empty,
    });
  const prisma = withEmptyModels({
    user: {
      findUniqueOrThrow: async () => ({ micoDefaults: {} }),
      findUnique: vi.fn(async () => null),
    },
    run: {
      findUnique: vi.fn(async () => run),
      findUniqueOrThrow: vi.fn(async () => run),
      findFirst: vi.fn(async () => null),
      count: vi.fn(async () => 0),
      updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(run, data);
        return { count: 1 };
      }),
    },
    chatGroup: { findMany: vi.fn(async () => []) },
    bot: {
      findUniqueOrThrow: vi.fn(async () => ({
        id: run.botId,
        name: "Assistant",
        title: "Assistant",
        description: "Test assistant",
        modelProvider: null,
        modelId: null,
        thinkingLevel: null,
        computerId: "computer-1",
        computerSwitching: false,
        memoryScope: null,
        computer: { id: "computer-1", scope: "dedicated" },
      })),
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => ({ taskConcurrency: 4, agentEngine: "pi" })),
    },
    attempt: {
      create: vi.fn(async () => ({ id: "attempt-1" })),
      update: vi.fn(),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    thread: {
      update: vi.fn(async () => ({ nextMessageSeq: 1, nextEventSeq: savedEvents.length + 1 })),
      findUniqueOrThrow: vi.fn(async () => ({
        ...thread,
        groupId: null,
        externalConversationId: null,
        historyCompactionSummary: null,
        historyCompactedUpToSeq: null,
        nextMessageSeq: 3,
        contextStartSeq: 0,
      })),
      findFirst: vi.fn(async () => null),
    },
    event: {
      create: vi.fn(async ({ data }: { data: AppendEventInput }) => {
        savedEvents.push(data);
        return { ...data, seq: savedEvents.length };
      }),
    },
    message: {
      create: vi.fn(async ({ data }: { data: unknown }) => ({
        ...(data as object),
        id: "message-1",
      })),
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(async () => null),
      findFirst: vi.fn(async () => null),
    },
    task: { findUniqueOrThrow: vi.fn(async () => ({ id: run.taskId, prompt: "Do the work" })) },
    computer: { updateMany: vi.fn(async () => ({ count: 1 })) },
    connection: { findMany: vi.fn(async () => []) },
    userModelPreference: { findFirst: vi.fn(async () => null) },
    secret: { findFirst: vi.fn(async () => null) },
    userModelCredential: { findFirst: vi.fn(async () => null) },
    spaceSettingOverride: { findUnique: vi.fn(async () => null) },
    userModelRoleChoice: { findMany: vi.fn(async () => []) },
    deploymentSettings: {
      findUnique: vi.fn(async () => ({
        defaultModelProvider: "openrouter",
        defaultModelId: "fixture-model",
      })),
    },
    taughtSkill: { findMany: vi.fn(async () => []) },
    agentSecret: { findMany: vi.fn(async () => []) },
    botSecret: { findMany: vi.fn(async () => []) },
    agentSkill: { findMany: vi.fn(async () => []) },
    botSkillPin: { findMany: vi.fn(async () => []) },
    scratchpadItem: { findMany: vi.fn(async () => []) },
    externalEffect: {
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "effect-1",
        ...data,
      })),
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    routine: {
      // A routine thread is the routine's own conversation (isOwnedRoutineThread).
      findFirst: vi.fn(async () => (options.routine === undefined ? routineRow : options.routine)),
      findUnique: vi.fn(async () => (options.routine === undefined ? routineRow : options.routine)),
      updateMany: vi.fn(async () => ({ count: 1 })),
      count: vi.fn(async () => 0),
    },
    computerExecutionLease: {
      updateManyAndReturn: vi.fn(async () => [{ fence: 1 }]),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    $queryRaw: vi.fn(async () => [{ id: "row-1", scope: "dedicated" }]),
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  });
  const finalizeRun = vi.fn(async () => ({
    continuationRunId: null,
    ...(options.taskReport ? { taskReport: options.taskReport } : {}),
  }));
  const enqueue = vi.fn(async () => undefined);
  const executor = createRunExecutor({
    deploymentModelKey: "fixture-model-key",
    contextStrategy: "retrieval",
    prisma,
    runtime: { describe: () => ({ capabilities: { scripted: false } }), run: runtimeRun },
    sandbox: {
      describe: () => ({ capabilities: { graphical: false } }),
      writeFile: vi.fn(async () => undefined),
      async *exportWorkspace() {
        yield* [];
      },
    },
    home: { commit: vi.fn(async () => "fixture-revision") },
    memory: { read: async () => ({ documents: [] }) },
    memoryProviders: { resolve: async () => null },
    events: {
      append: vi.fn(async (event: AppendEventInput) =>
        appendEventInTransaction(prisma as unknown as Prisma.TransactionClient, event),
      ),
      finalizeRun,
      pauseRunForInput: vi.fn(async () => ({ continuationRunId: null })),
      notify: vi.fn(async () => undefined),
    },
    jobs: { enqueue, cancel: vi.fn(async () => undefined) },
    secrets: [],
  } as unknown as Parameters<typeof createRunExecutor>[0]);
  await executor.continueRun(run.id, "worker-1");
  expect(runtimeRun).toHaveBeenCalled();
  const toolNames = (offered?.tools ?? []).map((tool) => tool.name);
  return { offered: offered!, toolNames, results, enqueue, finalizeRun, prisma };
}

describe("routine runs in their own conversation", () => {
  it("offers routine_report_failure to a routine run and ends it failed with the reason, keeping the reply", async () => {
    const reason = "The supplier site asked for a new login, so no price was checked.";
    const { toolNames, offered, results, finalizeRun } = await turn(ROUTINE, {
      trigger: "routine",
      clientNonce: "routine-timer:routine-1:2026-11-22T08:00:00.000Z",
      calls: [{ name: "routine_report_failure", args: { reason } }],
      reply: "I could not check the prices today.",
    });
    expect(toolNames).toContain("routine_report_failure");
    expect(offered.instructions).toContain("routine_report_failure");
    expect(results[0]).toEqual(expect.objectContaining({ ok: true }));
    expect(finalized(finalizeRun)).toEqual(
      expect.objectContaining({ outcome: "completed", reportedFailure: reason, quiet: false }),
    );
    expect((finalized(finalizeRun).blocks as unknown[]).length).toBeGreaterThan(0);
  });

  it("refuses an empty or over-long failure reason", async () => {
    const { results, finalizeRun } = await turn(ROUTINE, {
      trigger: "routine",
      calls: [
        { name: "routine_report_failure", args: { reason: "  " } },
        { name: "routine_report_failure", args: { reason: "x".repeat(501) } },
      ],
    });
    expect(results).toEqual([
      expect.objectContaining({ error: expect.any(String) }),
      expect.objectContaining({ error: expect.stringContaining("500") }),
    ]);
    expect(finalized(finalizeRun)).not.toHaveProperty("reportedFailure");
  });

  it("keeps routine_report_failure out of every other run and refuses it there", async () => {
    const { toolNames, offered, results } = await turn(MAIN, {
      routineId: null,
      calls: [{ name: "routine_report_failure", args: { reason: "Not a routine" } }],
    });
    expect(toolNames).not.toContain("routine_report_failure");
    expect(offered.instructions).not.toContain("routine_report_failure");
    expect(results[0]).toEqual(expect.objectContaining({ error: ROUTINE_FAILURE_SURFACE_ERROR }));
  });

  it("finishes a scheduled run with nothing new as a quiet run", async () => {
    const { offered, finalizeRun } = await turn(ROUTINE, {
      trigger: "routine",
      clientNonce: "routine-timer:routine-1:2026-11-22T08:00:00.000Z",
      reply: "NO_RESPONSE",
    });
    expect(offered.instructions).toContain(ROUTINE_SILENT_REPLY_GUIDANCE.slice(0, 60));
    expect(finalized(finalizeRun)).toEqual(
      expect.objectContaining({ outcome: "completed", blocks: [], quiet: true }),
    );
  });

  it.each([
    ["a Test or Run", "routine-test:abc"],
    ["a mention in chat", "routine-test:routine-mention:n1:routine-1"],
  ])("never lets %s end quiet", async (_label, clientNonce) => {
    const { offered, finalizeRun } = await turn(ROUTINE, {
      trigger: "routine",
      clientNonce,
      reply: "NO_RESPONSE",
    });
    expect(offered.instructions).not.toContain(ROUTINE_SILENT_REPLY_GUIDANCE.slice(0, 60));
    expect(finalized(finalizeRun)).toEqual(expect.objectContaining({ quiet: false }));
    expect((finalized(finalizeRun).blocks as unknown[]).length).toBeGreaterThan(0);
  });

  it("lets a local script run stay quiet", async () => {
    const { finalizeRun } = await turn(ROUTINE, {
      trigger: "routine",
      clientNonce: "routine-test:local:n2",
      reply: "NO_RESPONSE",
    });
    expect(finalized(finalizeRun)).toEqual(expect.objectContaining({ quiet: true }));
  });

  it("lets a run pause its own routine, records which run did, and never ends that run quiet", async () => {
    const { results, finalizeRun, prisma } = await turn(ROUTINE, {
      trigger: "routine",
      routine: routineRow,
      calls: [{ name: "schedule_update", args: { routineId: "routine-1", active: false } }],
      reply: "NO_RESPONSE",
    });
    expect(results[0]).toEqual(
      expect.objectContaining({ ok: true, active: false, pausedByThisRun: true }),
    );
    expect(prisma.routine.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          active: false,
          pausedByRunId: "run-1",
          pausedByRunAt: new Date("2026-11-22T08:00:00.000Z"),
        }),
      }),
    );
    expect(finalized(finalizeRun)).toEqual(expect.objectContaining({ quiet: false }));
  });

  it("allows a scheduled run to only pause its own routine with schedule_update", async () => {
    const { results, prisma } = await turn(ROUTINE, {
      trigger: "routine",
      routine: routineRow,
      calls: [
        { name: "schedule_update", args: { routineId: "routine-2", active: false } },
        { name: "schedule_update", args: { routineId: "routine-1", prompt: "Do something else" } },
        { name: "schedule_update", args: { routineId: "routine-1", active: true } },
      ],
    });
    expect(results).toEqual([
      expect.objectContaining({ error: ROUTINE_RUN_SCHEDULE_UPDATE_ERROR }),
      expect.objectContaining({ error: ROUTINE_RUN_SCHEDULE_UPDATE_ERROR }),
      expect.objectContaining({ error: ROUTINE_RUN_SCHEDULE_UPDATE_ERROR }),
    ]);
    expect(prisma.routine.updateMany).not.toHaveBeenCalled();
  });

  it("tells a scheduled run which routine it belongs to", async () => {
    const { offered } = await turn(ROUTINE, { trigger: "routine", routine: routineRow });
    expect(offered.prompt).toContain('routine "Price watch" (routineId routine-1)');
  });
});
