import type { Prisma, PrismaClient } from "./client.js";

/**
 * How many turns a Mico runs at once. A Pi Mico admits up to its conversation limit
 * (taskConcurrency, 1-4) of turns outside its main chat; the main chat is its own lane and
 * never waits behind them. Native engines run one turn at a time in total, main chat included:
 * each keeps one engine session and process for the Mico, so they cannot run two turns.
 */
export function micoTurnLimit(bot: { agentEngine: string; taskConcurrency: number }) {
  return bot.agentEngine === "pi" ? bot.taskConcurrency : 1;
}

/** Whether a Mico's turns in its main chat count toward its limit (only native engines). */
export function mainChatCountsTowardLimit(bot: { agentEngine: string }) {
  return bot.agentEngine !== "pi";
}

/** Run filter for the turns that use one of the Mico's conversation slots. */
export function slotRunsWhere(bot: {
  agentEngine: string;
  mainThreadId: string | null | undefined;
}): Prisma.RunWhereInput {
  return mainChatCountsTowardLimit(bot) || !bot.mainThreadId
    ? {}
    : { threadId: { not: bot.mainThreadId } };
}

/** Admission is atomic across worker processes; queued runs do not consume slots. */
export async function claimMicoRun(
  prisma: PrismaClient,
  run: { id: string; botId: string; spaceId: string; userId: string; threadId: string },
  where: Prisma.RunWhereInput,
  data: Prisma.RunUpdateManyMutationInput,
) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM bots WHERE id=${run.botId} AND "spaceId"=${run.spaceId} AND "userId"=${run.userId} FOR UPDATE`;
    const bot = await tx.bot.findFirst({
      where: { id: run.botId, spaceId: run.spaceId, userId: run.userId, archivedAt: null },
      select: { taskConcurrency: true, agentEngine: true, thread: { select: { id: true } } },
    });
    if (!bot) return { count: 0 };
    const live = {
      botId: run.botId,
      spaceId: run.spaceId,
      userId: run.userId,
      id: { not: run.id },
      status: { in: ["leased", "running"] },
      leaseExpiresAt: { gt: new Date() },
    };
    // The main chat's lane: one turn at a time there, never counted against the slots.
    const mainLane = !mainChatCountsTowardLimit(bot) && bot.thread?.id === run.threadId;
    if (
      (!mainLane &&
        (await tx.run.count({
          where: {
            ...live,
            ...slotRunsWhere({ agentEngine: bot.agentEngine, mainThreadId: bot.thread?.id }),
          },
        })) >= micoTurnLimit(bot)) ||
      (await tx.run.count({ where: { ...live, threadId: run.threadId } }))
    )
      return { count: 0 };
    return tx.run.updateMany({
      where: {
        AND: [
          where,
          {
            id: run.id,
            botId: run.botId,
            threadId: run.threadId,
            userId: run.userId,
            spaceId: run.spaceId,
          },
        ],
      },
      data,
    });
  });
}
