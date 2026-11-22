import type { AgentRunRequest } from "@mycellios/adapter-kit";
import { runContinueJob } from "@mycellios/adapter-kit";
import {
  AGENT_TASK_NOT_AVAILABLE_ERROR,
  AGENT_TASK_SURFACE_ERROR,
  AGENT_TASK_WAIT_REFUSAL,
} from "@mycellios/core";
import type { AppendEventInput, Prisma } from "@mycellios/db";
import { appendEventInTransaction } from "@mycellios/db";
import { describe, expect, it, vi } from "vitest";
import type * as ComputerLifecycleModule from "./computer-lifecycle.js";
import { createRunExecutor } from "./executor.js";
import { AGENT_TASK_GUIDANCE, TASK_CONVERSATION_INSTRUCTIONS } from "./mico-behavior.js";

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

const MAIN: ThreadShape = { id: "main", botId: "bot-1", taskBotId: null, startedBy: null, projectKey: null, taskKey: null };
const AGENT_TASK: ThreadShape = {
  id: "task-thread",
  botId: null,
  taskBotId: "bot-1",
  startedBy: "agent",
  projectKey: "mico:bot-1",
  taskKey: "mico-task:bot-1:agent:key",
};

/** One turn with a fake runtime that may call tools; returns what the runtime was offered. */
async function turn(
  thread: ThreadShape,
  options: {
    trigger?: string;
    calls?: Array<{ name: string; args: Record<string, unknown> }>;
    taskReport?: { runId: string; threadId: string; seq: number };
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
    sourceMessageId: "source-1",
    clientNonce: null,
    leaseFence: 0,
  };
  const results: unknown[] = [];
  let offered: AgentRunRequest | undefined;
  const runtimeRun = vi.fn(async function* (request: AgentRunRequest) {
    offered = request;
    for (const [index, call] of (options.calls ?? []).entries())
      results.push(await request.executeTool!(call.name, call.args, `call-${index}`).catch((error: unknown) => ({ thrown: String(error) })));
    yield { type: "text" as const, text: "Done." };
    yield { type: "done" as const, text: "Done." };
  });
  const savedEvents: AppendEventInput[] = [];
  // Models this fixture does not describe read as empty (approval rules, preferences, ...).
  const empty = { findMany: async () => [], findFirst: async () => null, findUnique: async () => null, count: async () => 0 };
  const withEmptyModels = <T extends object>(models: T): T =>
    new Proxy(models, {
      get: (target, key) =>
        key in target || typeof key !== "string" || key.startsWith("$") || key === "then"
          ? Reflect.get(target, key)
          : empty,
    });
  const prisma = withEmptyModels({
    user: { findUniqueOrThrow: async () => ({ micoDefaults: {} }), findUnique: vi.fn(async () => null) },
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
      create: vi.fn(async ({ data }: { data: unknown }) => ({ ...(data as object), id: "message-1" })),
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
      findUnique: vi.fn(async () => ({ defaultModelProvider: "openrouter", defaultModelId: "fixture-model" })),
    },
    taughtSkill: { findMany: vi.fn(async () => []) },
    agentSecret: { findMany: vi.fn(async () => []) },
    botSecret: { findMany: vi.fn(async () => []) },
    agentSkill: { findMany: vi.fn(async () => []) },
    botSkillPin: { findMany: vi.fn(async () => []) },
    scratchpadItem: { findMany: vi.fn(async () => []) },
    externalEffect: { findMany: vi.fn(async () => []) },
    routine: { findFirst: vi.fn(async () => null) },
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
  return { offered: offered!, toolNames, results, enqueue, finalizeRun };
}

describe("tasks a Mico opens itself", () => {
  it("offers start_task, message_task and close_task with their guidance in the Mico's main chat", async () => {
    const { toolNames, offered } = await turn(MAIN);
    expect(toolNames).toEqual(expect.arrayContaining(["start_task", "message_task", "close_task"]));
    expect(offered.instructions).toContain(AGENT_TASK_GUIDANCE);
    expect(offered.instructions).not.toContain(TASK_CONVERSATION_INSTRUCTIONS);
  });

  it("keeps task tools and waits out of a conversation the Mico opened and refuses them clearly", async () => {
    const { toolNames, offered, results } = await turn(AGENT_TASK, {
      trigger: "agent_task",
      calls: [
        { name: "start_task", args: { title: "Nested", brief: "Do more" } },
        { name: "close_task", args: { taskId: "task-thread" } },
        { name: "await_event", args: { note: "later", resume_at: "2099-01-01T00:00:00Z" } },
      ],
    });
    expect(toolNames).not.toContain("start_task");
    expect(toolNames).not.toContain("message_task");
    expect(toolNames).not.toContain("close_task");
    expect(toolNames).not.toContain("await_event");
    expect(offered.instructions).toContain(TASK_CONVERSATION_INSTRUCTIONS);
    expect(offered.instructions).not.toContain(AGENT_TASK_GUIDANCE);
    expect(results).toEqual([
      expect.objectContaining({ error: AGENT_TASK_SURFACE_ERROR }),
      expect.objectContaining({ error: AGENT_TASK_SURFACE_ERROR }),
      expect.objectContaining({ error: AGENT_TASK_WAIT_REFUSAL }),
    ]);
  });

  it("gives every side conversation the shared-files rules", async () => {
    const person = { ...AGENT_TASK, id: "person-thread", startedBy: "user", taskKey: "mico-task:bot-1:person" };
    const { toolNames, offered } = await turn(person);
    expect(toolNames).not.toContain("start_task");
    expect(toolNames).toContain("await_event");
    expect(offered.instructions).toContain("read a file again right before you change it");
  });

  it("refuses to read a conversation this Mico did not open by taskId", async () => {
    const { results } = await turn(MAIN, { calls: [{ name: "read_history", args: { taskId: "someone-elses" } }] });
    expect(results[0]).toEqual(expect.objectContaining({ error: AGENT_TASK_NOT_AVAILABLE_ERROR }));
  });

  it("starts the report turn a finished task turn queued in the main chat", async () => {
    const { enqueue } = await turn(AGENT_TASK, {
      trigger: "agent_task",
      taskReport: { runId: "report-run", threadId: "main", seq: 4 },
    });
    expect(enqueue).toHaveBeenCalledWith(runContinueJob("report-run"));
  });
});
