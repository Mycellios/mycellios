import { runContinueJob } from "@mycellios/adapter-kit";
import {
  AGENT_TASK_INPUT_ERROR,
  AGENT_TASK_LIMIT_ERROR,
  AGENT_TASK_NOT_AVAILABLE_ERROR,
  AGENT_TASK_QUEUE_ERROR,
  AGENT_TASK_STILL_RUNNING_ERROR,
} from "@mycellios/core";
import type { PrismaClient } from "@mycellios/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  startAgentTask: vi.fn(),
  messageAgentTask: vi.fn(),
  stopAgentTaskRuns: vi.fn(),
  archiveSideThreadInTransaction: vi.fn(),
  controlWorkTree: vi.fn(),
  isOwnedRoutineThread: vi.fn(),
}));
const teammate = vi.hoisted(() => ({ settle: vi.fn(), context: vi.fn() }));
const teardown = vi.hoisted(() => ({ reconcile: vi.fn() }));

vi.mock("@mycellios/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@mycellios/db")>()),
  ...db,
}));
vi.mock("./bot-messages.js", () => ({
  loadBotMessageContext: teammate.context,
  settleAgentTaskTeammateReply: teammate.settle,
}));
vi.mock("./work-stop-reconciler.js", () => ({ reconcileWorkStops: teardown.reconcile }));

const { AgentTaskError, ThreadLifecycleError } = await import("@mycellios/db");
const { agentTaskToolsAllowed, closeAgentTask, runAgentTaskTool } = await import("./agent-tasks.js");

const source = {
  id: "run-main",
  spaceId: "space",
  userId: "owner",
  botId: "mico",
  threadId: "main",
  leaseOwner: "worker",
  leaseFence: 1,
  trigger: "user",
  sourceMessageId: "message",
};
const bot = { id: "mico", name: "Mico" };

function harness() {
  const prisma = {
    task: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({})),
  };
  const deps = {
    prisma: prisma as unknown as PrismaClient,
    events: { notify: vi.fn().mockResolvedValue(undefined) },
    jobs: { enqueue: vi.fn().mockResolvedValue(undefined), cancel: vi.fn().mockResolvedValue(undefined) },
    sandbox: {},
  };
  return { deps: deps as unknown as Parameters<typeof runAgentTaskTool>[0], prisma, raw: deps };
}

beforeEach(() => {
  for (const mock of [...Object.values(db), teammate.settle, teammate.context, teardown.reconcile]) mock.mockReset();
  teammate.settle.mockResolvedValue("none");
  teardown.reconcile.mockResolvedValue(undefined);
});

