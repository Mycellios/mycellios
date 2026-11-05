import type { Actor } from "@rakazo/contracts";
import type { PrismaClient } from "./client.js";
import { IsolationError } from "./scope.js";

/** One owned conversation per routine; old messages stay in their original chat. */
export async function ensureRoutineThread(prisma: PrismaClient, actor: Pick<Actor, "spaceId" | "userId">, routineId: string) {
  const scope = { spaceId: actor.spaceId, userId: actor.userId };
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM routines WHERE id = ${routineId} AND "spaceId" = ${actor.spaceId} AND "userId" = ${actor.userId} FOR UPDATE`;
    const routine = await tx.routine.findFirst({ where: {
      id: routineId, spaceId: actor.spaceId, userId: actor.userId, bot: { archivedAt: null },
    }, select: { id: true, name: true, botId: true, threadId: true } });
    if (!routine) throw new IsolationError();
    if (routine.threadId) {
      const target = await tx.thread.findFirst({ where: {
        id: routine.threadId, spaceId: actor.spaceId, userId: actor.userId,
        OR: [{ botId: routine.botId }, { taskBotId: routine.botId },
          { group: { archivedAt: null, members: { some: { botId: routine.botId } } } }],
      }, select: { id: true, taskBotId: true, taskKey: true, projectKey: true } });
      if (!target) throw new IsolationError("The routine conversation is no longer available");
      const key = `routine:${routine.id}`;
      return { id: target.id, privateRoutine: target.taskBotId === routine.botId && target.taskKey === key && target.projectKey === key };
    }
    const key = `routine:${routine.id}`;
    const thread = await tx.thread.create({
      data: { ...scope, taskBotId: routine.botId, projectKey: key, taskKey: key, title: routine.name.slice(0, 100) },
    });
    if (thread.taskBotId !== routine.botId || thread.projectKey !== key || thread.botId || thread.groupId || thread.externalConversationId)
      throw new IsolationError("The routine conversation identity is already in use");
    await tx.routine.update({ where: { id: routine.id }, data: { threadId: thread.id } });
    return { id: thread.id, privateRoutine: true };
  });
}

/** Internal routine threads reuse the Mico's admitted workspace, never a fabricated project grant. */
export async function isOwnedRoutineThread(prisma: PrismaClient, actor: Pick<Actor, "spaceId" | "userId">, thread: {
  id: string; taskBotId?: string | null; projectKey?: string | null; taskKey?: string | null;
}) {
  if (!thread.taskBotId || !thread.taskKey?.startsWith("routine:") || thread.projectKey !== thread.taskKey) return false;
  return Boolean(await prisma.routine.findFirst({ where: {
    id: thread.taskKey.slice("routine:".length), threadId: thread.id, botId: thread.taskBotId,
    userId: actor.userId, spaceId: actor.spaceId, bot: { archivedAt: null },
  }, select: { id: true } }));
}
