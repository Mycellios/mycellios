import { runContinueJob } from "@mycellios/adapter-kit";
import {
  BOT_MESSAGE_MAX_FILES,
  BOT_MESSAGE_MAX_RECIPIENTS,
  type BotMessageIntent,
  type MessageBlock,
} from "@mycellios/contracts";
import {
  ACTIVE_RUN_STATUSES,
  BOT_MESSAGE_MAX_LENGTH,
  botMessageContext,
  botMessageExpectsReply,
  botMessageHopExhausted,
  botMessageIntentFor,
  buildBotMessageWakePrompt,
  clampBotMessage,
  interruptedTaskReply,
  nextBotMessageHop,
  resolveBotAddress,
  taskAnswerText,
  taskReportNoncePrefix,
} from "@mycellios/core";
import {
  addBotMessageRecipientsInTransaction,
  agentTasksStartedByRun,
  appendEventInTransaction,
  createBotMessageRequestInTransaction,
  createThreadMessageInTransaction,
  lockRequestOfRecipientRun,
  markRequestSettledInTransaction,
  type Prisma,
  type PrismaClient,
  releaseBotMessageRequestInTransaction,
  settleRecipientInTransaction,
  withTransactionRetry,
} from "@mycellios/db";
import { getLogger } from "@mycellios/logging";
import type { ExecutorDeps } from "./executor.js";

/**
 * The hop the current run sits at, read back from the message that woke this
 * bot. A run a person started carries no bot message, so it starts at 0.
 */
export async function currentBotMessageHop(
  prisma: PrismaClient,
  sourceMessageId: string | null | undefined,
): Promise<number> {
  if (!sourceMessageId) return 0;
  const source = await prisma.message.findUnique({
    where: { id: sourceMessageId },
    select: { blocks: true },
  });
  const blocks = Array.isArray(source?.blocks) ? (source.blocks as MessageBlock[]) : [];
  return botMessageContext(blocks)?.hop ?? 0;
}

export async function loadBotMessageContext(
  prisma: PrismaClient,
  sourceMessageId: string | null | undefined,
) {
  if (!sourceMessageId) return undefined;
  const source = await prisma.message.findUnique({
    where: { id: sourceMessageId },
    select: { blocks: true, replyTo: { select: { blocks: true } } },
  });
  const context = botMessageContext(
    Array.isArray(source?.blocks) ? (source.blocks as MessageBlock[]) : [],
  );
  if (!context) return undefined;
  const replyBlocks = Array.isArray(source?.replyTo?.blocks)
    ? (source.replyTo.blocks as MessageBlock[])
    : [];
  const repliesToRequest =
    (context.intent === "result" || context.intent === "status" || context.intent === "fyi") &&
    replyBlocks.some(
      (block) =>
        block.kind === "bot_message_sent" &&
        block.toBotId === context.fromBotId &&
        (block.intent === undefined || block.intent === "request" || block.intent === "question"),
    );
  return { ...context, repliesToRequest };
}

type AttachmentBlock = Extract<MessageBlock, { kind: "file" | "image" }>;

/**
 * Deliver a message from one Mico to one or more teammates (1 to 32), each into its own chat
 * where it wakes its own turn. Files are shared as owner/Space artifacts already attached by
 * the caller. A request or question opens a request row: answers from several recipients are
 * held until every one has answered, failed or been stopped, then come back in one turn.
 */
