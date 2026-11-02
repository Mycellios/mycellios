import { ORPCError } from "@orpc/server";
import type { Actor } from "@rakazo/contracts";
import { QUEUE_HOLDING_RUN_STATUSES } from "@rakazo/core";
import type { PrismaClient } from "@rakazo/db";
import { withSerializableRetry } from "./serializable-retry.js";
import type { ThreadTarget } from "./thread-target.js";

/** Retry the original turn, never a copy of the user's message or its attachments. */
export async function retryThreadRun(
  prisma: PrismaClient,
  actor: Actor,
  target: ThreadTarget,
  runId: string,
): Promise<void> {
  await withSerializableRetry(() => prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM threads WHERE id = ${target.threadId} FOR UPDATE`;
    const run = await tx.run.findFirst({
      where: {
        id: runId, threadId: target.threadId, spaceId: actor.spaceId, userId: actor.userId,
        botId: target.kind === "bot" ? target.botId : { in: target.memberBotIds },
      },
      include: { _count: { select: { effects: true } } },
    });
    if (!run) throw new ORPCError("NOT_FOUND");
    // Double-clicks and retries after a lost HTTP response reuse the same queued work.
    if (["queued", "running"].includes(run.status)) return;
    if (run.status !== "failed" || !run.sourceMessageId) {
      throw new ORPCError("CONFLICT", { message: "Only failed message requests can be retried." });
    }
    // Terminal cleanup may have removed a checkpoint. Restarting such a turn could replay
    // completed actions; do not guess that an effect was harmless or idempotent.
    const recordedOutput = await tx.message.count({ where: { runId: run.id, role: "bot" } });
    if (run._count.effects > 0 || run.firstResponseAt || recordedOutput > 0) {
      throw new ORPCError("CONFLICT", {
        message: "This request already produced output or actions. Continue in the chat to avoid repeating them.",
      });
    }
    await tx.$queryRaw`SELECT id FROM bots WHERE id = ${run.botId} FOR UPDATE`;
    const busy = await tx.run.findFirst({
      where: { botId: run.botId, id: { not: run.id }, status: { in: [...QUEUE_HOLDING_RUN_STATUSES] } },
      select: { id: true },
    });
    if (busy) throw new ORPCError("CONFLICT", { message: "Wait for the current task to finish before retrying." });
    await tx.run.update({
      where: { id: run.id },
      data: {
        status: "queued", error: null, startedAt: null, completedAt: null, wakeAt: null,
        leaseOwner: null, leaseExpiresAt: null, leaseFence: { increment: 1 },
      },
    });
    await tx.task.update({ where: { id: run.taskId }, data: { status: "queued" } });
  }, { isolationLevel: "Serializable" }));
}
