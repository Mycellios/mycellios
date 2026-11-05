import { createHash } from "node:crypto";
import type { ConnectorTool } from "@rakazo/adapter-kit";
import { WorkflowGraphSchema, workflowPlan } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import { z } from "zod";
import {
  createWorkflowExecution,
  ownedWorkflow,
  scheduledWorkflow,
  workflowDto,
  workflowExecutionDto,
  type WorkflowRow,
} from "./workflows.js";
import { nextCronDate } from "@rakazo/core";

export const WORKFLOW_TOOL_NAMES = ["list_workflows", "save_workflow", "run_workflow"] as const;
const saveInput = z.object({
  id: z.string().min(1).max(160).optional(),
  expectedVersion: z.number().int().positive().optional(),
  name: z.string().trim().min(1).max(160),
  graph: WorkflowGraphSchema,
  active: z.boolean().default(false),
});
const runInput = z.object({
  id: z.string().min(1).max(160),
  expectedVersion: z.number().int().positive(),
  triggerId: z.string().min(1).max(160),
});
export const workflowTools: ConnectorTool[] = [
  {
    name: "list_workflows",
    description:
      "List the current owner's workflows in this Space, including their saved graph and version.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "save_workflow",
    description:
      "Create or update an explicitly requested workflow using existing Micos. Inspect saved versions first; updates require expectedVersion. Include a trigger and agent step, and yes/no branches for conditions. Never put credentials in graph text. Does not execute the workflow. No deletion tool is provided.",
    inputSchema: z.toJSONSchema(saveInput),
  },
  {
    name: "run_workflow",
    description:
      "Run a saved workflow only when the owner requested execution. Its selected Micos retain existing model permissions and billing. Requires the exact saved version and trigger id.",
    inputSchema: z.toJSONSchema(runInput),
  },
];

export async function executeWorkflowTool(
  prisma: PrismaClient,
  actorInput: { userId: string; spaceId: string },
  name: string,
  input: unknown,
  effectKey: string,
) {
  const actor = { userId: actorInput.userId, spaceId: actorInput.spaceId };
  if (name === "list_workflows")
    return (
      await prisma.$queryRaw<
        WorkflowRow[]
      >`SELECT * FROM workflows WHERE "userId"=${actor.userId} AND "spaceId"=${actor.spaceId} AND "archivedAt" IS NULL ORDER BY "updatedAt" DESC LIMIT 100`
    ).map(workflowDto);
  if (name === "save_workflow") {
    const args = saveInput.parse(input);
    const triggers = args.graph.nodes.filter((node) => node.kind === "trigger");
    if (!triggers.length) throw new Error("A workflow needs a trigger");
    for (const trigger of triggers) workflowPlan(args.graph, trigger.id);
    for (const id of new Set(args.graph.nodes.flatMap((node) => (node.botId ? [node.botId] : []))))
      if (
        !(await prisma.bot.findFirst({
          where: { id, ...actor, archivedAt: null },
          select: { id: true },
        }))
      )
        throw new Error("The selected Mico is unavailable in this Space");
    const id =
      args.id ??
      `workflow-${createHash("sha256")
        .update(JSON.stringify([actor, effectKey]))
        .digest("hex")
        .slice(0, 32)}`;
    const nextRunAt = args.active
      ? (() => {
          const trigger = scheduledWorkflow(args.graph);
          return nextCronDate(trigger.cron!, new Date(), trigger.timezone || "UTC");
        })()
      : null;
    if (!args.id) {
      await prisma.$executeRaw`INSERT INTO workflows (id,"spaceId","userId",name,graph,active,"nextRunAt") VALUES (${id},${actor.spaceId},${actor.userId},${args.name},${JSON.stringify(args.graph)}::jsonb,${args.active},${nextRunAt}) ON CONFLICT (id) DO NOTHING`;
    } else {
      if (!args.expectedVersion)
        throw new Error("Read the saved workflow and provide expectedVersion");
      const changed =
        await prisma.$executeRaw`UPDATE workflows SET name=${args.name},graph=${JSON.stringify(args.graph)}::jsonb,active=${args.active},"nextRunAt"=${nextRunAt},version=version+1,"updatedAt"=now() WHERE id=${id} AND "userId"=${actor.userId} AND "spaceId"=${actor.spaceId} AND version=${args.expectedVersion} AND "archivedAt" IS NULL`;
      if (!changed)
        throw new Error("The workflow changed or is unavailable. Reload before editing.");
    }
    const row = await ownedWorkflow(prisma, actor, id);
    if (!row) throw new Error("Workflow unavailable");
    return workflowDto(row);
  }
  if (name === "run_workflow") {
    const args = runInput.parse(input);
    return prisma.$transaction(async (tx) => {
      const flow = (
        await tx.$queryRaw<
          WorkflowRow[]
        >`SELECT * FROM workflows WHERE id=${args.id} AND "spaceId"=${actor.spaceId} AND "userId"=${actor.userId} AND "archivedAt" IS NULL FOR UPDATE`
      )[0];
      if (!flow || flow.version !== args.expectedVersion)
        throw new Error("Reload the saved workflow before executing it");
      return workflowExecutionDto(
        await createWorkflowExecution(
          tx,
          flow,
          args.triggerId,
          `tool:${createHash("sha256").update(effectKey).digest("hex")}`,
        ),
      );
    });
  }
  throw new Error("Unknown workflow tool");
}
