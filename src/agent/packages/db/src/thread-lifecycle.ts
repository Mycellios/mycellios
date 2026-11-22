import type { Actor } from "@mycellios/contracts";
import {
  ACTIVE_RUN_STATUSES,
  BACKGROUND_RUN_TRIGGERS,
  boundThreadError,
  THREAD_ALREADY_DELETED_ERROR,
  THREAD_BEING_DELETED_ERROR,
  THREAD_DELETE_UNDO_MS,
  THREAD_DELETE_WHILE_WORKING_ERROR,
  THREAD_MAIN_CHAT_LIFECYCLE_ERROR,
  THREAD_STILL_WORKING_ERROR,
  type ThreadOutcome,
  taskThreadKind,
} from "@mycellios/core";
import { Prisma } from "./client.js";
import type { PrismaClient } from "./client.js";

type Scope = Pick<Actor, "userId" | "spaceId">;
type Tx = Pick<Prisma.TransactionClient, "$queryRaw" | "$executeRaw">;

export type ThreadLifecycleErrorCode =
  | "not_found"
  | "main_chat"
  | "not_deletable"
  | "busy"
  | "deleting"
  | "deleted";

/** A refused lifecycle change. Routes map the code to a status and show the message. */
export class ThreadLifecycleError extends Error {
  constructor(
    readonly code: ThreadLifecycleErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ThreadLifecycleError";
  }
}

const ACTIVE = Prisma.join([...ACTIVE_RUN_STATUSES]);
const BACKGROUND = Prisma.join([...BACKGROUND_RUN_TRIGGERS]);
/** Delegated work that is still on its way keeps its parent conversation from being deleted. */
const UNFINISHED_DELEGATION = Prisma.join(["queued", "running", "waiting", "waiting_event", "paused"]);

export interface LockedSideThread {
  id: string;
  taskBotId: string | null;
  startedBy?: string | null;
  botId: string | null;
  projectKey: string | null;
  taskKey: string | null;
  archivedAt: Date | null;
  deleteAfter: Date | null;
}

/**
 * Takes the thread row lock that sends, stops and archive share, after checking the owner,
 * Space and Mico. The main chat is named as such; another person's thread is not found.
 */
export async function lockSideThread(
  tx: Tx,
  scope: Scope,
  input: { botId: string; threadId: string },
): Promise<LockedSideThread> {
  const [row] = await tx.$queryRaw<LockedSideThread[]>`
    SELECT id, "taskBotId", "botId", "projectKey", "taskKey", "startedBy", "archivedAt", "deleteAfter"
    FROM threads
    WHERE id = ${input.threadId} AND "spaceId" = ${scope.spaceId} AND "userId" = ${scope.userId}
    FOR UPDATE`;
  if (row?.botId && row.botId === input.botId)
    throw new ThreadLifecycleError("main_chat", THREAD_MAIN_CHAT_LIFECYCLE_ERROR);
  if (!row || row.taskBotId !== input.botId)
    throw new ThreadLifecycleError("not_found", "This conversation was not found.");
  return row;
}

async function activeRunCount(tx: Tx, threadId: string) {
  const [row] = await tx.$queryRaw<Array<{ count: number }>>`
    SELECT count(*)::int AS count FROM runs WHERE "threadId" = ${threadId} AND status IN (${ACTIVE})`;
  return row?.count ?? 0;
}

/** Archives a stopped side thread. Throws busy when work started again since the stop. */
export async function archiveSideThreadInTransaction(
  tx: Tx,
  scope: Scope,
  input: { botId: string; threadId: string },
  now = new Date(),
): Promise<{ archivedAt: Date }> {
  const thread = await lockSideThread(tx, scope, input);
  if (thread.deleteAfter)
    throw new ThreadLifecycleError("deleting", THREAD_BEING_DELETED_ERROR);
  if (await activeRunCount(tx, thread.id))
    throw new ThreadLifecycleError("busy", THREAD_STILL_WORKING_ERROR);
  const archivedAt = thread.archivedAt ?? now;
  if (!thread.archivedAt)
    await tx.$executeRaw`UPDATE threads SET "archivedAt" = ${archivedAt} WHERE id = ${thread.id}`;
  // The inbox mark only mirrors the thread for older code; archive also ends follow-up.
  await tx.$executeRaw`
    UPDATE task_inbox SET "archivedAt" = COALESCE("archivedAt", ${archivedAt}), pinned = false,
      "remindAt" = NULL, "reminderClaimedAt" = NULL
    WHERE "threadId" = ${thread.id} AND "spaceId" = ${scope.spaceId} AND "userId" = ${scope.userId}`;
  return { archivedAt };
}

