import type { JobPublisher } from "@mycellios/adapter-kit";
import { runContinueJob } from "@mycellios/adapter-kit";
import type { PrismaClient } from "@mycellios/db";

/** Bounds the wake fan-out; claimMicoRun still admits each run atomically. */
const WAKE_LIMIT = 10;

/**
 * A queued run refused by claimMicoRun because its Mico was busy has no pending
 * job: it otherwise waits for the periodic reconciler. Once a run of the same
 * Mico has left its slot, continue that Mico's oldest queued runs now.
 *
 * keepExisting preserves a job that is still waiting out a failure backoff;
 * replaceLockedBefore replaces a job locked right now, so a run refused while
 * this one was finishing is still continued instead of being deduplicated.
 */
export async function wakeQueuedMicoRuns(
  deps: { prisma: PrismaClient; jobs: JobPublisher },
  runId: string,
): Promise<void> {
  const run = await deps.prisma.run.findUnique({
    where: { id: runId },
    select: { botId: true, spaceId: true, userId: true, status: true },
  });
  if (!run?.botId || ["queued", "leased", "running"].includes(run.status)) return;
  const now = new Date();
  const queued = await deps.prisma.run.findMany({
    where: {
      botId: run.botId,
      spaceId: run.spaceId,
      userId: run.userId,
      id: { not: runId },
      status: "queued",
      OR: [{ wakeAt: null }, { wakeAt: { lte: now } }],
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: WAKE_LIMIT,
    select: { id: true },
  });
  for (const next of queued)
    await deps.jobs.enqueue({ ...runContinueJob(next.id), keepExisting: true, replaceLockedBefore: now });
}
