import type { MessageBlock, TaskReportOutcome } from "@mycellios/contracts";
import {
  ACTIVE_RUN_STATUSES,
  AGENT_TASK_LIMIT_ERROR,
  AGENT_TASK_NOT_AVAILABLE_ERROR,
  AGENT_TASK_UNFINISHED_LIMIT,
  agentTaskBriefPrompt,
  agentTaskMessageNonce,
  agentTaskMessagePrompt,
  agentTaskStartNonce,
  agentTaskThreadKey,
  botMessageContext,
  isInterruptedRunError,
  isTaskReportNonce,
  TASK_REPORT_RUNNING_LIST_MAX,
  TASK_REPORT_VISUAL_LIMIT,
  TASK_REPORTING_TRIGGERS,
  taskAnswerText,
  taskReportNonce,
  taskReportPrompt,
  taskReportText,
  taskReportVisualBlocks,
} from "@mycellios/core";
import { cancelRunsInTransaction } from "./cancel-runs.js";
import { Prisma, type PrismaClient } from "./client.js";
import { appendEventInTransaction } from "./events.js";
import { INTERRUPTED_TURN_RECOVERY_DELAYS_MS, INTERRUPTED_TURN_RECOVERY_NOTE, WORK_RECOVERY_MARKER } from "./event-waits.js";
import { createThreadMessageInTransaction } from "./messages.js";
import { recordThreadTurnOutcome, reopenSideThreadForSend } from "./thread-lifecycle.js";
import { withTransactionRetry } from "./transaction-retry.js";

/**
 * Conversations a Mico opens for itself (start_task), the messages it sends them
 * (message_task), closing them (close_task) and the report each finished turn sends back to
 * the Mico's main chat. Every write is scoped to the owner, Space and Mico of the source run.
 */

type Scope = { spaceId: string; userId: string };
/** The executing run that calls a task tool, fenced by its lease like other work tools. */
export type AgentTaskSource = Scope & {
  id: string;
  botId: string;
  threadId: string;
  leaseOwner: string;
  leaseFence: number;
};
type Tx = Prisma.TransactionClient;

/** A refusal the model reads as the tool result. */
export class AgentTaskError extends Error {
  constructor(
    readonly code: "limit" | "not_available" | "source",
    message: string,
  ) {
    super(message);
    this.name = "AgentTaskError";
  }
}

const ACTIVE = Prisma.join([...ACTIVE_RUN_STATUSES]);
const UNFINISHED_WORK = Prisma.join(["queued", "running", "waiting", "waiting_event"]);
const TX_OPTIONS = { maxWait: 5_000, timeout: 20_000 };