/**
 * Undoes a pending delete if there is one, keeping whether the thread was archived;
 * otherwise reopens an archived thread. Once the undo window has passed it is too late.
 */
export async function restoreSideThreadInTransaction(
  tx: Tx,
  scope: Scope,
  input: { botId: string; threadId: string },
  now = new Date(),
): Promise<{ restored: "delete" | "archive" | "none" }> {
  const thread = await lockSideThread(tx, scope, input);
  if (thread.deleteAfter) {
    if (thread.deleteAfter.getTime() <= now.getTime())
      throw new ThreadLifecycleError("deleted", THREAD_ALREADY_DELETED_ERROR);
    await tx.$executeRaw`UPDATE threads SET "deleteAfter" = NULL WHERE id = ${thread.id}`;
    return { restored: "delete" };
  }
  if (!thread.archivedAt) return { restored: "none" };
  await tx.$executeRaw`UPDATE threads SET "archivedAt" = NULL WHERE id = ${thread.id}`;
  await tx.$executeRaw`
    UPDATE task_inbox SET "archivedAt" = NULL, "reminderClaimedAt" = NULL
    WHERE "threadId" = ${thread.id} AND "spaceId" = ${scope.spaceId} AND "userId" = ${scope.userId}`;
  return { restored: "archive" };
}

/**
 * Hides a conversation the person or their Mico started and schedules its removal after the undo window.
 * Refused while any of its runs or delegated work is unfinished. Repeating it keeps the
 * first deadline.
 */
export async function markSideThreadDeletedInTransaction(
  tx: Tx,
  scope: Scope,
  input: { botId: string; threadId: string },
  now = new Date(),
): Promise<{ deleteAfter: Date }> {
  const thread = await lockSideThread(tx, scope, input);
  if (taskThreadKind(thread) !== "conversation" && thread.startedBy !== "agent")
    throw new ThreadLifecycleError(
      "not_deletable",
      "Only conversations you started can be deleted.",
    );
  if (thread.deleteAfter) return { deleteAfter: thread.deleteAfter };
  const [app] = await tx.$queryRaw<Array<{ siteId: string }>>`
    SELECT "siteId" FROM hosted_web_agents WHERE "threadId" = ${thread.id} LIMIT 1`;
  if (app)
    throw new ThreadLifecycleError(
      "not_deletable",
      "This conversation belongs to an app and stays with it.",
    );
  const [work] = await tx.$queryRaw<Array<{ count: number }>>`
    SELECT ((SELECT count(*) FROM runs WHERE "threadId" = ${thread.id} AND status IN (${ACTIVE}))
      + (SELECT count(*) FROM tasks WHERE "threadId" = ${thread.id} AND "delegationState" IN (${UNFINISHED_DELEGATION}))
      + (SELECT count(*) FROM tasks c JOIN tasks p ON p.id = c."parentTaskId"
          WHERE p."threadId" = ${thread.id} AND c."delegationState" IN (${UNFINISHED_DELEGATION})))::int AS count`;
  if (work?.count) throw new ThreadLifecycleError("busy", THREAD_DELETE_WHILE_WORKING_ERROR);
  const deleteAfter = new Date(now.getTime() + THREAD_DELETE_UNDO_MS);
  await tx.$executeRaw`UPDATE threads SET "deleteAfter" = ${deleteAfter} WHERE id = ${thread.id}`;
  return { deleteAfter };
}

/**
 * A send from a Mico tab or from Tasks brings an archived conversation back, inside the send
 * transaction and under the lock archive takes. A pending delete refuses the send instead.
 * Returns how many archived threads were reopened (0 or 1).
 */
export async function reopenSideThreadForSend(tx: Tx, scope: Scope, threadId: string) {
  const [thread] = await tx.$queryRaw<Array<{ archivedAt: Date | null; deleteAfter: Date | null }>>`
    SELECT "archivedAt", "deleteAfter" FROM threads
    WHERE id = ${threadId} AND "spaceId" = ${scope.spaceId} AND "userId" = ${scope.userId}
    FOR UPDATE`;
  if (thread?.deleteAfter) throw new ThreadLifecycleError("deleting", THREAD_BEING_DELETED_ERROR);
  if (!thread?.archivedAt) return 0;
  await tx.$executeRaw`UPDATE threads SET "archivedAt" = NULL WHERE id = ${threadId}`;
  await tx.$executeRaw`
    UPDATE task_inbox SET "archivedAt" = NULL, "reminderClaimedAt" = NULL
    WHERE "threadId" = ${threadId} AND "spaceId" = ${scope.spaceId} AND "userId" = ${scope.userId}`;
  return 1;
}

