import { ACTIVE_RUN_STATUSES } from "@mycellios/core";
import type { Prisma, PrismaClient } from "./client.js";
import { type EventWait, eventWaitState, ownWords } from "./event-waits.js";
import { IsolationError } from "./scope.js";
import { withTransactionRetry } from "./transaction-retry.js";
import { controlWorkTreeInTransaction } from "./work-controls.js";

type Scope = { spaceId: string; userId: string };

/**
 * Where an await_event wait stands, for its conversation card and its Mico:
 * - waiting: parked until its run, routine result or time;
 * - paused: its request was paused and nothing wakes it until it is resumed;
 * - woke: it ended, and its request continues once the turn still running there ends;
 * - continuing: it ended and its request is running again in its conversation;
 * - closed: cancelled, closed, or woken and already continued.
 */
export type EventWaitStatus = "waiting" | "paused" | "woke" | "continuing" | "closed";

/** How far back a woken or closed wait is still read. Older ones are always closed. */
const RECENT_WAIT_MS = 2 * 24 * 60 * 60 * 1000;
export const EVENT_WAIT_LIST_LIMIT = 50;
/** Every event wait's delegation key starts with this (see openEventWait). */
const EVENT_WAIT_KEY_PREFIX = "event-wait:";

type WaitRow = { delegationState: string | null; paused: boolean; returnedToParentAt: Date | null };
type ParentRow = { delegationState: string | null; paused: boolean } | null;

export function eventWaitStatus(wait: WaitRow, plan: EventWait, parent: ParentRow): EventWaitStatus {
  if (plan.closedAt || wait.delegationState === "cancelled") return "closed";
  if (wait.delegationState === "waiting_event") return wait.paused || parent?.paused ? "paused" : "waiting";
  if (wait.delegationState === "paused") return "paused";
  if (wait.delegationState !== "completed" && wait.delegationState !== "failed") return "closed";
  const parentState = parent?.delegationState ?? "";
  // Handed back to its request: it continues while that request runs, then it is done.
  if (wait.returnedToParentAt) return parentState === "running" ? "continuing" : "closed";
  return parent && !["completed", "failed", "cancelled"].includes(parentState) ? "woke" : "closed";
}

export type EventWaitView = {
  waitId: string;
  threadId: string;
  /** The Mico's own note from when it parked the request. */
  note: string;
  /** The request it parked, without what the work tree added for later turns. */
  request: string;
  openedAt: string;
  expiresAt: string;
  timeoutMinutes: number;
  routineId?: string;
  routineName?: string;
  runId?: string;
  resumeAt?: string;
  status: EventWaitStatus;
  outcome?: EventWait["outcome"];
  settledAt?: string;
  closedAt?: string;
  closedBy?: EventWait["closedBy"];
  thread: { title: string | null; main: boolean; archived: boolean };
};

/**
 * The waits one Mico opened, newest first: in the given conversations, or in all of its own.
 * Closed ones only on request, and only from the last two days.
 */
