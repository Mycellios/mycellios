import type { Actor } from "@rakazo/contracts";
import type { Prisma, PrismaClient } from "./client.js";
import { IsolationError } from "./scope.js";
import { createThreadMessageInTransaction } from "./messages.js";
import { appendEventInTransaction } from "./events.js";
import { withTransactionRetry } from "./transaction-retry.js";
import { effectiveMicoSettings } from "@rakazo/contracts";
import { Prisma as PrismaValues } from "./client.js";

export class ThreadContextBusyError extends Error {
  constructor() { super("Wait for the current task to finish before starting a new chat."); this.name = "ThreadContextBusyError"; }
}
/** The same row lock as Send: no accepted message or live run can cross the reset. */
export async function resetThreadContext(prisma: PrismaClient, actor: Pick<Actor, "userId" | "spaceId">,
  input: { threadId: string; botId: string; clientNonce: string;
    agentRequest?: { runId: string; notes: string } }) {
  return withTransactionRetry(() => prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const thread = await tx.thread.update({
      where: { id: input.threadId, spaceId: actor.spaceId, userId: actor.userId,
        OR: [{ botId: input.botId }, { taskBotId: input.botId }] },
      data: { nextMessageSeq: { increment: 0 } }, select: { id: true },
    });
    if (!thread) throw new IsolationError();
    const clientNonce = `context-reset:${input.clientNonce}`;
    const replay = await tx.message.findUnique({ where: { threadId_clientNonce: { threadId: input.threadId, clientNonce } }, select: { id: true } });
    if (replay) return { eventSeq: null };
    if (input.agentRequest) {
      // Settings writers take this same owner lock before changing defaults/overrides.
      await tx.user.updateMany({ where: { id: actor.userId }, data: { micoSettingsVersion: { increment: 0 } } });
      const [pending, bot, user, origin] = await Promise.all([
        tx.thread.findUniqueOrThrow({ where: { id: input.threadId }, select: { agentContextReset: true } }),
        tx.bot.findFirst({ where: { id: input.botId, userId: actor.userId, spaceId: actor.spaceId, archivedAt: null }, select: { micoPreferences: true } }),
        tx.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { micoDefaults: true } }),
        tx.run.findFirst({ where: { id: input.agentRequest.runId, threadId: input.threadId, userId: actor.userId, spaceId: actor.spaceId, botId: input.botId }, select: { id: true, status: true } }),
      ]);
      const request = pending.agentContextReset as { runId?: string; notes?: string } | null;
      if (request?.runId !== input.agentRequest.runId || request.notes !== input.agentRequest.notes) return { eventSeq: null };
      if (!bot || !origin || ["failed", "cancelled"].includes(origin.status) || !effectiveMicoSettings(user.micoDefaults, bot.micoPreferences).agentNewChat) {
        await tx.thread.update({ where: { id: input.threadId }, data: { agentContextReset: PrismaValues.DbNull } });
        return { eventSeq: null };
      }
      if (origin.status !== "completed") return { eventSeq: null };
    }
    const [busy, queued] = await Promise.all([
      tx.run.findFirst({ where: { threadId: input.threadId, spaceId: actor.spaceId,
        status: { in: ["queued", "leased", "running", "waiting_input", "waiting_takeover"] } }, select: { id: true } }),
      tx.steeringMessage.findFirst({ where: { botId: input.botId, claimedAt: null,
        originTrigger: "queued_user", message: { threadId: input.threadId } }, select: { id: true } }),
    ]);
    if (busy || queued) throw new ThreadContextBusyError();
    const blocks = [{ kind: "context_reset" as const }];
    const message = await createThreadMessageInTransaction(tx, {
      threadId: input.threadId, botId: input.botId, role: "system", clientNonce, blocks, markUnread: false,
    });
    // The handoff is the first message of the fresh context, committed with the divider.
    if (input.agentRequest) {
      await createThreadMessageInTransaction(tx, {
        threadId: input.threadId, botId: input.botId, role: "system", markUnread: false,
        clientNonce: `${clientNonce}:notes`, blocks: [{ kind: "text", text: `Saved chat notes (context only, not new authorization):\n${input.agentRequest.notes}` }],
      });
    }
    await tx.thread.update({ where: { id: input.threadId }, data: {
      contextStartSeq: message.seq + 1,
      historyCompactedUpToSeq: message.seq,
      historyCompactionSummary: null,
      historyCompactionGeneration: { increment: 1 },
      agentContextReset: PrismaValues.DbNull,
    }, select: { id: true } });
    // A retry of an earlier failed run must not restore its old model transcript.
    await tx.run.updateMany({ where: { threadId: input.threadId, spaceId: actor.spaceId,
      status: { in: ["completed", "failed", "cancelled"] } }, data: { checkpoint: null } });
    const event = await appendEventInTransaction(tx, {
      spaceId: actor.spaceId, threadId: input.threadId, botId: input.botId,
      type: "thread.message.created", payload: { messageId: message.id, role: "system", blocks },
    });
    return { eventSeq: event.seq };
  }));
}
