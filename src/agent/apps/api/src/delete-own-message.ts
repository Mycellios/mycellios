import { ORPCError } from "@orpc/server";
import type { Actor, MessageBlock } from "@mycellios/contracts";
import { ACTIVE_RUN_STATUSES, automaticThreadTitle, isMicoTaskThread } from "@mycellios/core";
import { appendEventInTransaction, Prisma, withTransactionRetry, type PrismaClient } from "@mycellios/db";

export async function deleteOwnMessage(
  prisma: PrismaClient,
  { spaceId, userId }: Pick<Actor, "spaceId" | "userId">,
  target: { threadId: string; botId: string },
  messageId: string,
) {
  const actor = { spaceId, userId };
  return withTransactionRetry(() => prisma.$transaction(async (tx) => {
    // This is the same row lock taken by Send and the queue.
    const thread = await tx.thread.update({
      where: { id: target.threadId, ...actor, OR: [{ botId: target.botId }, { taskBotId: target.botId }] },
      data: { nextMessageSeq: { increment: 0 } },
    });
    if (thread.deleteAfter || thread.externalConversationId ||
        (!thread.botId && !isMicoTaskThread(thread))) throw new ORPCError("NOT_FOUND");
    const message = await tx.message.findFirst({
      where: { id: messageId, threadId: target.threadId, role: "user",
        sourceRuns: { some: { ...actor, botId: target.botId, trigger: "user" } } },
      select: { seq: true, blocks: true, sourceRuns: {
        where: { ...actor, botId: target.botId, trigger: "user" }, select: { id: true, taskId: true },
      } },
    });
    if (!message) throw new ORPCError("NOT_FOUND");
    const busy = await tx.run.findFirst({
      where: { threadId: target.threadId, status: { in: [...ACTIVE_RUN_STATUSES] } },
      select: { id: true },
    });
    const queued = await tx.steeringMessage.findFirst({
      where: { message: { threadId: target.threadId }, originTrigger: "queued_user", claimedAt: null },
      select: { id: true },
    });
    if (busy || queued) {
      throw new ORPCError("CONFLICT", { message: "Wait until the conversation and its queue are idle." });
    }

    // Keep the sequence and send nonce so cursor boundaries and delayed retries stay valid.
    await tx.message.update({
      where: { id: messageId },
      data: { role: "system", blocks: [], replyToMessageId: null, replyQuote: null },
    });
    await tx.messagePin.deleteMany({ where: { threadId: target.threadId, messageId } });
    await tx.message.updateMany({
      where: { threadId: target.threadId, replyToMessageId: messageId },
      data: { replyToMessageId: null, replyQuote: null },
    });
    await tx.task.updateMany({
      where: { ...actor, threadId: target.threadId, id: { in: message.sourceRuns.map(run => run.taskId) } },
      data: { prompt: "Message deleted" },
    });
    await tx.run.updateMany({
      where: { id: { in: message.sourceRuns.map(run => run.id) } },
      data: { sourceMessageId: null },
    });
    // messageId is a queryable key even when the rest of the event is encrypted.
    await tx.$executeRaw`
      UPDATE events SET payload = jsonb_build_object(
        'messageId', ${messageId}::text, 'seq', ${message.seq}::int, 'role', 'system', 'blocks', '[]'::jsonb)
      WHERE "threadId" = ${target.threadId} AND "spaceId" = ${actor.spaceId}
        AND type IN ('thread.message.created', 'thread.message.updated')
        AND payload->>'messageId' = ${messageId}`;
    await tx.thread.update({
      where: { id: target.threadId },
      data: {
        ...(thread.titleSource === "auto" &&
          thread.title === automaticThreadTitle(message.blocks as MessageBlock[])
          ? { title: null, titleSource: null } : {}),
        historyCompactionGeneration: { increment: 1 },
        historyCompactedUpToSeq: thread.contextStartSeq > 0 ? thread.contextStartSeq - 1 : null,
        historyCompactionSummary: null,
        agentContextReset: Prisma.DbNull,
      },
    });
    await tx.run.updateMany({ where: { ...actor, threadId: target.threadId }, data: { checkpoint: null } });
    const event = await appendEventInTransaction(tx, {
      spaceId: actor.spaceId, botId: target.botId, threadId: target.threadId,
      type: "thread.message.deleted", payload: { messageId, seq: message.seq },
    });
    return event.seq;
  }));
}
