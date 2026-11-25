import type { AwaitingReplies, AwaitingReplyState, MessageBlock } from "@mycellios/contracts";
import { botMessageContext, buildBotRepliesWakePrompt, isInterruptedRunError } from "@mycellios/core";
import { cancelRunsInTransaction } from "./cancel-runs.js";
import type { Prisma, PrismaClient } from "./client.js";
import {
  INTERRUPTED_REQUEST_RECOVERY_NOTE,
  INTERRUPTED_TURN_RECOVERY_DELAYS_MS,
  INTERRUPTED_TURN_RECOVERY_NOTE,
  WORK_RECOVERY_MARKER,
} from "./event-waits.js";
import { appendEventInTransaction } from "./events.js";
import { recordThreadTurnOutcome } from "./thread-lifecycle.js";

/**
 * Requests a Mico sends to other Micos (message_bot to one or more teammates, or send_to_group)
 * and the answers that settle them. One row per request and one per recipient: ids and states
 * only, the texts stay in the messages. When the last recipient settles, one turn hands every
 * answer back to the sender and names who did not answer. Every write runs under the request's
 * row lock, so an answer, a stop and the reconciler cannot release a request twice.
 */

type Tx = Prisma.TransactionClient;
type Scope = { spaceId: string; userId: string };

export const BOT_REQUEST_RECIPIENT_STATES = ["asked", "replied", "failed", "stopped"] as const;
export type BotRequestRecipientState = (typeof BOT_REQUEST_RECIPIENT_STATES)[number];

/** How long a settled list stays above the composer until the person hides it. */
export const AWAITING_REPLIES_SETTLED_VISIBLE_MS = 24 * 60 * 60 * 1000;
const AWAITING_REPLIES_LIMIT = 5;

export async function createBotMessageRequestInTransaction(
  tx: Tx,
  input: Scope & {
    senderBotId: string;
    senderThreadId: string;
    senderRunId?: string;
    groupId?: string;
  },
): Promise<string> {
  const request = await tx.botMessageRequest.create({
    data: {
      spaceId: input.spaceId,
      userId: input.userId,
      senderBotId: input.senderBotId,
      senderThreadId: input.senderThreadId,
      senderRunId: input.senderRunId,
      groupId: input.groupId,
    },
    select: { id: true },
  });
  return request.id;
}

export async function addBotMessageRecipientsInTransaction(
  tx: Tx,
  scope: Scope,
  requestId: string,
  recipients: ReadonlyArray<{ botId: string; runId: string }>,
) {
  await tx.botMessageRecipient.createMany({
    data: recipients.map((recipient) => ({
      requestId,
      spaceId: scope.spaceId,
      userId: scope.userId,
      botId: recipient.botId,
      runId: recipient.runId,
    })),
  });
}

async function lockRequest(tx: Tx, requestId: string) {
  await tx.$queryRaw`SELECT id FROM bot_message_requests WHERE id = ${requestId} FOR UPDATE`;
  return tx.botMessageRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      spaceId: true,
      userId: true,
      senderBotId: true,
      senderThreadId: true,
      groupId: true,
      settledAt: true,
      resumeRunId: true,
      recipients: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          botId: true,
          runId: true,
          state: true,
          answerMessageId: true,
          bot: { select: { name: true } },
        },
      },
    },
  });
}

export type LockedBotRequest = NonNullable<Awaited<ReturnType<typeof lockRequest>>>;

/** The request a recipient's turn answers, locked; null when that turn answers none. */
export async function lockRequestOfRecipientRun(
  tx: Tx,
  runId: string,
): Promise<{ request: LockedBotRequest; recipientId: string } | null> {
  const recipient = await tx.botMessageRecipient.findUnique({
    where: { runId },
    select: { id: true, requestId: true },
  });
  if (!recipient) return null;
  const request = await lockRequest(tx, recipient.requestId);
  return request ? { request, recipientId: recipient.id } : null;
}

/**
 * Settle one recipient that has not settled yet. Returns whether this call settled it and
 * whether any recipient of the request is still asked.
 */
