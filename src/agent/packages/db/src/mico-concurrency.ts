import type { Prisma, PrismaClient } from "./client.js";

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
      select: { taskConcurrency: true, agentEngine: true },
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
    const limit = bot.agentEngine === "pi" ? bot.taskConcurrency : 1;
    if (
      (await tx.run.count({ where: live })) >= limit ||
      (await tx.run.count({ where: { ...live, threadId: run.threadId } }))
    )
      return { count: 0 };
    return tx.run.updateMany({ where: { AND: [where, { id: run.id, botId: run.botId, threadId: run.threadId, userId: run.userId, spaceId: run.spaceId }] }, data });
  });
}
