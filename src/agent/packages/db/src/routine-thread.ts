import type { Actor } from "@mycellios/contracts";
import type { Prisma, PrismaClient } from "./client.js";
import { IsolationError } from "./scope.js";

type Tx = Pick<Prisma.TransactionClient, "$executeRaw">;

/** A routine conversation is titled with the routine's name, cut like its first title. */
export function routineThreadTitle(name: string): string {
  return name.slice(0, 100);
}

/**
 * One owned conversation per routine; old messages stay in their original chat. A run brings
 * an archived routine conversation back, unless `reopen` is false (a change trigger checks
 * first and reopens only when it starts a run).
 */
export async function ensureRoutineThread(
  prisma: PrismaClient,
  actor: Pick<Actor, "spaceId" | "userId">,
  routineId: string,
  options: { reopen?: boolean } = {},
) {
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
      const privateRoutine = target.taskBotId === routine.botId && target.taskKey === key && target.projectKey === key;
      if (privateRoutine && options.reopen !== false) await reopenRoutineThreadInTransaction(tx, scope, target.id);
      return { id: target.id, privateRoutine };
    }
    const key = `routine:${routine.id}`;
    const thread = await tx.thread.create({
      data: { ...scope, taskBotId: routine.botId, projectKey: key, taskKey: key, title: routineThreadTitle(routine.name), titleSource: "auto", startedBy: "routine" },
    });
    if (thread.taskBotId !== routine.botId || thread.projectKey !== key || thread.botId || thread.groupId || thread.externalConversationId)
      throw new IsolationError("The routine conversation identity is already in use");
    await tx.routine.update({ where: { id: routine.id }, data: { threadId: thread.id } });
    return { id: thread.id, privateRoutine: true };
  });
}

/**
 * Brings an archived routine conversation back for a run, under the thread lock sends and
 * archive take, and clears the Tasks mirror. A conversation being deleted stays as it is.
 */
export async function reopenRoutineThreadInTransaction(
  tx: Tx,
  scope: Pick<Actor, "spaceId" | "userId">,
  threadId: string,
): Promise<boolean> {
  const reopened = await tx.$executeRaw`
    UPDATE threads SET "archivedAt" = NULL
    WHERE id = ${threadId} AND "spaceId" = ${scope.spaceId} AND "userId" = ${scope.userId}
      AND "archivedAt" IS NOT NULL AND "deleteAfter" IS NULL AND "taskKey" LIKE 'routine:%'`;
  if (!reopened) return false;
  await tx.$executeRaw`
    UPDATE task_inbox SET "archivedAt" = NULL, "reminderClaimedAt" = NULL
    WHERE "threadId" = ${threadId} AND "spaceId" = ${scope.spaceId} AND "userId" = ${scope.userId}`;
  return true;
}

type RoutineIdentity = {
  id: string;
  botId: string;
  spaceId: string;
  userId: string;
  threadId: string | null;
};

/**
 * The routine's own conversation follows a rename, unless the person named it themselves.
 * Older routine targets (the main chat or a group) never change their title.
 */
export async function followRoutineRenameInTransaction(
  tx: Tx,
  routine: RoutineIdentity & { name: string },
): Promise<boolean> {
  if (!routine.threadId) return false;
  const title = routineThreadTitle(routine.name);
  const renamed = await tx.$executeRaw`
    UPDATE threads SET title = ${title}, "titleSource" = COALESCE("titleSource", 'auto')
    WHERE id = ${routine.threadId} AND "spaceId" = ${routine.spaceId} AND "userId" = ${routine.userId}
      AND "taskBotId" = ${routine.botId} AND "taskKey" = ${`routine:${routine.id}`}
      AND "titleSource" IS DISTINCT FROM 'user' AND title IS DISTINCT FROM ${title}`;
  return renamed > 0;
}

/**
 * Deleting a routine archives its own conversation in the same transaction, so its history
 * stays readable under Archived. Work still running there is not stopped: it finishes in the
 * archived conversation. The main chat and group targets are never archived.
 */
export async function archiveRoutineThreadInTransaction(
  tx: Tx,
  routine: RoutineIdentity,
  now = new Date(),
): Promise<boolean> {
  if (!routine.threadId) return false;
  const archived = await tx.$executeRaw`
    UPDATE threads SET "archivedAt" = ${now}
    WHERE id = ${routine.threadId} AND "spaceId" = ${routine.spaceId} AND "userId" = ${routine.userId}
      AND "taskBotId" = ${routine.botId} AND "taskKey" = ${`routine:${routine.id}`}
      AND "botId" IS NULL AND "archivedAt" IS NULL AND "deleteAfter" IS NULL`;
  if (!archived) return false;
  await tx.$executeRaw`
    UPDATE task_inbox SET "archivedAt" = COALESCE("archivedAt", ${now}), pinned = false,
      "remindAt" = NULL, "reminderClaimedAt" = NULL
    WHERE "threadId" = ${routine.threadId} AND "spaceId" = ${routine.spaceId} AND "userId" = ${routine.userId}`;
  return true;
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
