import type { JobPublisher, SandboxProvider } from "@mycellios/adapter-kit";
import { runContinueJob } from "@mycellios/adapter-kit";
import {
  type Actor,
  MESSAGE_QUEUE_LIST_LIMIT,
  type MessageBlock,
  type MessageQueueState,
  type MessageQueueWaitReason,
} from "@mycellios/contracts";
import {
  ACTIVE_RUN_STATUSES,
  MessageQueueConflictError,
  normalizeRunError,
  QUEUE_HOLDING_RUN_STATUSES,
  queueHoldingFailure,
} from "@mycellios/core";
import type { Prisma, PrismaClient, ThreadEvents } from "@mycellios/db";
import {
  appendEventInTransaction,
  createThreadMessageInTransaction,
  deleteQueuedMessage,
  dispatchMessageQueue,
  holdQueuedMessage,
  listMessageQueue,
  lockQueueThread,
  type MessageQueueTarget,
  micoTurnLimit,
  moveQueuedMessageFirst,
  type QueuedMessageEntry,
  releaseQueuedMessageHold,
  reorderMessageQueue,
  saveQueuedMessageDraft,
  saveQueuedMessageEdit,
  slotRunsWhere,
  steerBlockFor,
  steerQueuedMessage,
  takeQueuedMessage,
} from "@mycellios/db";
import { getLogger } from "@mycellios/logging";
import { ORPCError } from "@orpc/server";
import { buildSendPrompt, resolveSendAttachments } from "./artifacts.js";
import { withResponseLanguage } from "./response-language.js";
import { stopThreadRuns, type ThreadTarget, threadLinkPrompt } from "./thread-target.js";

/**
 * The person's controls for the messages that wait in a conversation (specs/mico-message-queue):
 * Steer now, Send now, Edit, Delete, reorder and Move to a new conversation. Each action takes
 * the thread lock that sends take. No action here releases a human computer takeover, and the
 * running turn only receives a queued message through the explicit Steer now.
 */

type QueueDeps = {
  prisma: PrismaClient;
  events: ThreadEvents;
  jobs: JobPublisher;
  sandbox: SandboxProvider;
};

export function messageQueueTarget(actor: Actor, target: ThreadTarget): MessageQueueTarget {
  return {
    spaceId: actor.spaceId,
    threadId: target.threadId,
    botIds: target.kind === "bot" ? [target.botId] : target.memberBotIds,
  };
}

/** Queue conflicts reach the client as CONFLICT with a stable code it can explain. */
export async function queueAction<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof MessageQueueConflictError)
      throw new ORPCError("CONFLICT", { message: error.message, data: { queueCode: error.code } });
    throw error;
  }
}

async function wake(deps: Pick<QueueDeps, "jobs">, runIds: readonly string[]) {
  await Promise.all(
    runIds.map((runId) =>
      deps.jobs.enqueue(runContinueJob(runId)).catch((error) => {
        // The queued run is durable; the reconciler repairs a missed wake.
        getLogger().error("message queue wake", error);
      }),
    ),
  );
}

async function notify(
  deps: Pick<QueueDeps, "events">,
  threadId: string,
  seq: number | null | undefined,
) {
  if (seq == null) return;
  await deps.events.notify(threadId, seq).catch((error) => {
    // Subscribers catch up from the durable event cursor after a missed realtime wake.
    getLogger().error("message queue realtime notification", error);
  });
}

const textOf = (blocks: readonly MessageBlock[]) =>
  blocks.flatMap((block) => (block.kind === "text" ? [block.text] : [])).join("\n");

function firstAttachment(blocks: readonly MessageBlock[]) {
  const files = blocks.filter((block) => block.kind === "image" || block.kind === "file");
  const first = files[0];
  return {
    count: files.length,
    attachment:
      first && (first.kind === "image" || first.kind === "file")
        ? {
            kind: first.kind,
            artifactId: first.artifactId,
            mimeType: first.mimeType,
            name: first.name,
          }
        : undefined,
  };
}

