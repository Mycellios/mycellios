import type { ArtifactStore } from "@mycellios/adapter-kit";
import { THREAD_DELETE_GRACE_MS } from "@mycellios/core";
import type { PrismaClient } from "@mycellios/db";
import {
  dueThreadDeletions,
  planThreadDeletion,
  purgeDueThreadInTransaction,
  runAsSystem,
  runAsTenant,
} from "@mycellios/db";
import { getLogger } from "@mycellios/logging";
import { removeNativeThreadSessions } from "./native-agent-runtime.js";
import { removePiThreadSessions } from "./pi-session.js";

export interface ThreadDeletionDeps {
  prisma: PrismaClient;
  artifacts: ArtifactStore;
  /** Where Pi transcripts and native engine sessions live; absent means nothing on disk. */
  dataDir?: string;
}

function alreadyRemoved(error: unknown) {
  if (typeof error !== "object" || error === null) return false;
  const code = "code" in error ? error.code : undefined;
  const name = "name" in error ? error.name : undefined;
  return code === "ENOENT" || code === "NoSuchKey" || name === "NotFound" || name === "NoSuchKey";
}

/**
 * Finishes one conversation delete once its undo window has passed. Files go first (the
 * Mico's outputs made only there, Pi transcripts and native engine sessions), then one
 * transaction removes the thread, whose cascade takes messages, queued steering, events,
 * runs, tasks, pins, the Tasks entry and task notes. A restored or not yet due thread is
 * left alone, and a failure is retried by the next job or reconciliation.
 */
export async function purgeDeletedThread(
  deps: ThreadDeletionDeps,
  threadId: string,
  now = new Date(),
): Promise<"purged" | "gone" | "not_due" | "busy"> {
  const plan = await planThreadDeletion(deps.prisma, threadId, now);
  if (!plan) return "not_due";
  const { thread } = plan;
  const context = {
    operationId: `thread-delete:${thread.id}`,
    traceId: `thread-delete:${thread.id}`,
    spaceId: thread.spaceId,
    userId: thread.userId,
    botId: thread.taskBotId,
    signal: AbortSignal.timeout(60_000),
  };
  for (const artifact of plan.artifacts) {
    await deps.artifacts
      .remove(artifact.storageKey, { ...context, botId: artifact.botId ?? thread.taskBotId })
      .catch((error) => {
        if (!alreadyRemoved(error)) throw error;
      });
  }
  await removePiThreadSessions(deps.dataDir, thread.userId, thread.taskBotId, thread.id);
  await removeNativeThreadSessions(deps.dataDir, {
    spaceId: thread.spaceId,
    userId: thread.userId,
    botId: thread.taskBotId,
    threadId: thread.id,
  });
  return deps.prisma.$transaction((tx) => purgeDueThreadInTransaction(tx, plan, now), {
    maxWait: 5_000,
    timeout: 60_000,
  });
}

/** Finds deletes whose job was lost and finishes them, each as its owner. */
export async function reconcileThreadDeletions(deps: ThreadDeletionDeps, now = new Date()) {
  const due = await runAsSystem("find conversation deletes past their undo window", () =>
    dueThreadDeletions(deps.prisma, new Date(now.getTime() - THREAD_DELETE_GRACE_MS)),
  );
  for (const thread of due) {
    await runAsTenant({ spaceId: thread.spaceId, userId: thread.userId }, () =>
      purgeDeletedThread(deps, thread.id, now),
    ).catch((error) => getLogger().error("conversation delete failed; retrying later", error));
  }
}
