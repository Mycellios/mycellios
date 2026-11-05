import { randomUUID } from "node:crypto";
import { ORPCError } from "@orpc/server";
import {
  createWorkflowExecution,
  ownedWorkflow,
  scheduledWorkflow,
  workflowDto,
  workflowExecutionDto,
} from "@rakazo/adapters";
import type { ExecutionRow, WorkflowRow } from "@rakazo/adapters";
import type { WorkflowGraph } from "@rakazo/contracts";
import { nextCronDate } from "@rakazo/core";
import { stopWorkflowExecution } from "@rakazo/db";
import type { RouterContext } from "./context.js";

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
        await deps.prisma
          .$executeRaw`INSERT INTO workflows (id,"spaceId","userId",name,graph) VALUES (${id},${context.actor.spaceId},${context.actor.userId},${input.name},${JSON.stringify(input.graph)}::jsonb) ON CONFLICT (id) DO NOTHING`;
        const row = await ownedWorkflow(deps.prisma, context.actor, id);
        if (!row) throw new ORPCError("CONFLICT");
        return workflowDto(row);
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
        const saved = await deps.prisma.$queryRaw<
          WorkflowRow[]
        >`UPDATE workflows SET name=${input.name},graph=${JSON.stringify(input.graph)}::jsonb,active=${input.active},"nextRunAt"=${next},version=version+1,"updatedAt"=now() WHERE id=${flow.id} AND "userId"=${context.actor.userId} AND "spaceId"=${context.actor.spaceId} AND version=${input.expectedVersion} AND "archivedAt" IS NULL RETURNING *`;
        if (!saved.length)
          throw new ORPCError("CONFLICT", {
            message: "This workflow changed on another device. Reload it before saving.",
          });
        return workflowDto(saved[0]!);
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
      stop: authed.workflows.stop.handler(async ({ context, input }) => {
        await stopWorkflowExecution(deps.prisma, context.actor, input.executionId);
        return { ok: true as const };
      }),
    },
  };
}