export async function settleRecipientInTransaction(
  tx: Tx,
  request: LockedBotRequest,
  recipientId: string,
  state: Exclude<BotRequestRecipientState, "asked">,
  answerMessageId?: string,
): Promise<{ settled: boolean; remaining: number }> {
  const updated = await tx.botMessageRecipient.updateMany({
    where: { id: recipientId, requestId: request.id, state: "asked" },
    data: { state, settledAt: new Date(), ...(answerMessageId ? { answerMessageId } : {}) },
  });
  for (const recipient of request.recipients) {
    if (recipient.id === recipientId && updated.count) {
      recipient.state = state;
      if (answerMessageId) recipient.answerMessageId = answerMessageId;
    }
  }
  return {
    settled: updated.count > 0,
    remaining: request.recipients.filter((recipient) => recipient.state === "asked").length,
  };
}

/** Mark a request settled with the turn (if any) that hands its answers back. */
export async function markRequestSettledInTransaction(
  tx: Tx,
  requestId: string,
  resumeRunId: string | null,
) {
  await tx.botMessageRequest.updateMany({
    where: { id: requestId, settledAt: null },
    data: { settledAt: new Date(), ...(resumeRunId ? { resumeRunId } : {}) },
  });
}

function answerTextOf(blocks: unknown): string {
  const list = Array.isArray(blocks) ? (blocks as MessageBlock[]) : [];
  return list
    .filter(
      (block): block is Extract<MessageBlock, { kind: "bot_message_received" }> =>
        block.kind === "bot_message_received",
    )
    .map((block) => block.text)
    .join("\n\n")
    .trim();
}

/**
 * Every recipient settled: queue the one turn that gives the sender all answers, naming who
 * did not answer. No turn when nothing came back (every recipient was stopped). Only for a
 * request with several recipients; a single answer wakes the sender the ordinary way.
 */
export async function releaseBotMessageRequestInTransaction(
  tx: Tx,
  request: LockedBotRequest,
  groupName?: string,
): Promise<{ runId: string | null }> {
  if (request.settledAt) return { runId: request.resumeRunId };
  const answerIds = request.recipients
    .map((recipient) => recipient.answerMessageId)
    .filter((id): id is string => Boolean(id));
  const messages = answerIds.length
    ? await tx.message.findMany({
        where: { id: { in: answerIds }, threadId: request.senderThreadId },
        select: { id: true, seq: true, blocks: true, runId: true },
      })
    : [];
  const byId = new Map(messages.map((message) => [message.id, message]));
  const answers: Array<{ from: { id: string; name: string }; text: string; failed?: boolean }> = [];
  const missing: string[] = [];
  for (const recipient of request.recipients) {
    const message = recipient.answerMessageId ? byId.get(recipient.answerMessageId) : undefined;
    const text = message ? answerTextOf(message.blocks) : "";
    if (text && (recipient.state === "replied" || recipient.state === "failed")) {
      answers.push({
        from: { id: recipient.botId, name: recipient.bot.name },
        text,
        ...(recipient.state === "failed" ? { failed: true } : {}),
      });
    } else {
      missing.push(recipient.bot.name);
    }
  }
  if (!answers.length) {
    await markRequestSettledInTransaction(tx, request.id, null);
    return { runId: null };
  }
  const source = [...messages].sort((a, b) => b.seq - a.seq)[0];
  const task = await tx.task.create({
    data: {
      spaceId: request.spaceId,
      botId: request.senderBotId,
      threadId: request.senderThreadId,
      userId: request.userId,
      prompt: buildBotRepliesWakePrompt({ answers, missing, groupName }),
      status: "queued",
    },
  });
  const run = await tx.run.create({
    data: {
      spaceId: request.spaceId,
      botId: request.senderBotId,
      threadId: request.senderThreadId,
      taskId: task.id,
      userId: request.userId,
      status: "queued",
      trigger: "bot_message",
      sourceMessageId: source?.id,
    },
    select: { id: true },
  });
  // The held answers fold under the turn that reads them, like an ordinary answer's marker.
  await tx.message.updateMany({
    where: { id: { in: answerIds }, threadId: request.senderThreadId, runId: null },
    data: { runId: run.id },
  });
  await markRequestSettledInTransaction(tx, request.id, run.id);
  return { runId: run.id };
}

export const BOT_MESSAGE_RECOVERY_NONCE_PREFIX = "bot-message-recovery:";

function blocksOf(value: unknown): MessageBlock[] {
  return Array.isArray(value) ? (value as MessageBlock[]) : [];
}

/**
 * A Mico-to-Mico turn that an update or a lost PC connection cut off starts again from the
 * commit that ends it: a fresh run on the same message, told to check what already happened,
 * after a growing delay and at most once per delay. The cut-off run is never replayed and
 * returns no failure: its request (the recipient row, the answers it read) moves to the new
 * run, so the teammate keeps waiting and Stop still reaches it. Only turns someone waits on
 * recover: a request or question (the teammate) and a result or status (the person). A turn
 * that already answered, opened conversations or delegated work keeps its own path.
 */