export async function messageBot(
  deps: Pick<ExecutorDeps, "prisma" | "events" | "jobs">,
  run: {
    id: string;
    spaceId: string;
    threadId: string;
    botId: string;
    userId: string;
    sourceMessageId?: string | null;
  },
  sender: { id: string; name: string },
  input: {
    bot_id?: string;
    bot_ids?: readonly string[];
    confirm_name?: string;
    message: string;
    intent?: BotMessageIntent;
    expects_reply?: boolean;
    reply_to_message_id?: string;
    attachments?: readonly AttachmentBlock[];
    deliveryKey?: string;
  },
  options?: { allowTerminalSource?: boolean; forceUnread?: boolean },
) {
  const message = String(input.message ?? "").trim();
  if (!message) return { ok: false as const, error: "message is required" };
  if (message.length > BOT_MESSAGE_MAX_LENGTH) {
    return {
      ok: false as const,
      error: `message exceeds the ${BOT_MESSAGE_MAX_LENGTH} character limit`,
    };
  }
  const attachments = [...(input.attachments ?? [])];
  if (attachments.length > BOT_MESSAGE_MAX_FILES) {
    return { ok: false as const, error: `share at most ${BOT_MESSAGE_MAX_FILES} files per message` };
  }

  const sourceContext = await loadBotMessageContext(deps.prisma, run.sourceMessageId);
  const intent = botMessageIntentFor(input.intent, input.expects_reply);
  const hop = nextBotMessageHop(sourceContext?.hop);

  const candidates = await deps.prisma.bot.findMany({
    where: { spaceId: run.spaceId, userId: run.userId, archivedAt: null },
    select: { id: true, name: true, title: true, thread: { select: { id: true } } },
  });
  const requestedIds = [
    ...new Set(
      [...(input.bot_ids ?? []), ...(input.bot_id ? [input.bot_id] : [])]
        .map((id) => String(id).trim())
        .filter(Boolean),
    ),
  ];
  if (requestedIds.length > BOT_MESSAGE_MAX_RECIPIENTS) {
    return {
      ok: false as const,
      error: `message at most ${BOT_MESSAGE_MAX_RECIPIENTS} teammates at once`,
    };
  }
  const targets: typeof candidates = [];
  if (requestedIds.length) {
    for (const botId of requestedIds) {
      const found = resolveBotAddress(candidates, { botId });
      if (!found) return { ok: false as const, error: "no bot found with that id or name" };
      targets.push(found);
    }
  } else {
    const found = resolveBotAddress(candidates, { name: input.confirm_name });
    if (!found) return { ok: false as const, error: "no bot found with that id or name" };
    targets.push(found);
  }
  if (targets.some((target) => target.id === sender.id))
    return { ok: false as const, error: "a bot cannot message itself" };
  const unreachable = targets.find((target) => !target.thread);
  if (unreachable)
    return { ok: false as const, error: `${unreachable.name} has no chat to deliver to` };
  const single = targets.length === 1 ? targets[0] : undefined;
  const replyTarget = single && sourceContext?.fromBotId === single.id ? single : undefined;
  const returnsToSender =
    options?.allowTerminalSource === true &&
    (intent === "result" || intent === "status") &&
    (sourceContext?.intent === undefined ||
      sourceContext.intent === "request" ||
      sourceContext.intent === "question") &&
    Boolean(replyTarget);
  if (botMessageHopExhausted(hop) && !returnsToSender) {
    return {
      ok: false as const,
      error:
        "bot-to-bot message limit reached for this chain; report back to the user instead of messaging another bot",
    };
  }
  if (input.reply_to_message_id && !single) {
    return { ok: false as const, error: "reply_to_message_id needs exactly one recipient" };
  }
  const senderMainThreadId = candidates.find((bot) => bot.id === sender.id)?.thread?.id ?? run.threadId;
  const opensRequest = botMessageExpectsReply(intent);
  // An answer goes back to the teammate whose request woke this turn.
  const answersRequest = Boolean(replyTarget) && (intent === "result" || intent === "status");

  // A tool call can be re-executed after a lease expiry, so a delivery has to be
  // replayable: without this the recipient is messaged twice and woken twice.
  const deliveryKey = input.deliveryKey ? `bot-message:${input.deliveryKey}` : undefined;
  const names = targets.map((target) => target.name);
  const replayed = () =>
    ({
      ok: true as const,
      botId: targets[0]!.id,
      name: targets[0]!.name,
      ...(single ? {} : { recipients: targets.map((target) => ({ botId: target.id, name: target.name })) }),
      delivered: message,
      replayed: true as const,
      note: `Already sent to ${names.join(", ")} in this turn; it was not sent again.`,
    }) as const;

  const wakePrompt = buildBotMessageWakePrompt({ from: sender, text: message, intent });
  const outboundBlock: MessageBlock = {
    kind: "bot_message_sent",
    toBotId: targets[0]!.id,
    toBotName: targets[0]!.name,
    text: message,
    intent,
    ...(single ? {} : { recipients: targets.map((target) => ({ botId: target.id, botName: target.name })) }),
  };

  type Committed =
    | { ok: true; runIds: string[]; notices: Array<{ threadId: string; seq: number }>; requestId?: string; held: boolean }
    | { ok: false; error: string }
    | { ok: true; replayed: true };
  let committed: Committed;
  try {
    committed = await withTransactionRetry(() =>
      deps.prisma.$transaction(async (tx): Promise<Committed> => {
        const threadIds = [...new Set([run.threadId, ...targets.map((target) => target.thread!.id)])].sort();
        for (const threadId of threadIds) {
          await tx.$queryRaw`SELECT id FROM threads WHERE id = ${threadId} FOR UPDATE`;
        }
        // Claim the delivery key inside the transaction so a concurrent retry
        // either sees the winner or loses on the unique (threadId, clientNonce).
        if (deliveryKey) {
          const already = await tx.message.findUnique({
            where: {
              threadId_clientNonce: { threadId: targets[0]!.thread!.id, clientNonce: deliveryKey },
            },
            select: { id: true },
          });
          if (already) return { ok: true as const, replayed: true as const };
        }

        const senderStillRunning = await tx.run.findFirst({
          where: {
            id: run.id,
            spaceId: run.spaceId,
            threadId: run.threadId,
            botId: run.botId,
            userId: run.userId,
            status: options?.allowTerminalSource
              ? { in: ["completed", "failed", "cancelled"] }
              : "running",
          },
          select: { id: true, status: true },
        });
        if (!senderStillRunning)
          return { ok: false as const, error: "source run is no longer active" };

        // Re-read the targets inside the transaction: one can be archived between
        // resolving it above and committing here.
        for (const target of targets) {
          const stillAddressable = await tx.bot.findFirst({
            where: { id: target.id, spaceId: run.spaceId, userId: run.userId, archivedAt: null },
            select: { id: true },
          });
          if (!stillAddressable)
            return { ok: false as const, error: `${target.name} is no longer available` };
        }

        let replyToMessageId: string | undefined;
        if (input.reply_to_message_id) {
          const replied = await tx.message.findFirst({
            where: {
              id: input.reply_to_message_id,
              threadId: { in: [...new Set([run.threadId, senderMainThreadId])] },
            },
            select: { blocks: true },
          });
          const received = (Array.isArray(replied?.blocks) ? (replied.blocks as MessageBlock[]) : []).find(
            (block): block is Extract<MessageBlock, { kind: "bot_message_received" }> =>
              block.kind === "bot_message_received" && block.fromBotId === single!.id,
          );
          if (!received)
            return {
              ok: false as const,
              error: `reply_to_message_id is not a message ${single!.name} sent you`,
            };
          replyToMessageId = received.returnToMessageId;
        }

        // The request this message answers, locked so a stop or the reconciler cannot settle
        // it at the same time.
        const answering = answersRequest ? await lockRequestOfRecipientRun(tx, run.id) : null;
        const answerRequest = answering && !answering.request.settledAt ? answering : null;
        const answerSettles =
          Boolean(answerRequest) &&
          (intent === "result" || senderStillRunning.status !== "running");
        const holdsAnswer = Boolean(answerRequest) && answerRequest!.request.recipients.length > 1;

        // Echo into the sender's chat in the same transaction so a failed notify
        // cannot leave one side delivered and the other blank.
        const outbound = await createThreadMessageInTransaction(tx, {
          threadId: run.threadId,
          role: "bot",
          blocks: [outboundBlock, ...attachments],
          botId: run.botId,
          runId: run.id,
          markUnread: options?.forceUnread === true,
          allowCancelledRun: options?.allowTerminalSource === true,
        });
        const requestId = opensRequest
          ? await createBotMessageRequestInTransaction(tx, {
              spaceId: run.spaceId,
              userId: run.userId,
              senderBotId: sender.id,
              senderThreadId: senderMainThreadId,
              senderRunId: run.id,
            })
          : undefined;
        const runIds: string[] = [];
        const notices: Array<{ threadId: string; seq: number }> = [];
        const recipients: Array<{ botId: string; runId: string }> = [];
        for (const target of targets) {
          const targetThreadId = target.thread!.id;
          const inboundBlock: MessageBlock = {
            kind: "bot_message_received",
            fromBotId: sender.id,
            fromBotName: sender.name,
            text: message,
            hop,
            intent,
            returnToMessageId: outbound.id,
            ...(single ? {} : { recipientCount: targets.length }),
          };
          const inbound = await createThreadMessageInTransaction(tx, {
            threadId: targetThreadId,
            role: "user",
            blocks: [inboundBlock, ...attachments],
            replyToMessageId:
              replyToMessageId ??
              (replyTarget && intent !== "fyi" ? sourceContext?.returnToMessageId : undefined),
            clientNonce: deliveryKey,
            markUnread: options?.forceUnread === true,
          });
          let nextRunId: string | null = null;
          if (answerRequest && answerSettles) {
            const state = senderStillRunning.status === "running" || senderStillRunning.status === "completed"
              ? "replied"
              : "failed";
            const { remaining } = await settleRecipientInTransaction(
              tx,
              answerRequest.request,
              answerRequest.recipientId,
              state,
              inbound.id,
            );
            if (holdsAnswer) {
              // Answers to a request sent to several teammates start the sender's turn together.
              if (remaining === 0) {
                nextRunId = (await releaseBotMessageRequestInTransaction(tx, answerRequest.request)).runId;
              }
            } else {
              nextRunId = await queueWakeRun(tx, run, target.id, targetThreadId, wakePrompt, inbound.id);
              await markRequestSettledInTransaction(tx, answerRequest.request.id, nextRunId);
            }
          } else if (!(answerRequest && holdsAnswer)) {
            nextRunId = await queueWakeRun(tx, run, target.id, targetThreadId, wakePrompt, inbound.id);
          }
          if (nextRunId) {
            runIds.push(nextRunId);
            if (requestId) recipients.push({ botId: target.id, runId: nextRunId });
          }
          const inboundEvent = await appendEventInTransaction(tx, {
            spaceId: run.spaceId,
            threadId: targetThreadId,
            botId: target.id,
            type: "thread.message.created",
            runId: nextRunId ?? undefined,
            payload: { messageId: inbound.id, role: "user", blocks: [inboundBlock, ...attachments] },
          });
          notices.push({ threadId: targetThreadId, seq: inboundEvent.seq });
        }
        if (requestId) await addBotMessageRecipientsInTransaction(tx, run, requestId, recipients);
        const outboundEvent = await appendEventInTransaction(tx, {
          spaceId: run.spaceId,
          threadId: run.threadId,
          botId: run.botId,
          type: "thread.message.created",
          runId: run.id,
          allowCancelledRun: options?.allowTerminalSource === true,
          payload: { messageId: outbound.id, role: "bot", blocks: [outboundBlock, ...attachments] },
        });
        notices.push({ threadId: run.threadId, seq: outboundEvent.seq });
        return { ok: true as const, runIds, notices, requestId, held: Boolean(answerRequest && holdsAnswer) };
      }),
    );
  } catch (error) {
    // Two concurrent retries can both miss the in-transaction lookup; the
    // loser hits the unique key. Treat that as a successful replay.
    if (deliveryKey && isUniqueConstraintError(error)) {
      const winner = await deps.prisma.message.findUnique({
        where: {
          threadId_clientNonce: { threadId: targets[0]!.thread!.id, clientNonce: deliveryKey },
        },
        select: { id: true },
      });
      if (winner) return replayed();
    }
    throw error;
  }
  if ("replayed" in committed) return replayed();
  if (!committed.ok) return committed;

  for (const notice of committed.notices) {
    await deps.events.notify(notice.threadId, notice.seq).catch((error) => {
      getLogger().error("bot message realtime notification", error);
    });
  }
  for (const runId of committed.runIds) {
    await deps.jobs.enqueue(runContinueJob(runId)).catch((error) => {
      // The queued run is durable; the job reconciler repairs a missed wake.
      getLogger().error("bot message enqueue", error);
    });
  }
  const waiting = !committed.requestId
    ? " Continue independent work; send another update later only if it adds something new."
    : targets.length > 1
      ? " Their answers come back together in one later turn, once each has answered or been stopped. Continue independent work, then end this turn; do not poll or wait."
      : " A reply wakes you later as a new message. Continue independent work; send another update later only if it adds something new.";
  return {
    ok: true as const,
    botId: targets[0]!.id,
    name: targets[0]!.name,
    ...(single ? {} : { recipients: targets.map((target) => ({ botId: target.id, name: target.name })) }),
    delivered: message,
    ...(attachments.length ? { files: attachments.map((block) => block.name) } : {}),
    note: `Sent to ${names.join(", ")}. Delivery is async.${waiting}`,
  };
}