/** Why the messages wait now; null while none waits. */
async function waitReason(
  tx: Prisma.TransactionClient,
  target: ThreadTarget,
  entries: readonly QueuedMessageEntry[],
  runs: ReadonlyArray<{
    botId: string;
    status: string;
    startedAt: Date | null;
    wakeAt: Date | null;
  }>,
): Promise<{ waiting: MessageQueueWaitReason | null; slots?: MessageQueueState["slots"] }> {
  if (!entries.length) return { waiting: null };
  const holding = runs.filter((run) =>
    QUEUE_HOLDING_RUN_STATUSES.some((status) => status === run.status),
  );
  if (!holding.length) {
    const thread = await tx.thread.findUnique({
      where: { id: target.threadId },
      select: { lastError: true },
    });
    const failure = queueHoldingFailure(thread?.lastError);
    if (failure) return { waiting: failure };
    return { waiting: entries[0]?.heldBy ? "held" : "busy" };
  }
  // A turn that has not started yet waits for a slot, a restart or a moment to begin.
  if (holding.some((run) => run.status !== "queued" || run.startedAt)) return { waiting: "busy" };
  const now = Date.now();
  if (holding.some((run) => run.wakeAt && run.wakeAt.getTime() > now))
    return { waiting: "restart" };
  if (target.kind !== "bot") return { waiting: "busy" };
  const bot = await tx.bot.findUnique({
    where: { id: target.botId },
    select: {
      agentEngine: true,
      taskConcurrency: true,
      computerSwitching: true,
      thread: { select: { id: true } },
    },
  });
  if (!bot) return { waiting: "busy" };
  if (bot.computerSwitching) return { waiting: "restart" };
  const thread = await tx.thread.findUnique({
    where: { id: target.threadId },
    select: { lastError: true },
  });
  if (thread?.lastError && normalizeRunError(thread.lastError).kind === "maintenance")
    return { waiting: "restart" };
  const slotsWhere = slotRunsWhere({ agentEngine: bot.agentEngine, mainThreadId: bot.thread?.id });
  // The main chat of a Pi Mico has its own lane and never waits for a slot.
  if ("threadId" in slotsWhere && bot.thread?.id === target.threadId) return { waiting: "busy" };
  const running = await tx.run.count({
    where: {
      botId: target.botId,
      status: { in: ["leased", "running"] },
      leaseExpiresAt: { gt: new Date() },
      ...slotsWhere,
    },
  });
  const limit = micoTurnLimit(bot);
  return running >= limit ? { waiting: "slot", slots: { running, limit } } : { waiting: "busy" };
}

export async function messageQueueState(
  prisma: PrismaClient,
  actor: Actor,
  target: ThreadTarget,
): Promise<MessageQueueState> {
  const queue = messageQueueTarget(actor, target);
  return prisma.$transaction(async (tx) => {
    const [entries, runs] = await Promise.all([
      listMessageQueue(tx, queue, MESSAGE_QUEUE_LIST_LIMIT),
      tx.run.findMany({
        where: {
          threadId: target.threadId,
          botId: { in: queue.botIds },
          status: { in: [...ACTIVE_RUN_STATUSES] },
        },
        select: {
          id: true,
          botId: true,
          status: true,
          trigger: true,
          startedAt: true,
          wakeAt: true,
        },
      }),
    ]);
    const blocked = steerBlockFor(runs);
    const reason = await waitReason(tx, target, entries, runs);
    return {
      messages: entries.map((entry) => {
        const { attachment, count } = firstAttachment(entry.blocks);
        return {
          messageId: entry.messageId,
          text: textOf(entry.blocks).slice(0, 1000),
          createdAt: entry.createdAt.toISOString(),
          ...(attachment ? { attachment } : {}),
          attachmentCount: count,
          editing: entry.heldBy
            ? {
                holdId: entry.heldBy,
                since: (entry.heldAt ?? entry.createdAt).toISOString(),
                draft: entry.editDraft,
              }
            : null,
          canMove:
            target.kind === "bot" && entry.rows.length === 1 && entry.userId === actor.userId,
        };
      }),
      waiting: reason.waiting,
      ...(reason.slots ? { slots: reason.slots } : {}),
      steer: blocked ? { available: false, blocked } : { available: true },
    };
  });
}

