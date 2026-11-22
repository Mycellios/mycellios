import type { MessageBlock, RoutineRunOutcome } from "@mycellios/contracts";
import type { Prisma } from "./client.js";
import { appendEventInTransaction } from "./events.js";
import { createThreadMessageInTransaction } from "./messages.js";

type Tx = Prisma.TransactionClient;

/** One marker per routine run; the nonce makes a repeated finalize add nothing. */
export function routineRunMarkerNonce(runId: string): string {
  return `routine-run:${runId}`;
}

export interface QueuedRoutineRunMarker {
  threadId: string;
  seq: number;
}

type RoutineBlock = { kind: string; routineId?: unknown; status?: unknown };

/** The routine run marker a message carries, if it is one. */
export function routineRunMarkerBlock(
  blocks: unknown,
): Extract<MessageBlock, { kind: "routine_run" }> | null {
  if (!Array.isArray(blocks)) return null;
  const block = (blocks as RoutineBlock[]).find((candidate) => candidate?.kind === "routine_run");
  return (block as Extract<MessageBlock, { kind: "routine_run" }> | undefined) ?? null;
}

/**
 * A quiet run's marker: it never counts as unread, never becomes the sidebar preview and never
 * moves the Mico up the list.
 */
export function isQuietRoutineRunMarker(blocks: unknown): boolean {
  return routineRunMarkerBlock(blocks)?.status === "quiet";
}

/**
 * When a routine run that worked in its own conversation ends, the transaction that ends it
 * adds a marker to the Mico's main chat: a system message with a `routine_run` block that links
 * to the routine conversation. The answer stays there. A quiet run's marker leaves the main
 * chat unread state as it was; any other marks it unread. Nothing is added for runs in older
 * targets (the main chat itself or a group), for deleted routines or for archived Micos.
 */
export async function queueRoutineRunMarkerInTransaction(
  tx: Tx,
  input: { runId: string; threadId: string; status: "completed" | "failed" },
): Promise<QueuedRoutineRunMarker | null> {
  // Every turn end passes here; only runs that belong to a routine read further.
  const rows = await tx.$queryRaw<
    Array<{
      botId: string;
      spaceId: string;
      userId: string;
      trigger: string;
      quiet: boolean;
      routineId: string;
      routineName: string;
      routineThreadId: string | null;
      pausedByRunId: string | null;
      taskBotId: string | null;
      taskKey: string | null;
      mainThreadId: string | null;
    }>
  >`SELECT r."botId", r."spaceId", r."userId", r.trigger, r.quiet, ro.id AS "routineId",
      ro.name AS "routineName", ro."threadId" AS "routineThreadId", ro."pausedByRunId",
      t."taskBotId", t."taskKey", m.id AS "mainThreadId"
    FROM runs r
    JOIN routines ro ON ro.id = r."routineId" AND ro."botId" = r."botId"
      AND ro."spaceId" = r."spaceId" AND ro."userId" = r."userId"
    JOIN threads t ON t.id = r."threadId"
    JOIN bots b ON b.id = r."botId" AND b."archivedAt" IS NULL
    LEFT JOIN threads m ON m."botId" = r."botId" AND m."spaceId" = r."spaceId" AND m."userId" = r."userId"
    WHERE r.id = ${input.runId} AND r."threadId" = ${input.threadId}`;
  const run = rows?.[0];
  if (!run?.mainThreadId || run.mainThreadId === input.threadId) return null;
  if (run.trigger !== "routine" && run.trigger !== "webhook") return null;
  // Only the routine's own conversation: a legacy target already shows the run where it ran.
  if (
    run.routineThreadId !== input.threadId ||
    run.taskBotId !== run.botId ||
    run.taskKey !== `routine:${run.routineId}`
  )
    return null;
  const nonce = routineRunMarkerNonce(input.runId);
  const existing = await tx.message.findUnique({
    where: { threadId_clientNonce: { threadId: run.mainThreadId, clientNonce: nonce } },
    select: { id: true },
  });
  if (existing) return null;
  const outcome: RoutineRunOutcome =
    input.status === "failed"
      ? "failed"
      : run.pausedByRunId === input.runId
        ? "paused"
        : run.quiet
          ? "quiet"
          : "reported";
  // A run that paused its own routine is never recorded as quiet.
  if (outcome === "paused" && run.quiet)
    await tx.run.updateMany({ where: { id: input.runId }, data: { quiet: false } });
  const blocks: MessageBlock[] = [
    {
      kind: "routine_run",
      fromBotId: run.botId,
      routineId: run.routineId,
      routineName: run.routineName,
      taskId: input.threadId,
      runId: input.runId,
      status: outcome,
    },
  ];
  const message = await createThreadMessageInTransaction(tx, {
    threadId: run.mainThreadId,
    role: "system",
    blocks,
    botId: run.botId,
    clientNonce: nonce,
    markUnread: outcome !== "quiet",
  });
  const event = await appendEventInTransaction(tx, {
    spaceId: run.spaceId,
    threadId: run.mainThreadId,
    botId: run.botId,
    type: "thread.message.created",
    payload: { messageId: message.id, role: "system", blocks },
  });
  return { threadId: run.mainThreadId, seq: event.seq };
}
