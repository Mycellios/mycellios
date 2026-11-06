import type { Actor, Routine, RoutineCalendar, RoutineCalendarEntry } from "@rakazo/contracts";
import {
  isOneShotRoutineCrons,
  nextCronDateAcrossStrict,
  nextRoutineRunDateAcross,
  runFailureError,
} from "@rakazo/core";
import type { PrismaClient } from "@rakazo/db";
import { mapRoutine } from "./routines.js";

const LIMIT = 5000;
export function plannedRoutineEntries(
  routine: Routine,
  from: Date,
  to: Date,
  now: Date,
  limit = LIMIT,
): { entries: RoutineCalendarEntry[]; truncated: boolean; invalid: boolean } {
  const entries: RoutineCalendarEntry[] = [];
  if (!routine.crons.length || routine.watch) return { entries, truncated: false, invalid: false };
  const start = new Date(Math.max(from.getTime(), now.getTime()) - 1);
  try {
    new Intl.DateTimeFormat("en", { timeZone: routine.timezone }).format(now);
    const once = isOneShotRoutineCrons(routine.crons);
    const stored = routine.nextRunAt ? new Date(routine.nextRunAt) : null;
    if (stored && !Number.isFinite(stored.getTime())) throw new Error("Invalid stored occurrence");
    // A consumed one-shot has no future slot. Paused watches are checks, not scheduled executions.
    if (once) {
      if (stored && stored >= from && stored >= now && stored < to) {
        if (limit < 1) return { entries, truncated: true, invalid: false };
        entries.push({
          id: `${routine.id}@${stored.toISOString()}`,
          routineId: routine.id,
          at: stored.toISOString(),
          status: routine.active ? "scheduled" : "paused",
          projected: true,
          error: null,
        });
      }
      return { entries, truncated: false, invalid: false };
    }
    // Validate even when a saved first occurrence is available.
    nextCronDateAcrossStrict(routine.crons, start, routine.timezone);
    const anchor = stored ?? new Date(routine.lastRunAt ?? routine.createdAt);
    let next =
      stored && stored > start
        ? stored
        : routine.active
          ? nextRoutineRunDateAcross(routine.crons, anchor, start, routine.timezone)
          : nextCronDateAcrossStrict(routine.crons, start, routine.timezone);
    while (next && next < to) {
      if (entries.length >= limit) return { entries, truncated: true, invalid: false };
      if (next >= from && next >= now)
        entries.push({
          id: `${routine.id}@${next.toISOString()}`,
          routineId: routine.id,
          at: next.toISOString(),
          status: routine.active ? "scheduled" : "paused",
          projected: true,
          error: null,
        });
      const previous = next;
      next = nextRoutineRunDateAcross(routine.crons, previous, previous, routine.timezone);
      if (next && next <= previous) throw new Error("Non advancing schedule");
    }
    return { entries, truncated: false, invalid: false };
  } catch {
    return { entries, truncated: false, invalid: true };
  }
}

export async function routineCalendar(
  prisma: PrismaClient,
  actor: Actor,
  range: { from: string; to: string },
  now = new Date(),
): Promise<RoutineCalendar> {
  const from = new Date(range.from),
    to = new Date(range.to);
  const rows = await prisma.routine.findMany({
    where: { spaceId: actor.spaceId, userId: actor.userId, bot: { archivedAt: null } },
    orderBy: { id: "asc" },
    take: 1001,
  });
  const routines = rows.slice(0, 1000).map(mapRoutine);
  const runs = routines.length
    ? await prisma.run.findMany({
        where: {
          spaceId: actor.spaceId,
          userId: actor.userId,
          routineId: { in: routines.map((routine) => routine.id) },
          createdAt: { gte: from, lt: to },
          bot: { archivedAt: null },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: LIMIT + 1,
        select: { id: true, routineId: true, createdAt: true, status: true, error: true },
      })
    : [];
  const entries: RoutineCalendarEntry[] = runs.slice(0, LIMIT).map((run) => ({
    id: run.id,
    routineId: run.routineId!,
    at: run.createdAt.toISOString(),
    status: run.status as RoutineCalendarEntry["status"],
    projected: false,
    error: runFailureError({ type: `run.${run.status}`, payload: { error: run.error } }),
  }));
  let truncated = rows.length > 1000 || runs.length > LIMIT;
  const invalidRoutineIds: string[] = [];
  for (const routine of routines) {
    const planned = plannedRoutineEntries(
      routine,
      from,
      to,
      now,
      Math.max(0, LIMIT - entries.length),
    );
    entries.push(...planned.entries);
    if (planned.invalid) invalidRoutineIds.push(routine.id);
    truncated ||= planned.truncated;
  }
  entries.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  return { routines, entries, truncated, invalidRoutineIds, now: now.toISOString() };
}
