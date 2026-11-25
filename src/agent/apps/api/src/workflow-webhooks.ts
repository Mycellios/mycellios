import { createHash } from "node:crypto";
import type { AdapterContext } from "@mycellios/adapter-kit";
import {
  createWorkflowExecution, type ExecutionRow, type WorkflowRow,
} from "@mycellios/adapters";
import { workflowPlan, type WorkflowGraph } from "@mycellios/contracts";
import { runAsSystem, runAsTenant, type Prisma, type PrismaClient } from "@mycellios/db";
import { redactSensitiveText } from "@mycellios/logging";
import type { Hono } from "hono";
import { readBoundedBytes } from "./http-body.js";
import {
  createRoutineWebhookSecret, matchRoutineEventSecret, parseStandardWebhookHeaders, routineEventTimestampFresh,
} from "./routine-events.js";
import { formatUntrustedDeliveryPayload, loadWebhookSecret, WEBHOOK_MAX_BODY_BYTES, type WebhookDeps } from "./webhook-inbound.js";

type Deps = Pick<WebhookDeps, "prisma" | "secrets">;
type Owner = { spaceId: string; userId: string };
const workflowIdPattern = /^[A-Za-z0-9_-]{1,160}$/;

export function workflowWebhookPath(id: string) {
  return `/api/v1/workflows/${encodeURIComponent(id)}/events`;
}

function webhookTrigger(graph: WorkflowGraph) {
  const triggers = graph.nodes.filter(node => node.kind === "trigger" && node.trigger === "webhook");
  if (triggers.length !== 1) throw new Error("Add exactly one webhook trigger.");
  workflowPlan(graph, triggers[0]!.id);
  return triggers[0]!;
}

async function lockWorkflow(tx: Prisma.TransactionClient, id: string, scope: Owner) {
  const [flow] = await tx.$queryRaw<WorkflowRow[]>`
    SELECT * FROM workflows WHERE id=${id} AND "spaceId"=${scope.spaceId} AND "userId"=${scope.userId}
      AND "archivedAt" IS NULL FOR UPDATE`;
  return flow;
}

export async function replaceWorkflowWebhook(deps: Deps, id: string, version: number, context: AdapterContext) {
  const scope = { spaceId: context.spaceId, userId: context.userId };
  const secret = createRoutineWebhookSecret();
  const encrypted = await deps.secrets.put(secret, context);
  return deps.prisma.$transaction(async tx => {
    const flow = await lockWorkflow(tx, id, scope);
    if (!flow || flow.version !== version) return null;
    webhookTrigger(flow.graph);
    const material = { ...scope, version, secretId: encrypted.id, ciphertext: encrypted.ciphertext, createdAt: new Date() };
    await tx.workflowWebhook.upsert({
      where: { workflowId: id }, create: { workflowId: id, ...material }, update: material,
    });
    return { version, path: workflowWebhookPath(id), secret };
  });
}

export async function revokeWorkflowWebhook(prisma: PrismaClient, id: string, scope: Owner) {
  return prisma.$transaction(async tx => {
    if (!(await lockWorkflow(tx, id, scope))) return false;
    await tx.workflowWebhook.deleteMany({ where: { workflowId: id, spaceId: scope.spaceId, userId: scope.userId } });
    return true;
  });
}

export function mountWorkflowWebhooks(app: Hono, deps: Deps) {
  const cache = new Map();
  app.post("/api/v1/workflows/:id/events", async c => {
    c.header("Cache-Control", "private, no-store");
    const id = c.req.param("id");
    const headers = parseStandardWebhookHeaders(name => c.req.header(name));
    const now = new Date();
    const unauth = () => c.json({ error: "Unauthorized" }, 401);
    if (!workflowIdPattern.test(id) || !headers || !routineEventTimestampFresh(headers.timestamp, now)) return unauth();
    const row = await runAsSystem("look up an exact workflow webhook credential", () =>
      deps.prisma.workflowWebhook.findUnique({ where: { workflowId: id } }),
    );
    if (!row) return unauth();
    const bytes = await readBoundedBytes(c.req.raw, WEBHOOK_MAX_BODY_BYTES);
    if (bytes === null) return c.json({ error: "Payload too large" }, 413);
    const secret = await loadWebhookSecret(deps.secrets, cache, id, { id: row.secretId, ciphertext: row.ciphertext });
    if (!secret || matchRoutineEventSecret(headers, bytes, [secret]) < 0) return unauth();
    let payload: unknown;
    try { payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
    catch { return c.json({ error: "Invalid JSON event" }, 400); }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return c.json({ error: "Expected an event object" }, 400);
    const output = redactSensitiveText(formatUntrustedDeliveryPayload("Workflow webhook payload", payload));
    if (output.length > 20_000) return c.json({ error: "Event data is too large" }, 413);
    const nonce = `workflow-event:${createHash("sha256").update(JSON.stringify([id, headers.id])).digest("hex")}`;
    const scope = { spaceId: row.spaceId, userId: row.userId };
    const result = await runAsTenant(scope, () => deps.prisma.$transaction(async tx => {
      const flow = await lockWorkflow(tx, id, scope);
      const current = await tx.workflowWebhook.findUnique({ where: { workflowId: id }, select: { secretId: true, version: true } });
      const owner = await tx.spaceMember.findFirst({ where: { ...scope, role: "owner" }, select: { id: true } });
      if (!flow || !owner || current?.secretId !== row.secretId) return { kind: "unauthorized" } as const;
      const duplicates = await tx.$queryRaw<ExecutionRow[]>`
        SELECT id FROM workflow_executions WHERE "workflowId"=${id} AND "spaceId"=${scope.spaceId}
          AND "userId"=${scope.userId} AND "clientNonce"=${nonce}`;
      if (duplicates[0]) return { kind: "duplicate", executionId: duplicates[0].id } as const;
      if (flow.version !== current.version) return { kind: "paused" } as const;
      const open = await tx.workflowExecution.count({ where: {
        ...scope, workflowId: id, status: { in: ["queued", "running"] },
      } });
      if (open) return { kind: "busy" } as const;
      const accepted = await tx.workflowExecution.count({ where: {
        ...scope, workflowId: id, clientNonce: { startsWith: "workflow-event:" },
        createdAt: { gt: new Date(now.getTime() - 3600_000) },
      } });
      if (accepted >= 60) return { kind: "limited" } as const;
      const execution = await createWorkflowExecution(tx, flow, webhookTrigger(flow.graph).id, nonce, output);
      return { kind: "queued", executionId: execution.id } as const;
    }));
    if (result.kind === "unauthorized") return unauth();
    if (result.kind === "paused") return c.json({ status: "paused" }, 202);
    if (result.kind === "busy") return c.json({ error: "Workflow already running" }, 409);
    if (result.kind === "limited") {
      c.header("Retry-After", "3600");
      return c.json({ error: "Workflow webhook limit reached" }, 429);
    }
    if (result.kind === "duplicate") return c.json({ duplicate: true, executionId: result.executionId }, 200);
    return c.json({ status: "queued", executionId: result.executionId }, 202);
  });
}
