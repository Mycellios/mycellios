import { randomUUID } from "node:crypto";
import { ORPCError } from "@orpc/server";
import {
  createWorkflowExecution,
  decideWorkflowApproval,
  ownedWorkflow,
  scheduledWorkflow,
  saveWorkflowRevision,
  restoreWorkflowVersion,
  snapshotWorkflow,
  workflowDto,
  workflowExecutionDto,
} from "@mycellios/adapters";
import type { ExecutionRow, WorkflowRow } from "@mycellios/adapters";
import type { WorkflowGraph } from "@mycellios/contracts";
import { nextCronDate } from "@mycellios/core";
import { stopWorkflowExecution } from "@mycellios/db";
import type { RouterContext } from "./context.js";
import { replaceWorkflowWebhook, revokeWorkflowWebhook, workflowWebhookPath } from "../workflow-webhooks.js";

export function workflowsRoutes({ deps, repos, authed }: RouterContext) {
  async function validateAgents(actor: Parameters<typeof repos.getBot>[0], graph: WorkflowGraph) {
    for (const id of new Set(graph.nodes.flatMap((node) => (node.botId ? [node.botId] : []))))
      await repos.getBot(actor, id);
  }
  return {
    workflows: {
      available: authed.workflows.available.handler(() => ({ enabled: true as const })),
      list: authed.workflows.list.handler(async ({ context }) => {
        const rows = await deps.prisma.$queryRaw<
          WorkflowRow[]
        >`SELECT * FROM workflows WHERE "userId"=${context.actor.userId} AND "spaceId"=${context.actor.spaceId} AND "archivedAt" IS NULL ORDER BY "updatedAt" DESC LIMIT 100`;
        return rows.map(workflowDto);
      }),
      create: authed.workflows.create.handler(async ({ context, input }) => {
        await validateAgents(context.actor, input.graph);
        const id = input.id ?? randomUUID();
        return deps.prisma.$transaction(async tx => {
          await tx.$executeRaw`INSERT INTO workflows (id,"spaceId","userId",name,graph) VALUES (${id},${context.actor.spaceId},${context.actor.userId},${input.name},${JSON.stringify(input.graph)}::jsonb) ON CONFLICT (id) DO NOTHING`;
          const row = await ownedWorkflow(tx, context.actor, id);
          if (!row) throw new ORPCError("CONFLICT");
          if (row.version === 1) await snapshotWorkflow(tx, row, true);
          return workflowDto(row);
        });
      }),
      save: authed.workflows.save.handler(async ({ context, input }) => {
        const flow = await ownedWorkflow(deps.prisma, context.actor, input.id);
        if (!flow) throw new ORPCError("NOT_FOUND");
        await validateAgents(context.actor, input.graph);
        let next: Date | null = null;
        if (input.active) {
          try {
            const trigger = scheduledWorkflow(input.graph);
            const old = flow.graph.nodes.find(
              (node) => node.kind === "trigger" && node.trigger === "schedule",
            );
            next =
              flow.active &&
              old?.cron === trigger.cron &&
              old?.timezone === trigger.timezone &&
              flow.nextRunAt
                ? flow.nextRunAt
                : nextCronDate(trigger.cron!, new Date(), trigger.timezone || "UTC");
          } catch (error) {
            throw new ORPCError("BAD_REQUEST", {
              message: error instanceof Error ? error.message : "Invalid schedule",
            });
          }
        }
        const saved = await deps.prisma.$transaction(tx => saveWorkflowRevision(tx, context.actor, { ...input, nextRunAt: next }));
        if (!saved)
          throw new ORPCError("CONFLICT", {
            message: "This workflow changed on another device. Reload it before saving.",
          });
        return workflowDto(saved);
      }),
      archive: authed.workflows.archive.handler(async ({ context, input }) => {
        const flow = await ownedWorkflow(deps.prisma, context.actor, input.id);
        if (!flow) throw new ORPCError("NOT_FOUND");
        await deps.prisma
          .$executeRaw`UPDATE workflows SET "archivedAt"=now(),active=false,"nextRunAt"=NULL WHERE id=${flow.id} AND "userId"=${context.actor.userId} AND "spaceId"=${context.actor.spaceId}`;
        return { ok: true as const };
      }),
      execute: authed.workflows.execute.handler(async ({ context, input }) => {
        return deps.prisma.$transaction(async (tx) => {
          const flow = (
            await tx.$queryRaw<
              WorkflowRow[]
            >`SELECT * FROM workflows WHERE id=${input.id} AND "userId"=${context.actor.userId} AND "spaceId"=${context.actor.spaceId} AND "archivedAt" IS NULL FOR UPDATE`
          )[0];
          if (!flow) throw new ORPCError("NOT_FOUND");
          const replay = (
            await tx.$queryRaw<
              ExecutionRow[]
            >`SELECT * FROM workflow_executions WHERE "spaceId"=${context.actor.spaceId} AND "userId"=${context.actor.userId} AND "clientNonce"=${input.clientNonce}`
          )[0];
          if (replay) {
            if (replay.workflowId !== flow.id) throw new ORPCError("CONFLICT");
            return workflowExecutionDto(replay);
          }
          if (flow.version !== input.expectedVersion)
            throw new ORPCError("CONFLICT", {
              message: "Save or reload this workflow before running it",
            });
          try {
            return workflowExecutionDto(
              await createWorkflowExecution(tx, flow, input.triggerId, input.clientNonce),
            );
          } catch (error) {
            throw new ORPCError("BAD_REQUEST", {
              message: error instanceof Error ? error.message : "Invalid workflow",
            });
          }
        });
      }),
      runs: authed.workflows.runs.handler(async ({ context, input }) => {
        if (!(await ownedWorkflow(deps.prisma, context.actor, input.id)))
          throw new ORPCError("NOT_FOUND");
        return (
          await deps.prisma.$queryRaw<
            ExecutionRow[]
          >`SELECT * FROM workflow_executions WHERE "workflowId"=${input.id} AND "userId"=${context.actor.userId} AND "spaceId"=${context.actor.spaceId} ORDER BY "createdAt" DESC LIMIT 20`
        ).map(workflowExecutionDto);
      }),
      webhook: authed.workflows.webhook.handler(async ({ context, input }) => {
        const { spaceId, userId } = context.actor;
        if (!(await ownedWorkflow(deps.prisma, context.actor, input.id))) throw new ORPCError("NOT_FOUND");
        const row = await deps.prisma.workflowWebhook.findFirst({
          where: { workflowId: input.id, spaceId, userId }, select: { version: true },
        });
        return { version: row?.version ?? null, path: workflowWebhookPath(input.id) };
      }),
      rotateWebhook: authed.workflows.rotateWebhook.handler(async ({ context, input }) => {
        const { spaceId, userId } = context.actor;
        if (!(await ownedWorkflow(deps.prisma, context.actor, input.id))) throw new ORPCError("NOT_FOUND");
        const result = await replaceWorkflowWebhook(deps, input.id, input.expectedVersion, {
          operationId: "workflows.rotateWebhook", traceId: "workflows.rotateWebhook", userId, spaceId,
          signal: context.signal ?? new AbortController().signal,
        }).catch((error: unknown) => {
          if (error instanceof Error && error.message === "Add exactly one webhook trigger.")
            throw new ORPCError("BAD_REQUEST", { message: error.message });
          throw error;
        });
        if (!result) throw new ORPCError("CONFLICT", { message: "Reload the saved workflow before enabling its webhook." });
        return result;
      }),
      revokeWebhook: authed.workflows.revokeWebhook.handler(async ({ context, input }) => {
        if (!(await revokeWorkflowWebhook(deps.prisma, input.id, context.actor))) throw new ORPCError("NOT_FOUND");
        return { ok: true as const };
      }),
      versions: authed.workflows.versions.handler(async ({ context, input }) => {
        if (!(await ownedWorkflow(deps.prisma, context.actor, input.id))) throw new ORPCError("NOT_FOUND");
        const rows = await deps.prisma.workflowVersion.findMany({
          where: { workflowId: input.id, spaceId: context.actor.spaceId, userId: context.actor.userId },
          select: { version: true, name: true, createdAt: true }, orderBy: { version: "desc" }, take: 50,
        });
        return rows.map(row => ({ ...row, createdAt: row.createdAt.toISOString() }));
      }),
      restoreVersion: authed.workflows.restoreVersion.handler(async ({ context, input }) => {
        const restored = await restoreWorkflowVersion(deps.prisma, context.actor, input);
        if (restored === "missing") throw new ORPCError("NOT_FOUND");
        if (restored === "conflict") throw new ORPCError("CONFLICT", { message: "This workflow changed on another device. Reload it before restoring." });
        if (restored === "mico_unavailable") throw new ORPCError("BAD_REQUEST", { message: "A Mico in this version is no longer available." });
        return restored;
      }),
      decideApproval: authed.workflows.decideApproval.handler(async ({ context, input }) => {
        const decision = await decideWorkflowApproval(deps.prisma, context.actor, input);
        if (decision === "not_found") throw new ORPCError("NOT_FOUND");
        if (decision === "conflict") throw new ORPCError("CONFLICT", { message: "This workflow approval is no longer waiting" });
        return decision;
      }),
      stop: authed.workflows.stop.handler(async ({ context, input }) => {
        await stopWorkflowExecution(deps.prisma, context.actor, input.executionId);
        return { ok: true as const };
      }),
    },
  };
}