/**
 * Records how a finished turn ended on its thread, in the transaction that ends the run and
 * under the thread lock it holds. Background work never changes a conversation's outcome.
 */
export async function recordThreadTurnOutcome(
  tx: Pick<Prisma.TransactionClient, "$queryRaw">,
  input: { threadId: string; runIds: readonly string[]; outcome: ThreadOutcome; error?: string | null },
) {
  if (!input.runIds.length) return;
  const lastError = input.outcome === "failed" ? boundThreadError(input.error) : null;
  await tx.$queryRaw`
    UPDATE threads SET outcome = ${input.outcome}, "lastError" = ${lastError}
    WHERE id = ${input.threadId} AND EXISTS (
      SELECT 1 FROM runs r WHERE r.id IN (${Prisma.join([...input.runIds])}) AND r."threadId" = ${input.threadId}
        AND r."trigger" NOT IN (${BACKGROUND}))
    RETURNING id`;
}

export interface SideThreadListRow {
  id: string;
  projectKey: string | null;
  taskKey: string | null;
  taskBotId: string | null;
  title: string | null;
  titleSource: string | null;
  startedBy: string | null;
  outcome: string | null;
  lastError: string | null;
  archivedAt: Date | null;
  deleteAfter: Date | null;
  createdAt: Date;
  updatedAt: Date;
  activeStatuses: string[] | null;
  unread?: boolean | null;
}

/**
 * A Mico's side threads for this owner and Space, newest first, with the statuses of their
 * unfinished runs (background work only while it waits on the person) and the time of the
 * latest message or archive change.
 */
export function listSideThreads(
  prisma: Pick<PrismaClient, "$queryRaw">,
  scope: Scope,
  input: { botId: string; projectKey?: string; limit?: number },
) {
  const project = input.projectKey ? Prisma.sql`AND t."projectKey" = ${input.projectKey}` : Prisma.empty;
  return prisma.$queryRaw<SideThreadListRow[]>`
    SELECT t.id, t."projectKey", t."taskKey", t."taskBotId", t.title, t."titleSource", t."startedBy",
      t.outcome, t."lastError", t."archivedAt", t."deleteAfter", t."createdAt", t.unread,
      GREATEST(t."createdAt", COALESCE(m."createdAt", t."createdAt"), COALESCE(t."archivedAt", t."createdAt")) AS "updatedAt",
      a.statuses AS "activeStatuses"
    FROM threads t
    LEFT JOIN LATERAL (
      SELECT "createdAt" FROM messages WHERE "threadId" = t.id ORDER BY seq DESC LIMIT 1
    ) m ON true
    LEFT JOIN LATERAL (
      SELECT array_agg(DISTINCT r.status) AS statuses FROM runs r
      WHERE r."threadId" = t.id AND r.status IN (${ACTIVE})
        AND (r."trigger" NOT IN (${BACKGROUND}) OR r.status IN ('waiting_input', 'waiting_takeover'))
    ) a ON true
    WHERE t."spaceId" = ${scope.spaceId} AND t."userId" = ${scope.userId} AND t."taskBotId" = ${input.botId}
      ${project}
    ORDER BY t."createdAt" DESC, t.id DESC
    LIMIT ${input.limit ?? 1000}`;
}

export interface DueThreadDeletion {
  id: string;
  spaceId: string;
  userId: string;
  taskBotId: string;
}

/** Pending deletes whose undo window and grace period have both passed. */
export function dueThreadDeletions(
  prisma: Pick<PrismaClient, "$queryRaw">,
  before: Date,
  limit = 20,
) {
  return prisma.$queryRaw<DueThreadDeletion[]>`
    SELECT id, "spaceId", "userId", "taskBotId" FROM threads
    WHERE "deleteAfter" IS NOT NULL AND "deleteAfter" <= ${before} AND "taskBotId" IS NOT NULL
    ORDER BY "deleteAfter", id
    LIMIT ${limit}`;
}

export interface ThreadDeletionPlan {
  thread: DueThreadDeletion;
  runIds: string[];
  /** Mico output made only in this conversation and shown in no other one. */
  artifacts: Array<{ id: string; storageKey: string; botId: string | null }>;
}

