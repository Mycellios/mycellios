import type { MessageBlock } from "@mycellios/contracts";
import { automaticThreadTitle, isMicoTaskThread, THREAD_BEING_DELETED_ERROR } from "@mycellios/core";
import type { Prisma, PrismaClient } from "./client.js";
import { ThreadLifecycleError } from "./thread-lifecycle.js";
import { withTransactionRetry } from "./transaction-retry.js";

/** Group turns use channel inputs and their own outputs, never private thread history. */
export function loadRunHistoryMessages(
  prisma: PrismaClient,
  run: { id: string; threadId: string },
  limit: number,
  channelId?: string,
  contextStartSeq = 0,
) {
  return prisma.message.findMany({
    where: {
      threadId: run.threadId,
      ...(contextStartSeq > 0 ? { seq: { gte: contextStartSeq } } : {}),
      // Queued messages (the person's, or a follow-up from the Mico's main chat) join history
      // only with the turn that answers them.
      NOT: { steeringMessages: { some: { originTrigger: { in: ["queued_user", "agent_task"] }, claimedAt: null, OR: [{ runId: null }, { runId: { not: run.id } }] } } },
      // A routine run marker only links the main chat to the routine conversation.
      AND: [{ NOT: { role: "system", blocks: { array_contains: [{ kind: "routine_run" }] } } }],
      ...(channelId
        ? {
            OR: [
              {
                role: "user",
                blocks: { array_contains: [{ kind: "channel_message", channelId }] },
              },
              { role: "bot", runId: run.id },
            ],
          }
        : {}),
    },
    orderBy: { seq: "desc" },
    take: limit,
    select: {
      id: true,
      threadId: true,
      seq: true,
      role: true,
      botId: true,
      runId: true,
      blocks: true,
      createdAt: true,
      replyToMessageId: true,
      replyQuote: true,
      replyTo: { select: { id: true, threadId: true, role: true, botId: true, blocks: true } },
      clientNonce: true,
    },
  });
}

/** Marks the bot message that keeps the reply text of a run that failed partway through it. */
export function partialReplyClientNonce(runId: string): string {
  return `partial-reply:${runId}`;
}

export function isPartialReplyClientNonce(clientNonce: string | null | undefined): boolean {
  return Boolean(clientNonce?.startsWith("partial-reply:"));
}

export interface CreateThreadMessageInput {
  threadId: string;
  role: "user" | "bot" | "system";
  blocks: MessageBlock[];
  botId?: string;
  replyToMessageId?: string;
  replyQuote?: string;
  runId?: string;
  clientNonce?: string;
  markUnread?: boolean;
  /** Terminal echo after the run is already cancelled. Every other write stays rejected. */
  allowCancelledRun?: boolean;
}

export async function createThreadMessage(prisma: PrismaClient, input: CreateThreadMessageInput) {
  return withTransactionRetry(() =>
    prisma.$transaction((tx: Prisma.TransactionClient) =>
      createThreadMessageInTransaction(tx, input),
    ),
  );
}

export async function createThreadMessageInTransaction(
  tx: Prisma.TransactionClient,
  input: CreateThreadMessageInput,
) {
  const thread = await tx.thread.update({
    where: { id: input.threadId },
    data: {
      nextMessageSeq: { increment: 1 },
      unread: (input.markUnread ?? input.role === "bot") ? true : undefined,
      // The person's next message starts the next turn, which clears the last turn's result.
      ...(input.role === "user" ? { outcome: null, lastError: null } : {}),
    },
    select: { nextMessageSeq: true, title: true, taskBotId: true, projectKey: true, taskKey: true, deleteAfter: true },
  });
  // The row lock above waits for a concurrent delete, so a deleting thread never gets new history.
  if (thread.deleteAfter) throw new ThreadLifecycleError("deleting", THREAD_BEING_DELETED_ERROR);
  await assertRunCanWriteHistory(tx, input.runId, { allowCancelled: input.allowCancelledRun });
  if (input.role === "user" && thread.title === null && isMicoTaskThread(thread)) {
    // First line or first file name, without a model. Only an empty title is filled, so a
    // title someone typed (never empty) is never replaced.
    const title = automaticThreadTitle(input.blocks);
    if (title) await tx.thread.updateMany({
      where: { id: input.threadId, title: null },
      data: { title, titleSource: "auto" },
    });
  }
  return tx.message.create({
    data: {
      threadId: input.threadId,
      seq: thread.nextMessageSeq - 1,
      role: input.role,
      blocks: input.blocks as Prisma.InputJsonValue,
      botId: input.botId,
      replyToMessageId: input.replyToMessageId,
      replyQuote: input.replyQuote,
      runId: input.runId,
      clientNonce: input.clientNonce,
    },
  });
}

export class RunHistoryWriteError extends Error {
  constructor() {
    super("Run cannot write thread history");
    this.name = "RunHistoryWriteError";
  }
}

export async function assertRunCanWriteHistory(
  tx: Prisma.TransactionClient,
  runId?: string,
  options?: { allowCancelled?: boolean },
): Promise<
  | { status: string; startedAt: Date | null; firstResponseAt: Date | null; userId: string }
  | undefined
> {
  if (!runId) return;
  const run = await tx.run.findUnique({
    where: { id: runId },
    select: { status: true, startedAt: true, firstResponseAt: true, userId: true },
  });
  if (!run || (run.status === "cancelled" && !options?.allowCancelled)) {
    throw new RunHistoryWriteError();
  }
  return run;
}

/**
 * run.cancelled is recorded by the path that cancelled the run, after the row
 * already reads cancelled — where the liveness assert above would reject it.
 * The event must name its run (clients key off it) and the row must already be
 * cancelled, so it can never announce a cancellation nothing committed.
 */
export async function assertRunIsCancelled(
  tx: Prisma.TransactionClient,
  runId?: string,
): Promise<void> {
  if (!runId) throw new RunHistoryWriteError();
  const run = await tx.run.findUnique({
    where: { id: runId },
    select: { status: true },
  });
  if (run?.status !== "cancelled") {
    throw new RunHistoryWriteError();
  }
}