describe("start_task", () => {
  it("refuses a missing title or brief before touching the database", async () => {
    const { deps } = harness();
    expect(await runAgentTaskTool(deps, source, bot, "start_task", { title: "", brief: "x" }, "key")).toEqual({ error: AGENT_TASK_INPUT_ERROR });
    expect(await runAgentTaskTool(deps, source, bot, "start_task", { title: "t".repeat(121), brief: "x" }, "key")).toEqual({ error: AGENT_TASK_INPUT_ERROR });
    expect(db.startAgentTask).not.toHaveBeenCalled();
  });

  it("queues the first turn and tells the model to end its turn", async () => {
    const { deps, raw } = harness();
    db.startAgentTask.mockResolvedValue({ taskId: "task-1", title: "Forum thread", replayed: false, runId: "run-task", eventSeq: 3 });
    const result = await runAgentTaskTool(deps, source, bot, "start_task", { title: " Forum thread ", brief: "Draft it" }, "effect-key");
    expect(db.startAgentTask).toHaveBeenCalledWith(raw.prisma, source, { key: "effect-key", title: "Forum thread", brief: "Draft it", botName: "Mico" });
    expect(raw.jobs.enqueue).toHaveBeenCalledWith(runContinueJob("run-task"));
    expect(raw.events.notify).toHaveBeenCalledWith("task-1", 3);
    expect(result).toMatchObject({ taskId: "task-1", title: "Forum thread", waitingForTasks: true });
    expect(String(result.note)).toContain("end your turn");
    expect(String(result.note)).not.toContain("request from");
  });

  it("returns the same task without a second turn on a replayed call", async () => {
    const { deps, raw } = harness();
    db.startAgentTask.mockResolvedValue({ taskId: "task-1", title: "T", replayed: true, runId: null, eventSeq: null });
    expect(await runAgentTaskTool(deps, source, bot, "start_task", { title: "T", brief: "b" }, "k")).toMatchObject({ taskId: "task-1" });
    expect(raw.jobs.enqueue).not.toHaveBeenCalled();
  });

  it("refuses a ninth unfinished task at once and nothing is queued", async () => {
    const { deps, raw } = harness();
    db.startAgentTask.mockRejectedValue(new AgentTaskError("limit", AGENT_TASK_LIMIT_ERROR));
    expect(await runAgentTaskTool(deps, source, bot, "start_task", { title: "T", brief: "b" }, "k")).toEqual({ error: AGENT_TASK_LIMIT_ERROR });
    expect(raw.jobs.enqueue).not.toHaveBeenCalled();
  });

  it("tells the model to do the work in this turn when the task cannot be stored", async () => {
    const { deps } = harness();
    db.startAgentTask.mockRejectedValue(new Error("database unavailable"));
    expect(await runAgentTaskTool(deps, source, bot, "start_task", { title: "T", brief: "b" }, "k")).toEqual({ error: AGENT_TASK_QUEUE_ERROR });
  });

  it("names the teammate whose request this turn answers", async () => {
    const { deps } = harness();
    db.startAgentTask.mockResolvedValue({ taskId: "task-1", title: "T", replayed: false, runId: "r", eventSeq: 1 });
    teammate.context.mockResolvedValue({ fromBotId: "scout", fromBotName: "Scout", intent: "request" });
    const result = await runAgentTaskTool(deps, { ...source, trigger: "bot_message" }, bot, "start_task", { title: "T", brief: "b" }, "k");
    expect(String(result.note)).toContain("request from Scout");
  });
});

describe("message_task", () => {
  it("reports whether the message runs now or after the current turn", async () => {
    const { deps, raw } = harness();
    db.messageAgentTask.mockResolvedValueOnce({ taskId: "task-1", state: "queued after the current turn", replayed: false, runId: null, eventSeq: 9 });
    expect(await runAgentTaskTool(deps, source, bot, "message_task", { taskId: "task-1", text: "Also check replies" }, "k1")).toMatchObject({ state: "queued after the current turn" });
    expect(raw.jobs.enqueue).not.toHaveBeenCalled();
    db.messageAgentTask.mockResolvedValueOnce({ taskId: "task-1", state: "sent", replayed: false, runId: "run-2", eventSeq: 10 });
    expect(await runAgentTaskTool(deps, source, bot, "message_task", { taskId: "task-1", text: "Continue" }, "k2")).toMatchObject({ state: "sent" });
    expect(raw.jobs.enqueue).toHaveBeenCalledWith(runContinueJob("run-2"));
  });

  it("answers not available for a conversation this Mico did not start", async () => {
    const { deps } = harness();
    db.messageAgentTask.mockRejectedValue(new AgentTaskError("not_available", AGENT_TASK_NOT_AVAILABLE_ERROR));
    expect(await runAgentTaskTool(deps, source, bot, "message_task", { taskId: "user-thread", text: "hi" }, "k")).toEqual({ error: AGENT_TASK_NOT_AVAILABLE_ERROR });
    expect(await runAgentTaskTool(deps, source, bot, "message_task", { taskId: "", text: "hi" }, "k")).toEqual({ error: AGENT_TASK_NOT_AVAILABLE_ERROR });
  });
});