export async function listEventWaits(
  prisma: Pick<PrismaClient, "task" | "routine">,
  scope: Scope & { botId: string },
  input: { threadIds?: readonly string[]; includeClosed?: boolean; limit?: number } = {},
  now = new Date(),
): Promise<EventWaitView[]> {
  const since = new Date(now.getTime() - RECENT_WAIT_MS);
  const ended = input.includeClosed ? ["completed", "failed", "cancelled"] : ["completed", "failed"];
  const rows = await prisma.task.findMany({
    where: {
      spaceId: scope.spaceId, userId: scope.userId, botId: scope.botId,
      delegationKey: { startsWith: EVENT_WAIT_KEY_PREFIX },
      ...(input.threadIds ? { threadId: { in: [...input.threadIds] } } : {}),
      OR: [
        { delegationState: { in: ["waiting_event", "paused"] } },
        { delegationState: { in: ended }, updatedAt: { gte: since } },
      ],
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: Math.min(Math.max(input.limit ?? EVENT_WAIT_LIST_LIMIT, 1), 100),
    select: {
      id: true, threadId: true, prompt: true, workPlan: true, delegationState: true, paused: true,
      returnedToParentAt: true,
      workParent: { select: { prompt: true, delegationState: true, paused: true } },
      thread: { select: { title: true, botId: true, archivedAt: true } },
    },
  });
  const waits = rows.flatMap(row => {
    const plan = eventWaitState(row.workPlan);
    if (!plan) return [];
    const status = eventWaitStatus(row, plan, row.workParent);
    return status === "closed" && !input.includeClosed ? [] : [{ row, plan, status }];
  });
  const routineIds = [...new Set(waits.flatMap(({ plan }) => plan.routineId ? [plan.routineId] : []))];
  const routines = routineIds.length ? await prisma.routine.findMany({
    where: { id: { in: routineIds }, spaceId: scope.spaceId, userId: scope.userId, botId: scope.botId },
    select: { id: true, name: true },
  }) : [];
  return waits.map(({ row, plan, status }) => {
    const routineName = routines.find(routine => routine.id === plan.routineId)?.name;
    return {
      waitId: row.id,
      threadId: row.threadId,
      note: ownWords(row.prompt),
      request: row.workParent ? ownWords(row.workParent.prompt) : "",
      openedAt: plan.openedAt,
      expiresAt: plan.expiresAt,
      timeoutMinutes: Math.max(1, Math.round((Date.parse(plan.expiresAt) - Date.parse(plan.openedAt)) / 60_000)),
      ...(plan.routineId ? { routineId: plan.routineId, ...(routineName ? { routineName } : {}) } : {}),
      ...(plan.runId ? { runId: plan.runId } : {}),
      ...(plan.resumeAt ? { resumeAt: plan.resumeAt } : {}),
      status,
      ...(plan.outcome ? { outcome: plan.outcome } : {}),
      ...(plan.settledAt ? { settledAt: plan.settledAt } : {}),
      ...(plan.closedAt ? { closedAt: plan.closedAt, closedBy: plan.closedBy } : {}),
      thread: { title: row.thread.title, main: row.thread.botId === scope.botId, archived: Boolean(row.thread.archivedAt) },
    };
  });
}

export type CloseEventWaitResult = {
  waitId: string;
  /** Nothing of this wait can wake its request any more. */
  closed: boolean;
  /** It was already closed before this call. */
  alreadyClosed: boolean;
  /** This call stopped a wait that had not woken yet. */
  cancelled: boolean;
  status: EventWaitStatus;
};

/**
 * Closes one wait, idempotently, under the scoped work lock the reconciler takes, so a wait
 * that wakes at the same moment either wakes or is cancelled, never both:
 * - a wait that has not woken goes through the existing durable tree cancellation; when its
 *   request has nothing else on the way, that request ends as cancelled instead of waking for it;
 * - a wait that already woke is not cancelled: the person is told so, its Mico may mark it closed;
 * - a closed wait reports that it was already closed.
 * A Mico passes its own botId (and the conversations it may read); the person's card passes none.
 */
export async function closeEventWait(
  prisma: PrismaClient,
  scope: Scope & { botId?: string; threadIds?: readonly string[] },
  input: { waitId: string; by: "mico" | "person" },
  now = new Date(),
): Promise<CloseEventWaitResult> {
  return withTransactionRetry(() => prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`work:${scope.spaceId}:${scope.userId}`}, 0))`;
    const wait = await tx.task.findFirst({
      where: {
        id: input.waitId, spaceId: scope.spaceId, userId: scope.userId,
        delegationKey: { startsWith: EVENT_WAIT_KEY_PREFIX },
        ...(scope.botId ? { botId: scope.botId } : {}),
        ...(scope.threadIds ? { threadId: { in: [...scope.threadIds] } } : {}),
      },
      include: { workParent: { select: { id: true, delegationState: true, paused: true } } },
    });
    const plan = wait ? eventWaitState(wait.workPlan) : undefined;
    if (!wait || !plan) throw new IsolationError("This wait is not available");
    const status = eventWaitStatus(wait, plan, wait.workParent);
    const result = (closed: boolean, cancelled: boolean, next: EventWaitStatus) =>
      ({ waitId: wait.id, closed, alreadyClosed: false, cancelled, status: next });
    if (status === "closed") return { ...result(true, false, "closed"), alreadyClosed: true };
    const closedPlan = { ...plan, closedAt: now.toISOString(), closedBy: input.by } as unknown as Prisma.InputJsonValue;
    if (status === "woke" || status === "continuing") {
      // Its event already arrived: there is nothing left to cancel.
      if (input.by === "person") return result(false, false, status);
      await tx.task.update({ where: { id: wait.id }, data: { workPlan: closedPlan } });
      return result(true, false, "closed");
    }
    await controlWorkTreeInTransaction(tx, scope, {
      taskId: wait.id, expectedRevision: wait.delegationRevision, action: "cancel",
    });
    // Also when a pause was still being torn down and the control skipped it: resume must not revive it.
    await tx.task.update({ where: { id: wait.id }, data: {
      status: "cancelled", delegationState: "cancelled", paused: true, workPlan: closedPlan,
    } });
    const parent = wait.workParent;
    if (parent?.delegationState === "waiting" && !parent.paused) {
      // The same "finished" set the reconciler uses before it wakes a parent.
      const others = await tx.task.count({ where: { parentTaskId: parent.id, spaceId: scope.spaceId, userId: scope.userId,
        id: { not: wait.id }, NOT: { delegationState: { in: ["completed", "failed", "cancelled", "paused"] } } } });
      const active = await tx.run.count({ where: { taskId: parent.id, spaceId: scope.spaceId, userId: scope.userId, OR: [
        { status: { in: [...ACTIVE_RUN_STATUSES] } }, { leaseOwner: { not: null }, leaseExpiresAt: { gt: now } },
      ] } });
      if (!others && !active) await tx.task.update({ where: { id: parent.id }, data: {
        delegationState: "cancelled", delegationRevision: { increment: 1 },
      } });
    }
    return result(true, true, "closed");
  }, { maxWait: 5000, timeout: 20000 }));
}
