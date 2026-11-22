import { ORPCError } from "@orpc/server";
import type {
  Actor,
  RoutineHistory,
  RoutineMissedReason,
  RoutineRun,
  RoutineRunCursor,
} from "@mycellios/contracts";
import { ROUTINE_HISTORY_PAGE_SIZE, ROUTINE_MISSED_REASONS } from "@mycellios/contracts";
import {
  ROUTINE_FAILURE_REASON_MAX_LENGTH,
  routineRunSource,
  routineTimerScheduledAt,
  runFailureError,
} from "@mycellios/core";
import type { PrismaClient } from "@mycellios/db";
import { Prisma } from "@mycellios/db";

export async function listRoutineRuns(
  prisma: PrismaClient,
  actor: Actor,
  routineId: string,
  before?: RoutineRunCursor,
): Promise<RoutineHistory> {
  const routine = await prisma.routine.findFirst({
    where: {
      id: routineId,
      spaceId: actor.spaceId,
      userId: actor.userId,
      bot: { archivedAt: null },
    },
    select: { botId: true, watch: true },
  });
  if (!routine) throw new ORPCError("NOT_FOUND");

  const rows = await prisma.run.findMany({
    where: {
      routineId,
      botId: routine.botId,
      spaceId: actor.spaceId,
      userId: actor.userId,
      ...(before
        ? {
            OR: [
              { createdAt: { lt: new Date(before.createdAt) } },
              { createdAt: new Date(before.createdAt), id: { lt: before.id } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      botId: true,
      threadId: true,
      thread: { select: { groupId: true, taskBotId: true } },
      status: true,
      error: true,
      createdAt: true,
      startedAt: true,
      completedAt: true,
      trigger: true,
      clientNonce: true,
      retryOfRunId: true,
      quiet: true,
      missedRuns: true,
      missedReason: true,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: ROUTINE_HISTORY_PAGE_SIZE + 1,
  });
  const runs = rows.slice(0, ROUTINE_HISTORY_PAGE_SIZE);
  const last = runs.at(-1);
  const nextCursor =
    rows.length > ROUTINE_HISTORY_PAGE_SIZE && last
      ? { id: last.id, createdAt: last.createdAt.toISOString() }
      : null;
  // Routine runs can finish silently. A chat link is offered only when a message exists.
  const messages = runs.length
    ? await prisma.$queryRaw<Array<{ id: string; runId: string; threadId: string }>>(Prisma.sql`
        SELECT DISTINCT ON (m."runId") m.id, m."runId", m."threadId"
        FROM messages m
        INNER JOIN runs r ON r.id = m."runId" AND r."threadId" = m."threadId"
        INNER JOIN threads t ON t.id = m."threadId"
        WHERE r.id IN (${Prisma.join(runs.map((run) => run.id))})
          AND r."spaceId" = ${actor.spaceId} AND r."userId" = ${actor.userId}
          AND t."spaceId" = ${actor.spaceId} AND t."userId" = ${actor.userId}
          AND m.role = 'bot'
        ORDER BY m."runId", m."createdAt" DESC, m.id DESC
      `)
    : [];
  const replyByRun = new Map(messages.map((message) => [message.runId, message.id]));
  return {
    nextCursor,
    runs: runs.map((run) => ({
      id: run.id,
      botId: run.botId,
      groupId: run.thread.groupId,
      ...(run.thread.taskBotId === run.botId ? { taskThreadId: run.threadId } : {}),
      status: run.status as RoutineRun["status"],
      // A reason the run reported itself (up to 500 characters) is shown whole.
      error: runFailureError(
        { type: `run.${run.status}`, payload: { error: run.error } },
        ROUTINE_FAILURE_REASON_MAX_LENGTH,
      ),
      createdAt: run.createdAt.toISOString(),
      startedAt: run.startedAt?.toISOString() ?? null,
      completedAt: run.completedAt?.toISOString() ?? null,
      messageId: replyByRun.get(run.id) ?? null,
      source: routineRunSource(run, routine),
      scheduledFor: routineTimerScheduledAt(routineId, run.clientNonce)?.toISOString() ?? null,
      quiet: run.quiet === true,
      missed: missedRuns(run),
    })),
  };
}

function missedRuns(run: { missedRuns?: number | null; missedReason?: string | null }) {
  if (!run.missedRuns || run.missedRuns <= 0) return null;
  const reason = (ROUTINE_MISSED_REASONS as readonly string[]).includes(run.missedReason ?? "")
    ? (run.missedReason as RoutineMissedReason)
    : "offline";
  return { count: run.missedRuns, reason };
}
