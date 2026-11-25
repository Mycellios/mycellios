import { z } from "zod";
import type { ConnectorTool } from "@mycellios/adapter-kit";
import {
  WorkflowGraphSchema, WorkflowStepSchema, validateWorkflowAnswer, workflowAnswerSchema, type WorkflowAnswerField,
} from "@mycellios/contracts";
import type { PrismaClient } from "@mycellios/db";
import { redactSensitiveText } from "@mycellios/logging";

export const workflowAnswerEffect = "workflow_answer";

export async function workflowAnswerFields(
  prisma: PrismaClient,
  run: { id: string; spaceId: string; userId: string; botId: string; trigger: string },
  thread: { taskKey?: string | null; projectKey?: string | null },
) {
  if (run.trigger !== "workflow" || !thread.taskKey?.startsWith("workflow:") ||
      !thread.projectKey?.startsWith("workflow:")) return undefined;
  const executionId = thread.taskKey.split(":")[1];
  if (!executionId) return undefined;
  const record = await prisma.workflowExecution.findFirst({
    where: { id: executionId, workflowId: thread.projectKey.slice(9), spaceId: run.spaceId, userId: run.userId, status: "running" },
    select: { graph: true, steps: true },
  });
  if (!record || !record.steps || typeof record.steps !== "object" || Array.isArray(record.steps)) return undefined;
  const graph = WorkflowGraphSchema.safeParse(record.graph);
  if (!graph.success) return undefined;
  const steps = record.steps;
  return graph.data.nodes.find(node => {
    if (node.kind !== "agent" || node.botId !== run.botId || !Object.hasOwn(steps, node.id)) return false;
    const step = WorkflowStepSchema.safeParse(steps[node.id]);
    return step.success && step.data.status === "running" && step.data.runId === run.id;
  })?.answerFields;
}

export function workflowAnswerTool(fields: readonly WorkflowAnswerField[]): ConnectorTool {
  return {
    name: workflowAnswerEffect,
    description: "Submit the checked answer fields for this step. Return their values as structured data.",
    inputSchema: z.toJSONSchema(workflowAnswerSchema(fields)),
    readOnly: true,
  };
}

export async function saveWorkflowAnswer(
  prisma: PrismaClient,
  run: { id: string; spaceId: string; userId: string; botId: string; workerId: string; fence: number },
  fields: readonly WorkflowAnswerField[],
  args: unknown,
  hideRunSecrets: (text: string) => string,
) {
  const answer = validateWorkflowAnswer(fields, args);
  if (!answer) return { error: "Return each declared field using the type shown in workflow_answer." };
  const scrub = (text: string) => redactSensitiveText(hideRunSecrets(text));
  const scrubbed = Object.fromEntries(Object.entries(answer).map(([key, value]) => [
    key, typeof value === "string" ? scrub(value) : Array.isArray(value) ? value.map(scrub) : value,
  ]));
  const stored = validateWorkflowAnswer(fields, scrubbed);
  if (!stored) return { error: "Use only non-sensitive values in the declared fields." };
  return prisma.$transaction(async tx => {
    const exact = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM runs WHERE id=${run.id} AND "spaceId"=${run.spaceId} AND "userId"=${run.userId}
        AND "botId"=${run.botId} AND "leaseOwner"=${run.workerId} AND "leaseFence"=${run.fence}
        AND trigger='workflow' AND status='running' FOR UPDATE`;
    if (!exact.length) return { error: "This workflow step is no longer running." };
    await tx.externalEffect.createMany({
      data: [{
        spaceId: run.spaceId, runId: run.id, kind: workflowAnswerEffect,
        idempotencyKey: `workflow-answer:${run.id}`, request: {}, result: stored, status: "completed",
      }],
      skipDuplicates: true,
    });
    return { saved: true };
  });
}
