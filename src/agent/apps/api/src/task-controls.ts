import { ORPCError } from "@orpc/server";
import { runContinueJob, runJobKey } from "@rakazo/adapter-kit";
import type { Actor } from "@rakazo/contracts";
import { ACTIVE_RUN_STATUSES } from "@rakazo/core";
import { IsolationError } from "@rakazo/db";
import type { RouterDeps } from "./router.js";
import { resolveThreadTarget, stopThreadRuns } from "./thread-target.js";

/** A task keeps its thread and earlier runs when its owner changes. */
export function createTaskControls(
  deps: Pick<RouterDeps, "prisma" | "sandbox" | "events" | "jobs">,
) {
  async function owned(actor: Actor, runId: string) {
    const run = await deps.prisma.run.findFirst({
      where: { id: runId, spaceId: actor.spaceId, userId: actor.userId },
      include: {
        task: true,
        thread: { include: { group: { include: { members: { include: { bot: true } } } } } },
      },
    });
    if (!run?.thread.group || run.thread.group.archivedAt) throw new IsolationError();
    return run;
  }
  return {
    async get(actor: Actor, runId: string) {
      const run = await owned(actor, runId);
      const latest = await deps.prisma.run.findFirst({
        where: { taskId: run.taskId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
      return {
        taskId: run.taskId,
        version: run.task.assignmentVersion,
        paused: run.task.paused,
        active: Boolean(
          latest && (ACTIVE_RUN_STATUSES as readonly string[]).includes(latest.status),
        ),
        botId: run.task.botId,
        runId: latest?.id ?? run.id,
        bots: run.thread
          .group!.members.filter(
            (member) => !member.bot.archivedAt && member.bot.userId === actor.userId,
          )
          .map((member) => ({ id: member.botId, name: member.bot.name })),
      };
    },
    async control(
      actor: Actor,
      input: {
        runId: string;
        expectedVersion: number;
        action: "pause" | "resume" | "reassign";
        botId?: string;
      },
    ) {
      const original = await owned(actor, input.runId);
      const target = await resolveThreadTarget(deps.prisma, actor, {
        groupId: original.thread.groupId!,
      });
      if (input.action === "pause") {
        const paused = await deps.prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM threads WHERE id = ${original.threadId} FOR UPDATE`;
          const task = await tx.task.findFirst({
            where: { id: original.taskId, spaceId: actor.spaceId, userId: actor.userId },
          });
          if (!task || task.assignmentVersion !== input.expectedVersion)
            throw new ORPCError("CONFLICT", { message: "Task changed. Reload its controls." });
          const runs = await tx.run.findMany({
            where: { taskId: task.id, status: { in: [...ACTIVE_RUN_STATUSES] } },
            select: { id: true },
          });
          if (!task.paused && !runs.length)
            throw new ORPCError("CONFLICT", { message: "This task has already finished." });
          if (!task.paused)
            await tx.task.update({
              where: { id: task.id },
              data: { paused: true, assignmentVersion: { increment: 1 } },
            });
          return {
            ids: runs.map((run) => run.id),
            version: task.assignmentVersion + (task.paused ? 0 : 1),
          };
        });
        // Retrying pause completes teardown if a previous request or process was interrupted.
        await stopThreadRuns(deps, actor, target, paused.ids);
        await Promise.all(paused.ids.map((id) => deps.jobs.cancel(runJobKey(id))));
        return {
          taskId: original.taskId,
          version: paused.version,
          runId: original.id,
          paused: true,
        };
      }
      const result = await deps.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM threads WHERE id = ${original.threadId} FOR UPDATE`;
        const group = await tx.chatGroup.findFirst({
          where: {
            id: original.thread.groupId!,
            spaceId: actor.spaceId,
            userId: actor.userId,
            archivedAt: null,
          },
        });
        if (!group) throw new IsolationError();
        const task = await tx.task.findFirst({
          where: { id: original.taskId, spaceId: actor.spaceId, userId: actor.userId },
        });
        if (!task?.paused || task.assignmentVersion !== input.expectedVersion)
          throw new ORPCError("CONFLICT", {
            message: "Pause the task and reload its controls first.",
          });
        const executing = await tx.run.count({
          where: {
            taskId: task.id,
            OR: [
              { status: { in: [...ACTIVE_RUN_STATUSES] } },
              { leaseOwner: { not: null }, leaseExpiresAt: { gt: new Date() } },
            ],
          },
        });
        if (executing)
          throw new ORPCError("CONFLICT", {
            message: "The previous agent is still stopping. Try again shortly.",
          });
        const botId = input.action === "reassign" ? input.botId : task.botId;
        const member =
          botId &&
          (await tx.chatGroupMember.findFirst({
            where: {
              groupId: original.thread.groupId!,
              botId,
              bot: { spaceId: actor.spaceId, userId: actor.userId, archivedAt: null },
            },
          }));
        if (!botId || !member) throw new IsolationError();
        await tx.task.update({
          where: { id: task.id },
          data: { botId, paused: false, status: "queued", assignmentVersion: { increment: 1 } },
        });
        const next = await tx.run.create({
          data: {
            spaceId: actor.spaceId,
            userId: actor.userId,
            taskId: task.id,
            threadId: task.threadId,
            botId,
            status: "queued",
            trigger: "user",
          },
        });
        return {
          taskId: task.id,
          version: task.assignmentVersion + 1,
          runId: next.id,
          paused: false,
        };
      });
      // The existing reconciler recovers a missed enqueue from this durable queued run.
      await deps.jobs.enqueue(runContinueJob(result.runId)).catch(() => undefined);
      return result;
    },
  };
}