async function queueWakeRun(
  tx: Prisma.TransactionClient,
  run: { spaceId: string; userId: string },
  botId: string,
  threadId: string,
  prompt: string,
  sourceMessageId: string,
): Promise<string> {
  const task = await tx.task.create({
    data: { spaceId: run.spaceId, botId, threadId, userId: run.userId, prompt, status: "queued" },
  });
  const nextRun = await tx.run.create({
    data: {
      spaceId: run.spaceId,
      botId,
      threadId,
      taskId: task.id,
      userId: run.userId,
      status: "queued",
      trigger: "bot_message",
      sourceMessageId,
    },
    select: { id: true },
  });
  await tx.message.update({ where: { id: sourceMessageId }, data: { runId: nextRun.id } });
  return nextRun.id;
}

/** Return a delegated run's terminal outcome unless it already sent one explicitly. */
export async function returnBotMessageOutcome(
  deps: Pick<ExecutorDeps, "prisma" | "events" | "jobs">,
  run: {
    id: string;
    spaceId: string;
    threadId: string;
    botId: string;
    userId: string;
    sourceMessageId?: string | null;
  },
  sender: { id: string; name: string },
  text: string,
  intent: "result" | "status" = "result",
  options?: { forceUnread?: boolean },
) {
  const source = await loadBotMessageContext(deps.prisma, run.sourceMessageId);
  if (!source) {
    await markBotOutcomeReturned(deps.prisma, run.id);
    // Handled: nothing to deliver. Return true so callers do not release a reservation.
    return true;
  }
  const sourceIntent = source.intent ?? "request";
  if (sourceIntent !== "request" && sourceIntent !== "question") {
    await markBotOutcomeReturned(deps.prisma, run.id);
    return true;
  }
  // A turn that opened tasks answers its teammate once they have reported, never with an
  // interim status. Until then this stays unreturned, so the reconciler keeps checking.
  if ((await agentTasksStartedByRun(deps.prisma, run.id)).length) {
    const state = await settleAgentTaskTeammateReply(deps, run.id);
    return state === "delivered" || state === "none";
  }
  const sent = await deps.prisma.message.findMany({
    where: { threadId: run.threadId, runId: run.id },
    select: { blocks: true },
  });
  // Only an explicit result counts as a terminal outcome. Interim message_bot
  // status updates must not suppress the automatic final return.
  const alreadyReturned = sent.some((message) =>
    (Array.isArray(message.blocks) ? (message.blocks as MessageBlock[]) : []).some(
      (block) =>
        block.kind === "bot_message_sent" &&
        block.toBotId === source.fromBotId &&
        block.intent === "result",
    ),
  );
  if (alreadyReturned) {
    await markBotOutcomeReturned(deps.prisma, run.id);
    return true;
  }
  const outcome = await messageBot(
    deps,
    run,
    sender,
    {
      bot_id: source.fromBotId,
      message: clampBotMessage(text),
      intent,
      // One key per run so status vs result (executor vs reconciler) cannot double-deliver.
      deliveryKey: `auto-outcome:${run.id}`,
    },
    {
      allowTerminalSource: true,
      forceUnread: options?.forceUnread,
    },
  );
  if (outcome.ok) await markBotOutcomeReturned(deps.prisma, run.id);
  return outcome.ok;
}