export async function queueBotMessageRecoveryInTransaction(
  tx: Tx,
  input: { runId: string; error: string | null | undefined; now: Date },
): Promise<string | null> {
  if (!isInterruptedRunError(input.error)) return null;
  const run = await tx.run.findUnique({
    where: { id: input.runId },
    select: {
      id: true, trigger: true, status: true, spaceId: true, userId: true, botId: true, threadId: true,
      taskId: true, sourceMessageId: true, botOutcomeReturnedAt: true,
      task: { select: { prompt: true } },
      sourceMessage: { select: { blocks: true } },
    },
  });
  if (!run || run.trigger !== "bot_message" || run.status !== "failed" || !run.sourceMessageId ||
      run.botOutcomeReturnedAt) return null;
  const context = botMessageContext(blocksOf(run.sourceMessage?.blocks));
  const intent = context?.intent ?? "request";
  if (!context || intent === "fyi") return null;
  const answersTeammate = intent === "request" || intent === "question";
  // The first turn on this message and every recovery share it.
  const attempts = await tx.run.count({
    where: { threadId: run.threadId, sourceMessageId: run.sourceMessageId, trigger: "bot_message" },
  });
  const delay = INTERRUPTED_TURN_RECOVERY_DELAYS_MS[attempts - 1];
  if (delay === undefined) return null;
  const scope = { spaceId: run.spaceId, userId: run.userId };
  const bot = await tx.bot.findFirst({ where: { id: run.botId, ...scope, archivedAt: null }, select: { id: true } });
  const thread = await tx.thread.findFirst({
    where: { id: run.threadId, ...scope, archivedAt: null, deleteAfter: null },
    select: { id: true },
  });
  if (!bot || !thread) return null;
  const openedTasks = await tx.externalEffect.count({
    where: { runId: run.id, kind: "start_task", status: "completed" },
  });
  const delegated = await tx.task.count({ where: { parentTaskId: run.taskId } });
  const recipient = await tx.botMessageRecipient.findUnique({ where: { runId: run.id }, select: { state: true } });
  if (openedTasks || delegated || (recipient && recipient.state !== "asked")) return null;
  if (answersTeammate) {
    const sent = await tx.message.findMany({
      where: { threadId: run.threadId, runId: run.id, role: "bot" },
      select: { blocks: true },
    });
    const answered = sent.some((message) =>
      blocksOf(message.blocks).some(
        (block) => block.kind === "bot_message_sent" && block.toBotId === context.fromBotId && block.intent === "result",
      ),
    );
    if (answered) return null;
  }
  const task = await tx.task.create({
    data: {
      ...scope, botId: run.botId, threadId: run.threadId, status: "queued",
      prompt: `${run.task.prompt}${WORK_RECOVERY_MARKER}${
        answersTeammate ? INTERRUPTED_REQUEST_RECOVERY_NOTE : INTERRUPTED_TURN_RECOVERY_NOTE}`,
    },
    select: { id: true },
  });
  const recovery = await tx.run.create({
    data: {
      ...scope, botId: run.botId, threadId: run.threadId, taskId: task.id, status: "queued",
      trigger: "bot_message", sourceMessageId: run.sourceMessageId,
      clientNonce: `${BOT_MESSAGE_RECOVERY_NONCE_PREFIX}${run.id}`,
      wakeAt: new Date(input.now.getTime() + delay),
    },
    select: { id: true },
  });
  // The new turn returns the outcome; the reconciler must not send this one's failure.
  await tx.run.update({ where: { id: run.id }, data: { botOutcomeReturnedAt: input.now } });
  await tx.botMessageRecipient.updateMany({ where: { runId: run.id, state: "asked" }, data: { runId: recovery.id } });
  // The answers a released request handed this turn fold under the turn that reads them now.
  const released = await tx.botMessageRequest.findMany({
    where: { resumeRunId: run.id, ...scope },
    select: { recipients: { select: { answerMessageId: true } } },
  });
  const markerIds = [
    run.sourceMessageId,
    ...released.flatMap((request) =>
      request.recipients.flatMap((row) => (row.answerMessageId ? [row.answerMessageId] : [])),
    ),
  ];
  await tx.message.updateMany({
    where: { id: { in: markerIds }, threadId: run.threadId, runId: run.id },
    data: { runId: recovery.id },
  });
  if (released.length) {
    await tx.botMessageRequest.updateMany({
      where: { resumeRunId: run.id, ...scope },
      data: { resumeRunId: recovery.id },
    });
  }
  return recovery.id;
}