/**
 * What a due delete removes outside the cascade: Mico output families whose every version
 * was made by this conversation's runs and that no other conversation's message shows.
 * Files the person uploaded stay in their Library. Null when the delete is not due.
 */
export async function planThreadDeletion(
  prisma: Pick<PrismaClient, "$queryRaw">,
  threadId: string,
  now: Date,
): Promise<ThreadDeletionPlan | null> {
  const [thread] = await prisma.$queryRaw<DueThreadDeletion[]>`
    SELECT id, "spaceId", "userId", "taskBotId" FROM threads
    WHERE id = ${threadId} AND "deleteAfter" IS NOT NULL AND "deleteAfter" <= ${now}
      AND "taskBotId" IS NOT NULL`;
  if (!thread) return null;
  const runs = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM runs WHERE "threadId" = ${thread.id}`;
  const runIds = runs.map((run) => run.id);
  if (!runIds.length) return { thread, runIds, artifacts: [] };
  const artifacts = await prisma.$queryRaw<ThreadDeletionPlan["artifacts"]>`
    WITH families AS (
      SELECT DISTINCT COALESCE(a."rootArtifactId", a.id) AS root FROM artifacts a
      WHERE a."runId" IN (${Prisma.join(runIds)}) AND a."spaceId" = ${thread.spaceId} AND a."userId" = ${thread.userId}
    ), members AS (
      SELECT a.id, a."storageKey", a."botId", a."runId", f.root FROM artifacts a
      JOIN families f ON COALESCE(a."rootArtifactId", a.id) = f.root
      WHERE a."spaceId" = ${thread.spaceId} AND a."userId" = ${thread.userId}
    ), kept AS (
      SELECT DISTINCT m.root FROM members m
      WHERE m."runId" IS NULL OR m."runId" NOT IN (${Prisma.join(runIds)})
      UNION
      SELECT DISTINCT m.root FROM members m
      JOIN threads o ON o."spaceId" = ${thread.spaceId} AND o."userId" = ${thread.userId} AND o.id <> ${thread.id}
      JOIN messages msg ON msg."threadId" = o.id
      WHERE jsonb_typeof(msg.blocks) = 'array'
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(msg.blocks) b WHERE b->>'artifactId' = m.id)
    )
    SELECT m.id, m."storageKey", m."botId" FROM members m
    WHERE m.root NOT IN (SELECT root FROM kept)
    ORDER BY (m.id = m.root), m.id`;
  return { thread, runIds, artifacts };
}

/**
 * Removes a due conversation under its lock: detaches delegated children kept by other
 * threads, deletes the planned artifact rows and the thread, whose cascade removes its
 * messages, queued steering, events, runs, tasks, pins, inbox entry and task notes.
 * Never touches a main chat, a not-yet-due delete or a thread that works again.
 */
export async function purgeDueThreadInTransaction(
  tx: Tx,
  plan: ThreadDeletionPlan,
  now: Date,
): Promise<"purged" | "gone" | "not_due" | "busy"> {
  const [thread] = await tx.$queryRaw<Array<{ deleteAfter: Date | null; taskBotId: string | null }>>`
    SELECT "deleteAfter", "taskBotId" FROM threads WHERE id = ${plan.thread.id} FOR UPDATE`;
  if (!thread) return "gone";
  if (!thread.taskBotId || !thread.deleteAfter || thread.deleteAfter.getTime() > now.getTime())
    return "not_due";
  if (await activeRunCount(tx, plan.thread.id)) return "busy";
  await tx.$executeRaw`
    UPDATE tasks SET "parentTaskId" = NULL
    WHERE "threadId" <> ${plan.thread.id}
      AND "parentTaskId" IN (SELECT id FROM tasks WHERE "threadId" = ${plan.thread.id})`;
  await tx.$executeRaw`
    DELETE FROM steering_messages
    WHERE "messageId" IN (SELECT id FROM messages WHERE "threadId" = ${plan.thread.id})`;
  if (plan.artifacts.length) {
    // Versions first: the family root cascades to any version that is still there.
    await tx.$executeRaw`
      DELETE FROM artifacts WHERE id IN (${Prisma.join(plan.artifacts.map((artifact) => artifact.id))})
        AND "spaceId" = ${plan.thread.spaceId} AND "userId" = ${plan.thread.userId}`;
  }
  await tx.$executeRaw`DELETE FROM threads WHERE id = ${plan.thread.id} AND "deleteAfter" IS NOT NULL`;
  return "purged";
}