export type TeammateReplyState = "none" | "deferred" | "delivered" | "failed";

/**
 * A teammate asked this Mico for something and the turn that answered opened tasks
 * (start_task). The reply waits until none of those tasks or their reports is still working,
 * then carries the Mico's answer to the last report; when no report answered (a task closed,
 * deleted or lost first) it carries what the tasks left, marked as interrupted. One reply per
 * request run, under the same delivery key as an ordinary returned outcome.
 */
export async function settleAgentTaskTeammateReply(
  deps: Pick<ExecutorDeps, "prisma" | "events" | "jobs">,
  requestRunId: string,
): Promise<TeammateReplyState> {
  const request = await deps.prisma.run.findUnique({
    where: { id: requestRunId },
    select: {
      id: true,
      spaceId: true,
      threadId: true,
      botId: true,
      userId: true,
      sourceMessageId: true,
      status: true,
      trigger: true,
      createdAt: true,
      botOutcomeReturnedAt: true,
      bot: { select: { name: true } },
    },
  });
  if (request?.trigger !== "bot_message" || request.botOutcomeReturnedAt) return "none";
  if (!["completed", "failed", "cancelled"].includes(request.status)) return "deferred";
  const context = await loadBotMessageContext(deps.prisma, request.sourceMessageId);
  const intent = context?.intent ?? "request";
  if (!context || (intent !== "request" && intent !== "question")) return "none";
  const taskIds = await agentTasksStartedByRun(deps.prisma, request.id);
  if (!taskIds.length) return "none";
  const scope = { spaceId: request.spaceId, userId: request.userId };
  const reportsOf = taskIds.map((taskId) => ({
    threadId: request.threadId,
    trigger: "task_report",
    clientNonce: { startsWith: taskReportNoncePrefix(taskId) },
  }));
  const pending = await deps.prisma.run.findFirst({
    where: {
      ...scope,
      status: { in: [...ACTIVE_RUN_STATUSES] },
      OR: [{ threadId: { in: taskIds } }, ...reportsOf],
    },
    select: { id: true },
  });
  if (pending) return "deferred";
  const lastReport = await deps.prisma.run.findFirst({
    where: { ...scope, createdAt: { gte: request.createdAt }, OR: reportsOf },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, status: true },
  });
  const answerOf = async (where: { threadId: string; runId?: string }) => {
    const messages = await deps.prisma.message.findMany({
      where: { ...where, role: "bot", thread: scope },
      select: { blocks: true },
      orderBy: { seq: "desc" },
      take: where.runId ? 20 : 5,
    });
    for (const message of messages) {
      const text = taskAnswerText(Array.isArray(message.blocks) ? (message.blocks as MessageBlock[]) : []);
      if (text) return text;
    }
    return "";
  };
  let text =
    lastReport?.status === "completed"
      ? await answerOf({ threadId: request.threadId, runId: lastReport.id })
      : "";
  const replyIntent = text ? ("result" as const) : ("status" as const);
  if (!text) {
    const parts: string[] = [];
    for (const threadId of taskIds) parts.push(await answerOf({ threadId }));
    text = interruptedTaskReply(parts);
  }
  const sent = await messageBot(
    deps,
    request,
    { id: request.botId, name: request.bot.name },
    {
      bot_id: context.fromBotId,
      message: clampBotMessage(text),
      intent: replyIntent,
      deliveryKey: `auto-outcome:${request.id}`,
    },
    { allowTerminalSource: true, forceUnread: replyIntent === "status" },
  );
  if (!sent.ok) return "failed";
  await markBotOutcomeReturned(deps.prisma, request.id);
  return "delivered";
}

/** After a report turn ends: answer the teammate whose request opened that task, if all are done. */
export async function settleTaskReportTeammate(
  deps: Pick<ExecutorDeps, "prisma" | "events" | "jobs">,
  reportRun: { clientNonce: string | null; spaceId: string; userId: string },
): Promise<TeammateReplyState> {
  const threadId = reportRun.clientNonce?.match(/^task-report:([^:]+):/)?.[1];
  if (!threadId) return "none";
  const thread = await deps.prisma.thread.findFirst({
    where: { id: threadId, spaceId: reportRun.spaceId, userId: reportRun.userId, startedBy: "agent" },
    select: { startedByRunId: true },
  });
  return thread?.startedByRunId ? settleAgentTaskTeammateReply(deps, thread.startedByRunId) : "none";
}

async function markBotOutcomeReturned(prisma: PrismaClient, runId: string) {
  await prisma.run.updateMany({
    where: {
      id: runId,
      status: { in: ["completed", "failed", "cancelled"] },
      botOutcomeReturnedAt: null,
    },
    data: { botOutcomeReturnedAt: new Date() },
  });
}

function isUniqueConstraintError(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
}
