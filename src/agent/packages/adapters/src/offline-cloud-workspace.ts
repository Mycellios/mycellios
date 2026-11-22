import type { AdapterContext, SandboxProvider } from "@mycellios/adapter-kit";
import { nativeWorkProjectSession } from "@mycellios/core";
import {
  appendEventInTransaction,
  createThreadMessageInTransaction,
  ensureComputerRecord,
  isOwnedRoutineThread,
  isOwnedWorkflowThread,
  parseComputerMode,
  type PrismaClient,
  withTransactionRetry,
} from "@mycellios/db";

/** Shown in the chat when a This PC Mico's new message runs on the server instead. */
export const OFFLINE_CLOUD_NOTICE =
  "This PC is offline, so this message runs on the server, without this PC's files.";

type Run = Pick<NonNullable<Awaited<ReturnType<PrismaClient["run"]["findUnique"]>>>,
  "id" | "spaceId" | "userId" | "botId" | "threadId" | "taskId" | "startedAt" | "checkpoint" | "cloudComputerId">;
type Assignment = { id: string; scope: string; kind: string } | null;

export async function selectOfflineCloudWorkspace(
  prisma: PrismaClient,
  sandbox: SandboxProvider | undefined,
  run: Run,
  assignment: Assignment,
  lease: { workerId: string; fence: number },
) {
  const { spaceId, userId, botId } = run;
  if (run.cloudComputerId) {
    return prisma.computer.findFirstOrThrow({
      where: { id: run.cloudComputerId, spaceId, userId, scopeKey: { startsWith: "cloud:" } },
    });
  }

  // A new message may choose a different host. An interrupted run must keep its host.
  if (!sandbox?.provisionKind || run.startedAt || run.checkpoint || (assignment && assignment.kind !== "desktop")) return;
  const provider = sandbox.describe().id;
  if (provider === "none" || provider === "desktop") return;
  const context: AdapterContext = {
    operationId: run.id, traceId: run.id, runId: run.id, spaceId, userId, botId,
    signal: AbortSignal.timeout(5_000),
  };
  if (await sandbox.provisionKind(context) !== provider) return;

  const [thread, task] = await Promise.all([
    prisma.thread.findUniqueOrThrow({ where: { id: run.threadId } }),
    prisma.task.findUniqueOrThrow({ where: { id: run.taskId } }),
  ]);
  if (task.resources.some((resource) => resource === "host" || resource.startsWith("workspace:"))) return;
  if (nativeWorkProjectSession(thread, task) &&
    !(await isOwnedRoutineThread(prisma, run, thread)) &&
    !(await isOwnedWorkflowThread(prisma, run, thread))) return;

  return withTransactionRetry(() => prisma.$transaction(async (tx) => {
    const computer = await ensureComputerRecord(tx, {
      mode: assignment ? parseComputerMode(assignment.scope) : "dedicated",
      spaceId, userId, botId, kind: provider, cloudFallback: true,
    });
    const selected = await tx.run.updateMany({
      where: {
        id: run.id, spaceId, userId, botId, status: "running",
        leaseOwner: lease.workerId, leaseFence: lease.fence, leaseExpiresAt: { gt: new Date() },
        cloudComputerId: null,
        bot: { archivedAt: null, computerSwitching: false, computerId: assignment?.id ?? null },
      },
      data: { cloudComputerId: computer.id },
    });
    if (selected.count !== 1) throw new Error("The run or its computer assignment changed");
    // The owner chose This PC; say in the chat that this message did not run there.
    const blocks = [{ kind: "meta" as const, text: OFFLINE_CLOUD_NOTICE }];
    const message = await createThreadMessageInTransaction(tx, {
      threadId: run.threadId, botId, role: "system", blocks,
      clientNonce: `offline-cloud:${run.id}`, markUnread: false,
    });
    await appendEventInTransaction(tx, {
      spaceId, threadId: run.threadId, botId, type: "thread.message.created",
      payload: { messageId: message.id, role: "system", blocks },
    });
    return computer;
  }));
}