/** Steer now. Never releases a human takeover: a turn waiting on one takes the message when it resumes. */
export async function steerQueuedMessageNow(
  deps: QueueDeps,
  actor: Actor,
  target: ThreadTarget,
  messageId: string,
) {
  const queue = messageQueueTarget(actor, target);
  await queueAction(() =>
    deps.prisma.$transaction((tx) => steerQueuedMessage(tx, queue, { messageId })),
  );
  return { ok: true as const };
}

/** Send now: stop the turn here, then start this message next. */
export async function sendQueuedMessageNow(
  deps: QueueDeps & { stopWork?: (threadId: string) => Promise<void> },
  actor: Actor,
  target: ThreadTarget,
  messageId: string,
) {
  const queue = messageQueueTarget(actor, target);
  const { runIds } = await queueAction(() =>
    deps.prisma.$transaction((tx) => moveQueuedMessageFirst(tx, queue, { messageId })),
  );
  if (runIds.length) {
    // Only those turns: the rest of the queue keeps waiting (a full Stop clears it).
    await stopThreadRuns(deps, actor, target, runIds);
    await deps.stopWork?.(target.threadId);
  }
  const started = await deps.prisma.$transaction(async (tx) => {
    await lockQueueThread(tx, target.threadId);
    return dispatchMessageQueue(tx, queue, { preferMessageId: messageId });
  });
  await wake(deps, started);
  return { ok: true as const, ...(started[0] ? { runId: started[0] } : {}) };
}

/** After a change that may unblock the queue, start its next message if nothing runs. */
async function dispatchAfter(tx: Prisma.TransactionClient, queue: MessageQueueTarget) {
  return dispatchMessageQueue(tx, queue);
}

export async function deleteQueuedMessageNow(
  deps: QueueDeps,
  actor: Actor,
  target: ThreadTarget,
  input: { messageId: string; force?: boolean },
) {
  const queue = messageQueueTarget(actor, target);
  const { eventSeq, started } = await queueAction(() =>
    deps.prisma.$transaction(async (tx) => {
      const removed = await deleteQueuedMessage(tx, queue, input);
      return { eventSeq: removed.eventSeq, started: await dispatchAfter(tx, queue) };
    }),
  );
  await notify(deps, target.threadId, eventSeq);
  await wake(deps, started);
  return { ok: true as const };
}

export async function editQueuedMessage(
  deps: QueueDeps,
  actor: Actor,
  target: ThreadTarget,
  input: { messageId: string; holdId: string; takeOver?: boolean },
) {
  const queue = messageQueueTarget(actor, target);
  const held = await queueAction(() =>
    deps.prisma.$transaction((tx) => holdQueuedMessage(tx, queue, input)),
  );
  return { text: textOf(held.blocks), draft: held.draft };
}

export async function saveQueuedMessageDraftNow(
  deps: QueueDeps,
  actor: Actor,
  target: ThreadTarget,
  input: { messageId: string; holdId: string; draft: string },
) {
  const queue = messageQueueTarget(actor, target);
  await queueAction(() =>
    deps.prisma.$transaction((tx) => saveQueuedMessageDraft(tx, queue, input)),
  );
  return { ok: true as const };
}

export async function saveQueuedMessageEditNow(
  deps: QueueDeps,
  actor: Actor,
  target: ThreadTarget,
  input: { messageId: string; holdId: string; text: string },
) {
  const queue = messageQueueTarget(actor, target);
  const { eventSeq, started } = await queueAction(() =>
    deps.prisma.$transaction(async (tx) => {
      const saved = await saveQueuedMessageEdit(tx, queue, input);
      return { eventSeq: saved.eventSeq, started: await dispatchAfter(tx, queue) };
    }),
  );
  await notify(deps, target.threadId, eventSeq);
  await wake(deps, started);
  return { ok: true as const };
}

export async function cancelQueuedMessageEdit(
  deps: QueueDeps,
  actor: Actor,
  target: ThreadTarget,
  input: { messageId: string; holdId: string },
) {
  const queue = messageQueueTarget(actor, target);
  const { gone, started } = await deps.prisma.$transaction(async (tx) => {
    const released = await releaseQueuedMessageHold(tx, queue, input);
    return {
      gone: released.gone,
      started: released.released ? await dispatchAfter(tx, queue) : [],
    };
  });
  await wake(deps, started);
  return { ok: true as const, gone };
}