/** One Mico's task starts and messages are counted under one lock, so the limit holds across workers. */
async function lockMicoTasks(tx: Pick<Tx, "$queryRaw">, botId: string) {
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`agent-tasks:${botId}`}, 0))`;
}

async function assertSourceOwnsLease(tx: Tx, source: AgentTaskSource) {
  await tx.$queryRaw`SELECT id FROM runs WHERE id = ${source.id} AND "spaceId" = ${source.spaceId} AND "userId" = ${source.userId} FOR UPDATE`;
  const run = await tx.run.findFirst({
    where: {
      id: source.id,
      botId: source.botId,
      threadId: source.threadId,
      spaceId: source.spaceId,
      userId: source.userId,
      status: "running",
      leaseOwner: source.leaseOwner,
      leaseFence: source.leaseFence,
    },
    select: { id: true },
  });
  if (!run) throw new AgentTaskError("source", "This turn no longer owns its work; nothing was changed.");
}

/** Conversations this Mico opened that are still working, waiting for the person or queued. */
export async function countUnfinishedAgentTasks(
  tx: Pick<Tx, "$queryRaw">,
  scope: Scope & { botId: string },
  exceptThreadId?: string,
): Promise<number> {
  const [row] = await tx.$queryRaw<Array<{ count: number }>>`
    SELECT count(*)::int AS count FROM threads t
    WHERE t."taskBotId" = ${scope.botId} AND t."spaceId" = ${scope.spaceId} AND t."userId" = ${scope.userId}
      AND t."startedBy" = 'agent' AND t."deleteAfter" IS NULL
      ${exceptThreadId ? Prisma.sql`AND t.id <> ${exceptThreadId}` : Prisma.empty}
      AND (EXISTS (SELECT 1 FROM runs r WHERE r."threadId" = t.id AND r.status IN (${ACTIVE}))
        OR EXISTS (SELECT 1 FROM tasks k WHERE k."threadId" = t.id AND k."delegationState" IN (${UNFINISHED_WORK})))`;
  return row?.count ?? 0;
}

/** The other unfinished tasks a report names, newest first. */
async function stillRunningAgentTasks(tx: Pick<Tx, "$queryRaw">, scope: Scope & { botId: string }, exceptThreadId: string) {
  return tx.$queryRaw<Array<{ taskId: string; title: string | null }>>`
    SELECT t.id AS "taskId", t.title FROM threads t
    WHERE t."taskBotId" = ${scope.botId} AND t."spaceId" = ${scope.spaceId} AND t."userId" = ${scope.userId}
      AND t."startedBy" = 'agent' AND t."deleteAfter" IS NULL AND t.id <> ${exceptThreadId}
      AND EXISTS (SELECT 1 FROM runs r WHERE r."threadId" = t.id AND r.status IN (${ACTIVE}))
    ORDER BY t."createdAt" DESC
    LIMIT ${TASK_REPORT_RUNNING_LIST_MAX}`;
}

export interface StartAgentTaskResult {
  taskId: string;
  title: string;
  replayed: boolean;
  /** The queued first turn, absent on a replay. */
  runId: string | null;
  eventSeq: number | null;
}

/**
 * Opens a conversation of the Mico's own, writes the brief as its first message and queues
 * its first turn. The tool call's effect key names the thread, so a retried call returns the
 * same task. Refuses a ninth unfinished task. Nothing is created when the transaction fails.
 */
export async function startAgentTask(
  prisma: PrismaClient,
  source: AgentTaskSource,
  input: { key: string; title: string; brief: string; botName: string },
): Promise<StartAgentTaskResult> {
  if (!input.key) throw new Error("A task start needs an idempotency key");
  const taskKey = agentTaskThreadKey(source.botId, input.key);
  return withTransactionRetry(() =>
    prisma.$transaction(async (tx) => {
      await lockMicoTasks(tx, source.botId);
      const existing = await tx.thread.findFirst({
        where: { spaceId: source.spaceId, userId: source.userId, taskKey, taskBotId: source.botId },
        select: { id: true, title: true },
      });
      if (existing)
        return { taskId: existing.id, title: existing.title ?? input.title, replayed: true, runId: null, eventSeq: null };
      await assertSourceOwnsLease(tx, source);
      const bot = await tx.bot.findFirst({
        where: { id: source.botId, spaceId: source.spaceId, userId: source.userId, archivedAt: null },
        select: { id: true },
      });
      if (!bot) throw new AgentTaskError("source", "This Mico is no longer available.");
      if ((await countUnfinishedAgentTasks(tx, source)) >= AGENT_TASK_UNFINISHED_LIMIT)
        throw new AgentTaskError("limit", AGENT_TASK_LIMIT_ERROR);
      const thread = await tx.thread.create({
        data: {
          spaceId: source.spaceId,
          userId: source.userId,
          taskBotId: source.botId,
          projectKey: `mico:${source.botId}`,
          taskKey,
          title: input.title,
          titleSource: "agent",
          startedBy: "agent",
          startedByRunId: source.id,
        },
        // Naming the Space and owner lets content encryption seal the brief below before
        // this transaction commits; with only the id it cannot see the new conversation.
        select: { id: true, spaceId: true, userId: true },
      });
      const nonce = agentTaskStartNonce(thread.id);
      const blocks: MessageBlock[] = [
        { kind: "task_brief", fromBotId: source.botId, fromBotName: input.botName, text: input.brief },
      ];
      const queued = await queueAgentTaskTurn(tx, source, {
        threadId: thread.id,
        blocks,
        nonce,
        prompt: agentTaskBriefPrompt({ title: input.title, brief: input.brief }),
      });
      return { taskId: thread.id, title: input.title, replayed: false, runId: queued.runId, eventSeq: queued.eventSeq };
    }, TX_OPTIONS),
  );
}

async function queueAgentTaskTurn(
  tx: Tx,
  scope: Scope & { botId: string },
  input: { threadId: string; blocks: MessageBlock[]; nonce: string; prompt: string },
) {
  const message = await createThreadMessageInTransaction(tx, {
    threadId: input.threadId,
    role: "user",
    blocks: input.blocks,
    clientNonce: input.nonce,
  });
  const task = await tx.task.create({
    data: {
      spaceId: scope.spaceId,
      userId: scope.userId,
      botId: scope.botId,
      threadId: input.threadId,
      prompt: input.prompt,
      status: "queued",
    },
    select: { id: true },
  });
  const run = await tx.run.create({
    data: {
      spaceId: scope.spaceId,
      userId: scope.userId,
      botId: scope.botId,
      threadId: input.threadId,
      taskId: task.id,
      status: "queued",
      trigger: "agent_task",
      sourceMessageId: message.id,
      clientNonce: input.nonce,
    },
    select: { id: true },
  });
  await tx.message.update({ where: { id: message.id }, data: { runId: run.id } });
  const event = await appendEventInTransaction(tx, {
    spaceId: scope.spaceId,
    threadId: input.threadId,
    botId: scope.botId,
    type: "thread.message.created",
    runId: run.id,
    payload: { messageId: message.id, role: "user", blocks: input.blocks },
  });
  return { runId: run.id, eventSeq: event.seq };
}

interface OwnedAgentTask {
  id: string;
  title: string | null;
  archivedAt: Date | null;
  startedByRunId: string | null;
}

/**
 * Locks a conversation this Mico opened itself. Threads the person opened, routine and
 * delegated threads, other Micos' threads and conversations being deleted are not available.
 */
export async function lockOwnedAgentTask(
  tx: Pick<Tx, "$queryRaw">,
  scope: Scope & { botId: string },
  taskId: string,
): Promise<OwnedAgentTask> {
  const [row] = await tx.$queryRaw<Array<OwnedAgentTask & { taskBotId: string | null; startedBy: string | null; deleteAfter: Date | null }>>`
    SELECT id, title, "archivedAt", "startedByRunId", "taskBotId", "startedBy", "deleteAfter" FROM threads
    WHERE id = ${taskId} AND "spaceId" = ${scope.spaceId} AND "userId" = ${scope.userId}
    FOR UPDATE`;
  if (!row || row.taskBotId !== scope.botId || row.startedBy !== "agent" || row.deleteAfter)
    throw new AgentTaskError("not_available", AGENT_TASK_NOT_AVAILABLE_ERROR);
  return { id: row.id, title: row.title, archivedAt: row.archivedAt, startedByRunId: row.startedByRunId };
}

/** Read-only check used by history tools: true only for a conversation this Mico opened. */
export async function isOwnedAgentTask(
  prisma: Pick<PrismaClient, "thread">,
  scope: Scope & { botId: string },
  taskId: string,
): Promise<boolean> {
  return Boolean(
    await prisma.thread.findFirst({
      where: { id: taskId, spaceId: scope.spaceId, userId: scope.userId, taskBotId: scope.botId, startedBy: "agent", deleteAfter: null },
      select: { id: true },
    }),
  );
}

export type AgentTaskMessageState = "queued after the current turn" | "sent";

/**
 * Writes a follow-up from the main chat into a task. It runs after the task's current turn
 * (a queued steering row), or starts a turn now when the task is idle. An archived task is
 * reopened in the same transaction. Refused when the task is idle and eight others are
 * unfinished. The tool call's key makes a retry a replay.
 */
export async function messageAgentTask(
  prisma: PrismaClient,
  source: AgentTaskSource,
  input: { key: string; taskId: string; text: string; botName: string },
): Promise<{ taskId: string; state: AgentTaskMessageState; replayed: boolean; runId: string | null; eventSeq: number | null }> {
  if (!input.key) throw new Error("A task message needs an idempotency key");
  const nonce = agentTaskMessageNonce(input.key);
  return withTransactionRetry(() =>
    prisma.$transaction(async (tx) => {
      await lockMicoTasks(tx, source.botId);
      const thread = await lockOwnedAgentTask(tx, source, input.taskId);
      const already = await tx.message.findUnique({
        where: { threadId_clientNonce: { threadId: thread.id, clientNonce: nonce } },
        select: { id: true, runId: true },
      });
      if (already)
        return { taskId: thread.id, state: already.runId ? ("sent" as const) : ("queued after the current turn" as const), replayed: true, runId: null, eventSeq: null };
      await assertSourceOwnsLease(tx, source);
      const active = await tx.run.findFirst({
        where: { threadId: thread.id, status: { in: [...ACTIVE_RUN_STATUSES] } },
        select: { id: true },
      });
      if (!active && (await countUnfinishedAgentTasks(tx, source, thread.id)) >= AGENT_TASK_UNFINISHED_LIMIT)
        throw new AgentTaskError("limit", AGENT_TASK_LIMIT_ERROR);
      await reopenSideThreadForSend(tx, source, thread.id);
      const blocks: MessageBlock[] = [
        { kind: "task_brief", fromBotId: source.botId, fromBotName: input.botName, text: input.text },
      ];
      if (!active) {
        const queued = await queueAgentTaskTurn(tx, source, {
          threadId: thread.id,
          blocks,
          nonce,
          prompt: agentTaskMessagePrompt([input.text]),
        });
        return { taskId: thread.id, state: "sent" as const, replayed: false, runId: queued.runId, eventSeq: queued.eventSeq };
      }
      const message = await createThreadMessageInTransaction(tx, {
        threadId: thread.id,
        role: "user",
        blocks,
        clientNonce: nonce,
      });
      // Never claimed as mid-turn steering: the continuation after this turn answers it.
      await tx.steeringMessage.create({
        data: { messageId: message.id, botId: source.botId, userId: source.userId, originTrigger: "agent_task" },
      });
      const event = await appendEventInTransaction(tx, {
        spaceId: source.spaceId,
        threadId: thread.id,
        botId: source.botId,
        type: "thread.message.created",
        payload: { messageId: message.id, role: "user", blocks },
      });
      return { taskId: thread.id, state: "queued after the current turn" as const, replayed: false, runId: null, eventSeq: event.seq };
    }, TX_OPTIONS),
  );
}

/** Work tree teardown receipts for runs a close cancelled; reconcileWorkStops finishes them. */
type TeardownTarget = {
  runId: string;
  botId: string;
  computerId: string;
  fence: number;
  kind: string;
  providerRef: string | null;
  homeKey: string;
};

/**
 * The stop half of close_task: under the thread lock, drop the task's queued messages,
 * cancel its runs and record their computer teardown in the durable work-stop outbox.
 * A close by the Mico itself sends no report. Returns the cancelled runs and their Tasks.
 */
export async function stopAgentTaskRuns(
  prisma: PrismaClient,
  source: Scope & { botId: string },
  taskId: string,
): Promise<{ runIds: string[]; teardownTaskIds: string[]; eventSeq: number | null; startedByRunId: string | null }> {
  return withTransactionRetry(() =>
    prisma.$transaction(async (tx) => {
      const thread = await lockOwnedAgentTask(tx, source, taskId);
      await tx.steeringMessage.deleteMany({ where: { message: { threadId: thread.id } } });
      const runs = await tx.run.findMany({
        where: { threadId: thread.id, spaceId: source.spaceId, userId: source.userId, status: { in: [...ACTIVE_RUN_STATUSES] } },
        select: { id: true, taskId: true, userId: true, spaceId: true, botId: true },
      });
      if (!runs.length)
        return { runIds: [], teardownTaskIds: [], eventSeq: null, startedByRunId: thread.startedByRunId };
      const runIds = runs.map((run) => run.id);
      const leases = await tx.computerExecutionLease.findMany({
        where: { runId: { in: runIds } },
        include: { computer: true },
      });
      const targets: TeardownTarget[] = leases.map((lease) => ({
        runId: lease.runId,
        botId: lease.botId,
        computerId: lease.computerId,
        fence: lease.fence,
        kind: lease.computer.kind,
        providerRef: lease.computer.providerRef,
        homeKey: lease.computer.homeKey,
      }));
      await cancelRunsInTransaction(tx, runs, new Date());
      await recordThreadTurnOutcome(tx, { threadId: thread.id, runIds, outcome: "interrupted" });
      let eventSeq: number | null = null;
      for (const run of runs) {
        const event = await appendEventInTransaction(tx, {
          spaceId: source.spaceId,
          threadId: thread.id,
          botId: run.botId,
          runId: run.id,
          type: "run.cancelled",
          payload: { reason: "task_closed" },
        });
        eventSeq = event.seq;
      }
      await tx.event.deleteMany({ where: { type: "thread.progress", runId: { in: runIds } } });
      const byTask = new Map<string, string[]>();
      for (const run of runs) byTask.set(run.taskId, [...(byTask.get(run.taskId) ?? []), run.id]);
      for (const [id, ids] of byTask) {
        await tx.task.update({
          where: { id },
          data: {
            workStopPending: true,
            workStopTargets: {
              runIds: ids,
              targets: targets.filter((target) => ids.includes(target.runId)),
            } as Prisma.InputJsonValue,
          },
        });
      }
      return { runIds, teardownTaskIds: [...byTask.keys()], eventSeq, startedByRunId: thread.startedByRunId };
    }, TX_OPTIONS),
  );
}

/** A teammate's request a task belongs to, while that request still waits for its reply. */
export async function pendingTeammateRequest(
  tx: Pick<Tx, "run">,
  requestRunId: string | null | undefined,
): Promise<{ fromBotId: string; fromBotName: string } | null> {
  if (!requestRunId) return null;
  const run = await tx.run.findUnique({
    where: { id: requestRunId },
    select: { trigger: true, botOutcomeReturnedAt: true, sourceMessage: { select: { blocks: true } } },
  });
  if (run?.trigger !== "bot_message" || run.botOutcomeReturnedAt) return null;
  const blocks = Array.isArray(run.sourceMessage?.blocks) ? (run.sourceMessage.blocks as MessageBlock[]) : [];
  const context = botMessageContext(blocks);
  const intent = context?.intent ?? "request";
  if (!context || (intent !== "request" && intent !== "question")) return null;
  return { fromBotId: context.fromBotId, fromBotName: context.fromBotName };
}

export interface QueuedTaskReport {
  runId: string;
  threadId: string;
  seq: number;
}

/**
 * When a turn of a conversation the Mico opened ends, queue its report in the Mico's main
 * chat as an incoming message that starts a main-chat turn, inside the transaction that ends
 * the turn. Skipped for a silent turn, a turn the person started there that no teammate waits
 * on, a turn that only parked while delegated work runs, and a conversation being deleted.
 * One report per turn: the message and run share the nonce task-report:<thread>:<run>.
 */
export async function queueTaskReportInTransaction(
  tx: Tx,
  input: {
    threadId: string;
    runIds: readonly string[];
    outcome: TaskReportOutcome;
    /** The turn's final answer, when the caller already has it. */
    answer?: string;
    error?: string | null;
  },
): Promise<QueuedTaskReport | null> {
  if (!input.runIds.length) return null;
  // Every turn end passes here; most threads are not task conversations and stop at this read.
  const rows = await tx.$queryRaw<
    Array<{
      id: string;
      spaceId: string;
      userId: string;
      taskBotId: string | null;
      startedBy: string | null;
      startedByRunId: string | null;
      title: string | null;
      deleteAfter: Date | null;
    }>
  >`SELECT id, "spaceId", "userId", "taskBotId", "startedBy", "startedByRunId", title, "deleteAfter"
    FROM threads WHERE id = ${input.threadId}`;
  const thread = rows?.[0];
  if (!thread?.taskBotId || thread.startedBy !== "agent" || thread.deleteAfter) return null;
  const runs = await tx.run.findMany({
    where: { id: { in: [...input.runIds] }, threadId: thread.id, botId: thread.taskBotId },
    select: { id: true, trigger: true, startedAt: true, createdAt: true, task: { select: { delegationState: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  // A stop can cancel a running turn and a queued one; the turn that had started reports.
  const run = runs.find((candidate) => candidate.startedAt) ?? runs[0];
  if (!run) return null;
  if (run.task.delegationState === "waiting" || run.task.delegationState === "waiting_event") return null;
  const teammate = await pendingTeammateRequest(tx, thread.startedByRunId);
  if (!(TASK_REPORTING_TRIGGERS as readonly string[]).includes(run.trigger) && !teammate) return null;
  const turnMessages = await tx.message.findMany({
    where: { threadId: thread.id, runId: run.id, role: "bot" },
    select: { blocks: true },
    orderBy: { seq: "asc" },
  });
  const blocksOf = (message: { blocks: Prisma.JsonValue }) =>
    Array.isArray(message.blocks) ? (message.blocks as MessageBlock[]) : [];
  const turnBlocks = turnMessages.flatMap(blocksOf);
  // The turn's answer is its last message with text; earlier ones are progress notes.
  const answer =
    input.answer?.trim() ||
    turnMessages
      .map((message) => taskAnswerText(blocksOf(message)))
      .findLast((text) => text.length > 0) ||
    "";
  // An explicit silent turn has nothing to tell the main chat.
  if (input.outcome === "completed" && !answer) return null;
  const bot = await tx.bot.findFirst({
    where: { id: thread.taskBotId, spaceId: thread.spaceId, userId: thread.userId, archivedAt: null },
    select: { name: true, thread: { select: { id: true } } },
  });
  const mainThreadId = bot?.thread?.id;
  if (!bot || !mainThreadId) return null;
  const nonce = taskReportNonce(thread.id, run.id);
  const existing = await tx.message.findUnique({
    where: { threadId_clientNonce: { threadId: mainThreadId, clientNonce: nonce } },
    select: { id: true },
  });
  if (existing) return null;
  const title = thread.title?.trim() || "Task";
  const report = taskReportText({ outcome: input.outcome, answer, error: input.error, title });
  const taskBotId = thread.taskBotId;
  const stillRunning = (await stillRunningAgentTasks(tx, { spaceId: thread.spaceId, userId: thread.userId, botId: taskBotId }, thread.id)).map(
    (task) => ({ taskId: task.taskId, title: task.title?.trim() || "Task" }),
  );
  const visuals = taskReportVisualBlocks(turnBlocks).slice(0, TASK_REPORT_VISUAL_LIMIT);
  const blocks: MessageBlock[] = [
    {
      kind: "task_report",
      fromBotId: thread.taskBotId,
      fromBotName: bot.name,
      taskId: thread.id,
      title,
      outcome: input.outcome,
      text: report.text,
      ...(report.truncated ? { truncated: true as const } : {}),
    },
    ...visuals,
  ];
  const message = await createThreadMessageInTransaction(tx, {
    threadId: mainThreadId,
    role: "user",
    blocks,
    clientNonce: nonce,
  });
  const task = await tx.task.create({
    data: {
      spaceId: thread.spaceId,
      userId: thread.userId,
      botId: thread.taskBotId,
      threadId: mainThreadId,
      prompt: taskReportPrompt({
        taskId: thread.id,
        title,
        outcome: input.outcome,
        text: report.text,
        truncated: report.truncated,
        stillRunning,
        teammateName: teammate?.fromBotName ?? null,
      }),
      status: "queued",
    },
    select: { id: true },
  });
  const reportRun = await tx.run.create({
    data: {
      spaceId: thread.spaceId,
      userId: thread.userId,
      botId: thread.taskBotId,
      threadId: mainThreadId,
      taskId: task.id,
      status: "queued",
      trigger: "task_report",
      sourceMessageId: message.id,
      clientNonce: nonce,
    },
    select: { id: true },
  });
  await tx.message.update({ where: { id: message.id }, data: { runId: reportRun.id } });
  const event = await appendEventInTransaction(tx, {
    spaceId: thread.spaceId,
    threadId: mainThreadId,
    botId: thread.taskBotId,
    type: "thread.message.created",
    runId: reportRun.id,
    payload: { messageId: message.id, role: "user", blocks },
  });
  return { runId: reportRun.id, threadId: mainThreadId, seq: event.seq };
}

const TASK_REPORT_RECOVERY_SEPARATOR = ":recovery:";

/**
 * A report turn that an update or a lost PC connection cut off starts again from the commit
 * that ends it: a fresh run on the same report message, told to check what already happened,
 * after a growing delay and at most once per delay. The cut-off run is never replayed. The
 * nonce keeps the conversation's report prefix, so a teammate waiting on the report waits on.
 */
export async function queueTaskReportRecoveryInTransaction(
  tx: Tx,
  input: { runId: string; error: string | null | undefined; now: Date },
): Promise<string | null> {
  if (!isInterruptedRunError(input.error)) return null;
  const run = await tx.run.findUnique({
    where: { id: input.runId },
    select: {
      id: true, trigger: true, status: true, spaceId: true, userId: true, botId: true, threadId: true,
      sourceMessageId: true, clientNonce: true, task: { select: { prompt: true } },
    },
  });
  if (!run || run.trigger !== "task_report" || run.status !== "failed" || !run.sourceMessageId ||
      !run.clientNonce || !isTaskReportNonce(run.clientNonce)) return null;
  // The first report run and every recovery share the report message.
  const attempts = await tx.run.count({
    where: { threadId: run.threadId, sourceMessageId: run.sourceMessageId, trigger: "task_report" },
  });
  const delay = INTERRUPTED_TURN_RECOVERY_DELAYS_MS[attempts - 1];
  if (delay === undefined) return null;
  const scope = { spaceId: run.spaceId, userId: run.userId };
  const bot = await tx.bot.findFirst({
    where: { id: run.botId, ...scope, archivedAt: null },
    select: { thread: { select: { id: true } } },
  });
  if (bot?.thread?.id !== run.threadId) return null;
  const task = await tx.task.create({
    data: { ...scope, botId: run.botId, threadId: run.threadId, status: "queued",
      prompt: `${run.task.prompt}${WORK_RECOVERY_MARKER}${INTERRUPTED_TURN_RECOVERY_NOTE}` },
    select: { id: true },
  });
  const recovery = await tx.run.create({
    data: {
      ...scope, botId: run.botId, threadId: run.threadId, taskId: task.id, status: "queued",
      trigger: "task_report", sourceMessageId: run.sourceMessageId,
      clientNonce: `${run.clientNonce.split(TASK_REPORT_RECOVERY_SEPARATOR)[0]}${TASK_REPORT_RECOVERY_SEPARATOR}${run.id}`,
      wakeAt: new Date(input.now.getTime() + delay),
    },
    select: { id: true },
  });
  await tx.message.update({ where: { id: run.sourceMessageId }, data: { runId: recovery.id } });
  return recovery.id;
}

/**
 * The conversations a turn opened with start_task, read from its completed tool effects so a
 * deleted conversation still counts. Used to hold a teammate's reply until they all report.
 */
export async function agentTasksStartedByRun(
  prisma: Pick<PrismaClient, "externalEffect">,
  runId: string,
): Promise<string[]> {
  const effects = await prisma.externalEffect.findMany({
    where: { runId, kind: "start_task", status: "completed" },
    select: { result: true },
  });
  return [
    ...new Set(
      effects.flatMap((effect) => {
        const result = effect.result as { taskId?: unknown } | null;
        return typeof result?.taskId === "string" ? [result.taskId] : [];
      }),
    ),
  ];
}
