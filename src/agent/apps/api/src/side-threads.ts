import { threadDeleteJob } from "@mycellios/adapter-kit";
import { scheduleLocalMemoryReview } from "@mycellios/adapters";
import type { Actor, SideThread } from "@mycellios/contracts";
import {
  deriveThreadState,
  THREAD_ARCHIVE_SETTLE_MS,
  THREAD_DELETE_GRACE_MS,
  THREAD_MAIN_CHAT_LIFECYCLE_ERROR,
  THREAD_OUTCOMES,
  THREAD_STARTED_BY,
  THREAD_TITLE_SOURCES,
  taskThreadKind,
  threadStartedByForKind,
  WAITING_ON_USER_RUN_STATUSES,
} from "@mycellios/core";
import {
  archiveSideThreadInTransaction,
  markSideThreadDeletedInTransaction,
  restoreSideThreadInTransaction,
  type SideThreadListRow,
  ThreadLifecycleError,
} from "@mycellios/db";
import { getLogger } from "@mycellios/logging";
import type { RouterDeps } from "./router.js";
import { stopThreadRuns, type ThreadTarget } from "./thread-target.js";
import { stopWorkForThread } from "./work-controls.js";

type BotTarget = Extract<ThreadTarget, { kind: "bot" }>;
type LifecycleDeps = Pick<RouterDeps, "prisma" | "sandbox" | "events" | "jobs">;

function sideThreadIds(target: BotTarget) {
  if (target.threadId === target.bot.thread?.id)
    throw new ThreadLifecycleError("main_chat", THREAD_MAIN_CHAT_LIFECYCLE_ERROR);
  return { botId: target.botId, threadId: target.threadId };
}

const pick = <T extends string>(values: readonly T[], value: string | null): T | null =>
  value !== null && (values as readonly string[]).includes(value) ? (value as T) : null;

/** One development.list row. Threads from before the lifecycle columns read as started by the person. */
export function sideThreadRow(row: SideThreadListRow): SideThread {
  const kind = taskThreadKind(row);
  return {
    threadId: row.id,
    projectKey: row.projectKey ?? "",
    taskKey: row.taskKey ?? "",
    title: row.title ?? "",
    kind,
    archived: Boolean(row.archivedAt),
    archivedAt: row.archivedAt?.toISOString() ?? null,
    deleteAfter: row.deleteAfter?.toISOString() ?? null,
    state: deriveThreadState({
      archivedAt: row.archivedAt,
      deleteAfter: row.deleteAfter,
      activeRunStatuses: row.activeStatuses ?? [],
    }),
    outcome: pick(THREAD_OUTCOMES, row.outcome),
    lastError: row.lastError,
    titleSource: pick(THREAD_TITLE_SOURCES, row.titleSource),
    startedBy: pick(THREAD_STARTED_BY, row.startedBy) ?? threadStartedByForKind(kind),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    unread: Boolean(row.unread),
    openWaits: row.openWaits ?? 0,
    ...(row.startedBy === "branch" ? { branchedFromThreadId: row.branchedFromThreadId ?? null } : {}),
    ...(row.memberUserId ? { memberUserId: row.memberUserId } : {}),
  };
}

/**
 * Archive from a Mico tab, Tasks or the phone: cancel the queued messages and runs, stop
 * delegated work, then archive under the thread lock that sends also take. Work that
 * starts again meanwhile is stopped again for up to 15 seconds; after that it fails with
 * an explanation and the conversation stays open.
 */
export async function archiveSideThread(
  deps: LifecycleDeps,
  actor: Actor,
  target: BotTarget,
  options: { settleMs?: number; pollMs?: number; sleep?: (ms: number) => Promise<void>; now?: () => number } = {},
) {
  const ids = sideThreadIds(target);
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadline = now() + (options.settleMs ?? THREAD_ARCHIVE_SETTLE_MS);
  for (;;) {
    await stopThreadRuns(deps, actor, target);
    // A request parked on await_event stays parked: its wait brings the conversation back.
    await stopWorkForThread(deps, actor, target.threadId, { keepEventWaits: true });
    try {
      const archived = await deps.prisma.$transaction((tx) => archiveSideThreadInTransaction(tx, actor, ids));
      await scheduleLocalMemoryReview(deps, ids.threadId).catch((error) => {
        getLogger().error("memory review enqueue failed after conversation archive", error);
      });
      return archived;
    } catch (error) {
      if (!(error instanceof ThreadLifecycleError) || error.code !== "busy" || now() >= deadline)
        throw error;
    }
    await sleep(options.pollMs ?? 500);
  }
}

/** Undo a pending delete, or reopen an archived conversation. */
export async function restoreSideThread(deps: Pick<RouterDeps, "prisma">, actor: Actor, target: BotTarget) {
  const ids = sideThreadIds(target);
  return deps.prisma.$transaction((tx) => restoreSideThreadInTransaction(tx, actor, ids));
}

/**
 * Hide a conversation the person started and schedule its removal once the undo window
 * and a short grace period have passed. The worker reconciler finishes it if the job is lost.
 * A turn that only waits for the person (a question, an approval, a takeover) holds no work,
 * so deleting cancels it first; a turn that is still working refuses the delete.
 */
export async function deleteSideThread(
  deps: LifecycleDeps,
  actor: Actor,
  target: BotTarget,
) {
  const ids = sideThreadIds(target);
  const waiting = await deps.prisma.run.findMany({
    where: { threadId: ids.threadId, status: { in: [...WAITING_ON_USER_RUN_STATUSES] } },
    select: { id: true },
  });
  if (waiting.length) await stopThreadRuns(deps, actor, target, waiting.map((run) => run.id));
  const result = await deps.prisma.$transaction((tx) => markSideThreadDeletedInTransaction(tx, actor, ids));
  await deps.jobs
    .enqueue(threadDeleteJob(ids.threadId, new Date(result.deleteAfter.getTime() + THREAD_DELETE_GRACE_MS)))
    .catch((error) => getLogger().error("thread delete enqueue failed; the reconciler retries", error));
  return result;
}