export async function reorderQueuedMessages(
  deps: QueueDeps,
  actor: Actor,
  target: ThreadTarget,
  input: { expected: string[]; order: string[] },
) {
  const queue = messageQueueTarget(actor, target);
  const started = await queueAction(() =>
    deps.prisma.$transaction(async (tx) => {
      await reorderMessageQueue(tx, queue, input);
      return dispatchAfter(tx, queue);
    }),
  );
  await wake(deps, started);
  return { ok: true as const };
}

/**
 * Move to a new conversation: the waiting message leaves this queue and starts a new side
 * conversation of the same Mico, titled from its first line like any first message (S1 rules),
 * in one transaction. A message that already started stays where it is.
 */
export async function moveQueuedMessageToConversation(
  deps: QueueDeps,
  actor: Actor,
  target: ThreadTarget,
  input: { messageId: string; responseLocale?: string },
) {
  const queue = messageQueueTarget(actor, target);
  const moved = await queueAction(() => {
    if (target.kind !== "bot") throw new MessageQueueConflictError("not_alone");
    return deps.prisma.$transaction(async (tx) => {
      const taken = await takeQueuedMessage(tx, queue, {
        messageId: input.messageId,
        userId: actor.userId,
      });
      const blocks = taken.entry.blocks;
      const text = textOf(blocks);
      const artifactIds = blocks.flatMap((block) =>
        block.kind === "image" || block.kind === "file" ? [block.artifactId] : [],
      );
      const { artifacts } = await resolveSendAttachments(
        { prisma: tx },
        actor,
        target.botId,
        artifactIds,
      );
      const links = blocks.flatMap((block) => (block.kind === "thread_link" ? [block] : []));
      const thread = await tx.thread.create({
        data: {
          spaceId: actor.spaceId,
          userId: actor.userId,
          taskBotId: target.botId,
          projectKey: `mico:${target.botId}`,
          // One conversation per moved message: a repeated move cannot open a second one.
          taskKey: `mico-task:${target.botId}:queue:${input.messageId}`,
          startedBy: "user",
        },
        // The Space and owner let content encryption seal the moved message before commit.
        select: { id: true, spaceId: true, userId: true },
      });
      // The first message names the conversation, as in any new conversation.
      const message = await createThreadMessageInTransaction(tx, {
        threadId: thread.id,
        role: "user",
        blocks,
      });
      const task = await tx.task.create({
        data: {
          spaceId: actor.spaceId,
          botId: target.botId,
          threadId: thread.id,
          userId: actor.userId,
          prompt: withResponseLanguage(
            threadLinkPrompt(buildSendPrompt(text, artifacts), links),
            input.responseLocale,
          ),
          status: "queued",
        },
      });
      const run = await tx.run.create({
        data: {
          spaceId: actor.spaceId,
          botId: target.botId,
          threadId: thread.id,
          taskId: task.id,
          userId: actor.userId,
          status: "queued",
          trigger: "user",
          sourceMessageId: message.id,
        },
      });
      await tx.message.update({ where: { id: message.id }, data: { runId: run.id } });
      const created = await appendEventInTransaction(tx, {
        spaceId: actor.spaceId,
        threadId: thread.id,
        botId: target.botId,
        type: "thread.message.created",
        runId: run.id,
        payload: {
          messageId: message.id,
          seq: message.seq,
          role: "user",
          blocks,
          runIds: [run.id],
        },
      });
      const removed = await taken.remove();
      const started = await dispatchMessageQueue(tx, queue);
      const titled = await tx.thread.findUniqueOrThrow({
        where: { id: thread.id },
        select: { title: true },
      });
      return {
        threadId: thread.id,
        runId: run.id,
        title: titled.title ?? "",
        createdSeq: created.seq,
        removedSeq: removed.eventSeq,
        started,
      };
    });
  });
  await notify(deps, moved.threadId, moved.createdSeq);
  await notify(deps, target.threadId, moved.removedSeq);
  await wake(deps, [moved.runId, ...moved.started]);
  return { threadId: moved.threadId, runId: moved.runId, title: moved.title };
}