/**
 * Recipients whose turns were stopped (by the person, by interrupt_agent, by archive) settle
 * as stopped. Returns the resume turns that this released, for the caller to start.
 */
export async function settleStoppedRecipientsInTransaction(
  tx: Tx,
  runIds: readonly string[],
): Promise<string[]> {
  if (!runIds.length) return [];
  const recipients = await tx.botMessageRecipient.findMany({
    where: { runId: { in: [...runIds] }, state: "asked" },
    select: { id: true, requestId: true },
    orderBy: { requestId: "asc" },
  });
  const resumeRunIds: string[] = [];
  for (const recipient of recipients) {
    const request = await lockRequest(tx, recipient.requestId);
    if (!request || request.settledAt) continue;
    const { settled, remaining } = await settleRecipientInTransaction(
      tx,
      request,
      recipient.id,
      "stopped",
    );
    if (!settled || remaining > 0) continue;
    const groupName = request.groupId
      ? (await tx.chatGroup.findUnique({ where: { id: request.groupId }, select: { name: true } }))
          ?.name
      : undefined;
    const released = await releaseBotMessageRequestInTransaction(tx, request, groupName);
    if (released.runId) resumeRunIds.push(released.runId);
  }
  return resumeRunIds;
}

/**
 * Recipients still asked whose turns were stopped or removed without passing through the
 * stop paths above (a stopped thread, an archived Mico, a deleted conversation). Stuck turns
 * that end with a status are answered by the outcome reconciler instead.
 */
export async function findAbandonedRecipientRunIds(
  prisma: PrismaClient,
  options: { stuckErrors: readonly string[]; limit: number; olderThan: Date },
): Promise<{ stoppedRunIds: string[]; orphanRecipientIds: string[]; groupRunIds: string[] }> {
  const rows = await prisma.botMessageRecipient.findMany({
    where: { state: "asked", createdAt: { lt: options.olderThan } },
    orderBy: { createdAt: "asc" },
    take: options.limit,
    select: {
      id: true,
      runId: true,
      run: { select: { status: true, trigger: true, error: true } },
    },
  });
  const stoppedRunIds: string[] = [];
  const orphanRecipientIds: string[] = [];
  const groupRunIds: string[] = [];
  for (const row of rows) {
    if (!row.runId || !row.run) {
      orphanRecipientIds.push(row.id);
      continue;
    }
    const { status, trigger, error } = row.run;
    if (trigger === "bot_message") {
      if (status === "cancelled" && !options.stuckErrors.includes(error ?? ""))
        stoppedRunIds.push(row.runId);
      continue;
    }
    if (status === "completed" || status === "failed" || status === "cancelled")
      groupRunIds.push(row.runId);
  }
  return { stoppedRunIds, orphanRecipientIds, groupRunIds };
}

/** A recipient whose turn is gone settles as stopped; returns released resume turns. */
export async function settleOrphanRecipientInTransaction(
  tx: Tx,
  recipientId: string,
): Promise<string[]> {
  const recipient = await tx.botMessageRecipient.findUnique({
    where: { id: recipientId },
    select: { requestId: true, runId: true },
  });
  if (!recipient || recipient.runId) return [];
  const request = await lockRequest(tx, recipient.requestId);
  if (!request || request.settledAt) return [];
  const { settled, remaining } = await settleRecipientInTransaction(
    tx,
    request,
    recipientId,
    "stopped",
  );
  if (!settled || remaining > 0) return [];
  const released = await releaseBotMessageRequestInTransaction(tx, request);
  return released.runId ? [released.runId] : [];
}

function liveState(state: string, run: { status: string } | null): AwaitingReplyState {
  if (state === "replied" || state === "failed" || state === "stopped") return state;
  if (!run) return "stopped";
  switch (run.status) {
    case "queued":
    case "leased":
      return "asked";
    case "waiting_input":
    case "waiting_takeover":
      return "needs_you";
    case "cancelled":
      return "stopped";
    default:
      // Running, or finished with its answer on the way.
      return "working";
  }
}

/**
 * The "Waiting for replies" list of a Mico main chat: its open requests (and settled ones the
 * person has not hidden, for a day), plus tasks it delegated that have not finished.
 */
