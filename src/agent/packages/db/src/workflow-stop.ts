import type { PrismaClient, Prisma } from "./client.js";
import { cancelRunsInTransaction } from "./cancel-runs.js";
import { appendEventInTransaction } from "./events.js";
import { IsolationError } from "./scope.js";

/** Cancel the graph and save exact process teardown coordinates in one commit. */
export async function stopWorkflowExecution(
  prisma: PrismaClient,
  actor: { userId: string; spaceId: string },
  executionId: string,
) {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<
      Array<{ id: string; status: string; steps: unknown }>
    >`SELECT id,status,steps FROM workflow_executions WHERE id=${executionId} AND "userId"=${actor.userId} AND "spaceId"=${actor.spaceId} FOR UPDATE`;
    const execution = rows[0];
    if (!execution) throw new IsolationError();
    if (!["queued", "running"].includes(execution.status)) return;
    const runIds = Object.values(execution.steps as Record<string, { runId?: string }>).flatMap(
      (step) => (step.runId ? [step.runId] : []),
    );
    const runs = await tx.run.findMany({
      where: {
        id: { in: runIds },
        userId: actor.userId,
        spaceId: actor.spaceId,
        status: { in: ["queued", "leased", "running", "waiting_input", "waiting_takeover"] },
      },
    });
    for (const run of runs) {
      const leases = await tx.computerExecutionLease.findMany({
        where: { runId: run.id },
        include: { computer: true },
      });
      const targets = leases.map((lease) => ({
        runId: run.id,
        botId: run.botId,
        computerId: lease.computerId,
        fence: lease.fence,
        kind: lease.computer.kind,
        providerRef: lease.computer.providerRef,
        homeKey: lease.computer.homeKey,
      }));
      const legacy = await tx.computer.findMany({
        where: { userId: actor.userId, spaceId: actor.spaceId, executionRunId: run.id },
      });
      for (const computer of legacy)
        if (!targets.some((target) => target.computerId === computer.id))
          targets.push({
            runId: run.id,
            botId: run.botId,
            computerId: computer.id,
            fence: -1,
            kind: computer.kind,
            providerRef: computer.providerRef,
            homeKey: computer.homeKey,
          });
      await cancelRunsInTransaction(tx, [run], new Date());
      await appendEventInTransaction(tx, {
        spaceId: actor.spaceId,
        threadId: run.threadId,
        botId: run.botId,
        runId: run.id,
        type: "run.cancelled",
        allowCancelledRun: true,
        payload: { reason: "workflow_stop" },
      });
      await tx.task.update({
        where: { id: run.taskId },
        data: {
          workStopPending: true,
          workStopTargets: { runIds: [run.id], targets } as Prisma.InputJsonValue,
        },
      });
    }
    const steps = Object.fromEntries(
      Object.entries(execution.steps as Record<string, { status: string; runId?: string }>).map(
        ([id, step]) => [id, step.status === "running" ? { ...step, status: "cancelled" } : step],
      ),
    );
    await tx.$executeRaw`UPDATE workflow_executions SET status='cancelled',steps=${JSON.stringify(steps)}::jsonb,"updatedAt"=now() WHERE id=${executionId}`;
  });
}