describe("close_task", () => {
  it("stops the runs, tears their work down, archives and answers a waiting teammate", async () => {
    const { deps, raw } = harness();
    db.stopAgentTaskRuns.mockResolvedValue({ runIds: ["run-task"], teardownTaskIds: ["turn-task"], eventSeq: 4, startedByRunId: "request-run" });
    db.archiveSideThreadInTransaction.mockResolvedValue({ archivedAt: new Date() });
    const result = await runAgentTaskTool(deps, source, bot, "close_task", { taskId: "task-1" }, "k");
    expect(result).toMatchObject({ taskId: "task-1", closed: true });
    expect(teardown.reconcile).toHaveBeenCalledWith(expect.anything(), { spaceId: "space", userId: "owner", taskIds: ["turn-task"] });
    expect(raw.jobs.cancel).toHaveBeenCalledOnce();
    expect(db.archiveSideThreadInTransaction).toHaveBeenCalledWith({}, { spaceId: "space", userId: "owner" }, { botId: "mico", threadId: "task-1" });
    expect(teammate.settle).toHaveBeenCalledWith(deps, "request-run");
  });

  it("keeps stopping new work and fails clearly when the task still runs after the settle window", async () => {
    const { deps } = harness();
    db.stopAgentTaskRuns.mockResolvedValue({ runIds: [], teardownTaskIds: [], eventSeq: null, startedByRunId: null });
    db.archiveSideThreadInTransaction.mockRejectedValue(new ThreadLifecycleError("busy", "busy"));
    let clock = 0;
    const result = await closeAgentTask(deps, source, "task-1", { settleMs: 1_000, pollMs: 400, now: () => clock, sleep: async (ms) => { clock += ms; } });
    expect(result).toEqual({ error: AGENT_TASK_STILL_RUNNING_ERROR });
    expect(db.stopAgentTaskRuns.mock.calls.length).toBeGreaterThan(1);
    expect(teammate.settle).not.toHaveBeenCalled();
  });

  it("does not archive while computer teardown is still pending", async () => {
    const { deps } = harness();
    db.stopAgentTaskRuns.mockResolvedValue({ runIds: ["r"], teardownTaskIds: ["t"], eventSeq: 1, startedByRunId: null });
    teardown.reconcile.mockRejectedValue(new Error("teardown pending"));
    let clock = 0;
    const result = await closeAgentTask(deps, source, "task-1", { settleMs: 500, pollMs: 500, now: () => clock, sleep: async (ms) => { clock += ms; } });
    expect(result).toEqual({ error: AGENT_TASK_STILL_RUNNING_ERROR });
    expect(db.archiveSideThreadInTransaction).not.toHaveBeenCalled();
  });

  it("answers not available for another conversation", async () => {
    const { deps } = harness();
    db.stopAgentTaskRuns.mockRejectedValue(new AgentTaskError("not_available", AGENT_TASK_NOT_AVAILABLE_ERROR));
    expect(await runAgentTaskTool(deps, source, bot, "close_task", { taskId: "routine-thread" }, "k")).toEqual({ error: AGENT_TASK_NOT_AVAILABLE_ERROR });
  });
});

describe("where tasks can be started", () => {
  const prisma = {} as PrismaClient;
  const run = { spaceId: "space", userId: "owner", botId: "mico", trigger: "user" };
  const main = { id: "main", botId: "mico", groupId: null, externalConversationId: null, taskBotId: null, projectKey: null, taskKey: null };
  const options = { messagingChannelRun: false, backgroundRun: false };

  it("allows the Mico's own main chat and its owned routine conversations", async () => {
    expect(await agentTaskToolsAllowed(prisma, run, main, options)).toBe(true);
    db.isOwnedRoutineThread.mockResolvedValue(true);
    const routine = { ...main, id: "r", botId: null, taskBotId: "mico", projectKey: "routine:x", taskKey: "routine:x" };
    expect(await agentTaskToolsAllowed(prisma, { ...run, trigger: "routine" }, routine, options)).toBe(true);
    db.isOwnedRoutineThread.mockResolvedValue(false);
    expect(await agentTaskToolsAllowed(prisma, { ...run, trigger: "routine" }, routine, options)).toBe(false);
  });

  it.each([
    ["a side conversation", { ...main, id: "side", botId: null, taskBotId: "mico", projectKey: "mico:mico", taskKey: "mico-task:mico:agent:k" }, options, "user"],
    ["a group", { ...main, botId: null, groupId: "group" }, options, "user"],
    ["an outside messaging chat", { ...main, botId: null, externalConversationId: "chat" }, options, "messaging"],
    ["a messaging channel turn in the main chat", main, { ...options, messagingChannelRun: true }, "messaging"],
    ["background work", main, { ...options, backgroundRun: true }, "tickets"],
    ["the creation intro", main, options, "created"],
    ["another Mico's main chat", { ...main, botId: "other" }, options, "user"],
  ])("refuses %s", async (_label, thread, flags, trigger) => {
    expect(await agentTaskToolsAllowed(prisma, { ...run, trigger }, thread, flags)).toBe(false);
  });
});