export async function awaitingRepliesForThread(
  prisma: PrismaClient,
  scope: Scope & { botId: string; threadId: string },
  now = new Date(),
): Promise<AwaitingReplies> {
  const [requests, work] = await Promise.all([
    prisma.botMessageRequest.findMany({
      where: {
        spaceId: scope.spaceId,
        userId: scope.userId,
        senderBotId: scope.botId,
        senderThreadId: scope.threadId,
        OR: [
          { settledAt: null },
          {
            hiddenAt: null,
            settledAt: { gte: new Date(now.getTime() - AWAITING_REPLIES_SETTLED_VISIBLE_MS) },
          },
        ],
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: AWAITING_REPLIES_LIMIT,
      select: {
        id: true,
        groupId: true,
        createdAt: true,
        settledAt: true,
        recipients: {
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            botId: true,
            state: true,
            bot: { select: { name: true } },
            run: { select: { status: true } },
          },
        },
      },
    }),
    prisma.task.findMany({
      where: {
        spaceId: scope.spaceId,
        userId: scope.userId,
        workParent: { threadId: scope.threadId, botId: scope.botId },
        OR: [
          { delegationState: { in: ["queued", "running", "waiting"] } },
          { paused: true, delegationState: { notIn: ["completed", "failed", "cancelled"] } },
        ],
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 20,
      select: {
        id: true,
        botId: true,
        delegationState: true,
        delegationRevision: true,
        paused: true,
        workStopPending: true,
        bot: { select: { name: true } },
      },
    }),
  ]);
  const groupIds = [
    ...new Set(requests.map((request) => request.groupId).filter(Boolean)),
  ] as string[];
  const groups = groupIds.length
    ? await prisma.chatGroup.findMany({
        where: { id: { in: groupIds }, spaceId: scope.spaceId, userId: scope.userId },
        select: { id: true, name: true },
      })
    : [];
  const groupNames = new Map(groups.map((group) => [group.id, group.name]));
  return {
    requests: requests.map((request) => ({
      requestId: request.id,
      ...(request.groupId
        ? { groupId: request.groupId, groupName: groupNames.get(request.groupId) ?? "" }
        : {}),
      createdAt: request.createdAt.toISOString(),
      settled: request.settledAt !== null,
      recipients: request.recipients.map((recipient) => ({
        botId: recipient.botId,
        name: recipient.bot.name,
        state: liveState(recipient.state, recipient.run),
      })),
    })),
    work: work.map((task) => ({
      taskId: task.id,
      botId: task.botId,
      name: task.bot.name,
      delegationState: task.delegationState ?? "queued",
      revision: task.delegationRevision,
      paused: task.paused,
      stopping: task.workStopPending,
    })),
  };
}

/** The run of one still-asked recipient, for the list's Stop; null when it already settled. */
export async function awaitingReplyRun(
  prisma: PrismaClient,
  scope: Scope,
  input: { requestId: string; botId: string },
): Promise<{
  runId: string;
  threadId: string;
  groupId: string | null;
  senderBotId: string;
} | null> {
  const recipient = await prisma.botMessageRecipient.findFirst({
    where: {
      requestId: input.requestId,
      botId: input.botId,
      spaceId: scope.spaceId,
      userId: scope.userId,
      state: "asked",
      request: { spaceId: scope.spaceId, userId: scope.userId },
    },
    select: {
      runId: true,
      run: { select: { threadId: true } },
      request: { select: { groupId: true, senderBotId: true } },
    },
  });
  if (!recipient?.runId || !recipient.run) return null;
  return {
    runId: recipient.runId,
    threadId: recipient.run.threadId,
    groupId: recipient.request.groupId,
    senderBotId: recipient.request.senderBotId,
  };
}

/** "Hide this list": only settled requests of the person hide. */
export async function hideAwaitingReplies(
  prisma: PrismaClient,
  scope: Scope,
  requestIds: readonly string[],
) {
  await prisma.botMessageRequest.updateMany({
    where: {
      id: { in: [...requestIds] },
      spaceId: scope.spaceId,
      userId: scope.userId,
      settledAt: { not: null },
      hiddenAt: null,
    },
    data: { hiddenAt: new Date() },
  });
}

/**
 * The active turns of one teammate that work on the caller's own messages: a request or update
 * the caller sent it, or its part of a send_to_group request. interrupt_agent may stop only
 * these; turns the person, a routine or another Mico started are not the caller's to stop.
 */
export async function teammateRunsForCaller(
  prisma: PrismaClient,
  scope: Scope & { callerBotId: string; targetBotId: string },
): Promise<{ ownRunIds: string[]; otherActive: number }> {
  const active = await prisma.run.findMany({
    where: {
      spaceId: scope.spaceId,
      userId: scope.userId,
      botId: scope.targetBotId,
      status: { in: ["queued", "leased", "running", "waiting_input", "waiting_takeover"] },
    },
    select: {
      id: true,
      trigger: true,
      sourceMessage: { select: { blocks: true } },
      botMessageRecipient: { select: { request: { select: { senderBotId: true } } } },
    },
    take: 50,
  });
  const ownRunIds = active
    .filter(
      (run) =>
        run.botMessageRecipient?.request.senderBotId === scope.callerBotId ||
        (run.trigger === "bot_message" &&
          (Array.isArray(run.sourceMessage?.blocks)
            ? (run.sourceMessage.blocks as MessageBlock[])
            : []
          ).some(
            (block) =>
              block.kind === "bot_message_received" && block.fromBotId === scope.callerBotId,
          )),
    )
    .map((run) => run.id);
  return { ownRunIds, otherActive: active.length - ownRunIds.length };
}

/**
 * Stop a teammate's turns the way the person's Stop does: cancel them under their threads'
 * locks, drop their queued input, mark the conversation interrupted and record computer
 * teardown in the durable work-stop outbox. Recipients of requests settle as stopped.
 */
export async function stopTeammateRunsInTransaction(
  tx: Tx,
  scope: Scope,
  runIds: readonly string[],
  reason: string,
): Promise<{
  runIds: string[];
  teardownTaskIds: string[];
  notices: Array<{ threadId: string; seq: number }>;
  resumeRunIds: string[];
}> {
  const runs = await tx.run.findMany({
    where: {
      id: { in: [...runIds] },
      spaceId: scope.spaceId,
      userId: scope.userId,
      status: { in: ["queued", "leased", "running", "waiting_input", "waiting_takeover"] },
    },
    select: { id: true, taskId: true, userId: true, spaceId: true, botId: true, threadId: true },
  });
  if (!runs.length) return { runIds: [], teardownTaskIds: [], notices: [], resumeRunIds: [] };
  for (const threadId of [...new Set(runs.map((run) => run.threadId))].sort()) {
    await tx.$queryRaw`SELECT id FROM threads WHERE id = ${threadId} FOR UPDATE`;
  }
  const ids = runs.map((run) => run.id);
  const leases = await tx.computerExecutionLease.findMany({
    where: { runId: { in: ids } },
    include: { computer: true },
  });
  await cancelRunsInTransaction(tx, runs, new Date());
  await tx.steeringMessage.deleteMany({ where: { runId: { in: ids } } });
  const notices: Array<{ threadId: string; seq: number }> = [];
  for (const threadId of new Set(runs.map((run) => run.threadId))) {
    await recordThreadTurnOutcome(tx, {
      threadId,
      runIds: runs.filter((run) => run.threadId === threadId).map((run) => run.id),
      outcome: "interrupted",
    });
  }
  for (const run of runs) {
    const event = await appendEventInTransaction(tx, {
      spaceId: scope.spaceId,
      threadId: run.threadId,
      botId: run.botId,
      runId: run.id,
      type: "run.cancelled",
      payload: { reason },
    });
    notices.push({ threadId: run.threadId, seq: event.seq });
  }
  await tx.event.deleteMany({ where: { type: "thread.progress", runId: { in: ids } } });
  const byTask = new Map<string, string[]>();
  for (const run of runs) byTask.set(run.taskId, [...(byTask.get(run.taskId) ?? []), run.id]);
  for (const [taskId, taskRunIds] of byTask) {
    await tx.task.update({
      where: { id: taskId },
      data: {
        workStopPending: true,
        workStopTargets: {
          runIds: taskRunIds,
          targets: leases
            .filter((lease) => taskRunIds.includes(lease.runId))
            .map((lease) => ({
              runId: lease.runId,
              botId: lease.botId,
              computerId: lease.computerId,
              fence: lease.fence,
              kind: lease.computer.kind,
              providerRef: lease.computer.providerRef,
              homeKey: lease.computer.homeKey,
            })),
        } as Prisma.InputJsonValue,
      },
    });
  }
  const resumeRunIds = await settleStoppedRecipientsInTransaction(tx, ids);
  return { runIds: ids, teardownTaskIds: [...byTask.keys()], notices, resumeRunIds };
}
