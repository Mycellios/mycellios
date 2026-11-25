import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import { Hono } from "hono";
import { EncryptedSecretStore } from "../packages/adapters/src/secrets.js";
import { mountWorkflowWebhooks, replaceWorkflowWebhook, revokeWorkflowWebhook, workflowWebhookPath } from "../apps/api/src/workflow-webhooks.js";
import { signRoutineEvent } from "../apps/api/src/routine-events.js";
import { WorkflowGraphSchema } from "@mycellios/contracts";
import { createDb, asSystem, isOwnedWorkflowThread } from "@mycellios/db";
import { createWorkflowExecution, decideWorkflowApproval, ownedWorkflow, reconcileWorkflowExecutions, restoreWorkflowVersion, saveWorkflowRevision, snapshotWorkflow } from "../packages/adapters/src/workflows.js";

// Fresh synthetic loopback database only; never load existing accounts or .env.
process.env.RAKAZO_PROJECT_LOCAL = "1";
process.env.CONTENT_ENCRYPTION = "off";
const listener = createServer();
await new Promise<void>(resolve => listener.listen(0, "127.0.0.1", resolve));
const port = (listener.address() as { port: number }).port;
await new Promise<void>(resolve => listener.close(() => resolve()));
const directory = await mkdtemp(path.join(tmpdir(), "mycellios-workflow-thread-"));
const password = randomBytes(24).toString("hex");
const postgres = new EmbeddedPostgres({ databaseDir: path.join(directory, "pg"), port, user: "postgres", password, persistent: true, autoRehydrateSymlinks: true, onLog: () => {}, onError: () => {} });
let db: ReturnType<typeof createDb> | undefined;
try {
  await postgres.initialise(); await postgres.start();
  const url = `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`;
  await promisify(execFile)(process.execPath, [path.resolve("node_modules/prisma/build/index.js"), "db", "push", "--config", "packages/db/prisma.config.ts"], { windowsHide: true, env: { ...process.env, DATABASE_URL: url, DATABASE_MIGRATION_URL: url }, maxBuffer: 1024 * 1024 });
  const migrationClient = new pg.Client({ connectionString: url });
  await migrationClient.connect();
  try {
    await migrationClient.query("DROP TABLE workflow_webhooks; DROP TABLE workflow_versions");
    await migrationClient.query(await readFile("packages/db/prisma/migrations/20261125200000_workflow_revision_history/migration.sql", "utf8"));
    await migrationClient.query(await readFile("packages/db/prisma/migrations/20261125210000_workflow_signed_webhooks/migration.sql", "utf8"));
  } finally { await migrationClient.end(); }
  db = createDb(url, { encryptContent: false, applicationName: "synthetic-workflow-thread-regression" });
  const prisma = asSystem(db.prisma, "isolated workflow thread regression");
  const suffix = randomUUID();
  const scope = { userId: `user-${suffix}`, spaceId: `space-${suffix}` };
  await prisma.user.create({ data: { id: scope.userId, name: "Synthetic", email: `${suffix}@example.invalid` } });
  await prisma.organization.create({ data: { id: suffix, name: "Synthetic", slug: suffix, createdAt: new Date() } });
  await prisma.space.create({ data: { id: scope.spaceId, organizationId: suffix, name: "Synthetic" } });
  const bot = await prisma.bot.create({ data: { ...scope, name: "Synthetic", color: "green" } });
  const flow = await prisma.workflow.create({ data: { ...scope, id: randomUUID(), name: "Synthetic", graph: {} } });
  const execution = await prisma.workflowExecution.create({ data: { ...scope, id: randomUUID(), workflowId: flow.id, version: 1, graph: {}, triggerId: "start", clientNonce: randomUUID() } });
  const taskKey = `workflow:${execution.id}:mico`;
  const thread = await prisma.thread.create({ data: { ...scope, taskBotId: bot.id, taskKey, projectKey: `workflow:${flow.id}` } });
  const task = await prisma.task.create({ data: { ...scope, botId: bot.id, threadId: thread.id, prompt: "Synthetic", status: "running" } });
  const run = await prisma.run.create({ data: { ...scope, botId: bot.id, threadId: thread.id, taskId: task.id, status: "queued", trigger: "workflow", clientNonce: taskKey } });
  assert.equal(await isOwnedWorkflowThread(prisma, run, thread), true);
  assert.equal(await isOwnedWorkflowThread(prisma, { ...run, userId: "another-user" }, thread), false);
  assert.equal(await isOwnedWorkflowThread(prisma, { ...run, spaceId: "another-space" }, thread), false);
  assert.equal(await isOwnedWorkflowThread(prisma, run, { ...thread, id: "another-thread" }), false);
  assert.equal(await isOwnedWorkflowThread(prisma, run, { ...thread, taskBotId: "another-bot" }), false);
  assert.equal(await isOwnedWorkflowThread(prisma, run, { ...thread, taskKey: `workflow:${execution.id}:another-step` }), false);
  await prisma.member.create({ data: { id: randomUUID(), organizationId: suffix, userId: scope.userId, role: "owner", createdAt: new Date() } });
  await prisma.spaceMember.create({ data: { id: randomUUID(), ...scope, organizationId: suffix, role: "owner", createdAt: new Date() } });
  const graph = {
    nodes: [
      { id: "start", kind: "trigger", x: 0, y: 0, trigger: "manual" },
      { id: "review", kind: "approval", x: 1, y: 0, text: "Continue with this run?" },
      { id: "mico", kind: "agent", x: 2, y: 0, botId: bot.id, text: "Synthetic step" },
    ],
    edges: [
      { id: "one", from: "start", to: "review" },
      { id: "two", from: "review", to: "mico" },
    ],
  };
  async function createReview() {
    const reviewFlow = await prisma.workflow.create({ data: { ...scope, id: randomUUID(), name: "Review", graph } });
    return prisma.workflowExecution.create({ data: {
      ...scope, id: randomUUID(), workflowId: reviewFlow.id, version: 1, graph,
      triggerId: "start", clientNonce: randomUUID(),
    } });
  }
  const jobs = { enqueue: async () => {}, cancel: async () => {}, close: async () => {} };
  const toApprove = await createReview();
  const toReject = await createReview();
  await reconcileWorkflowExecutions(prisma, jobs);
  const approvedInput = { executionId: toApprove.id, stepId: "review", decision: "approved" as const };
  const rejection = { executionId: toReject.id, stepId: "review", decision: "rejected" as const };
  const downstream = (executionId: string) => prisma.run.count({ where: { ...scope, clientNonce: `workflow:${executionId}:mico` } });
  assert.equal(await downstream(toApprove.id), 0);
  assert.equal(await downstream(toReject.id), 0);
  assert.equal(await decideWorkflowApproval(prisma, { ...scope, spaceId: "foreign" }, approvedInput), "not_found");
  assert.equal(await decideWorkflowApproval(prisma, { ...scope, userId: "foreign" }, approvedInput), "not_found");
  assert.equal(await decideWorkflowApproval(prisma, scope, { ...approvedInput, stepId: "start" }), "conflict");
  const approved = await decideWorkflowApproval(prisma, scope, approvedInput);
  const rejected = await decideWorkflowApproval(prisma, scope, rejection);
  assert.equal(typeof approved === "object" && approved.steps.review?.approval?.state, "approved");
  assert.equal(typeof rejected === "object" && rejected.status, "cancelled");
  assert.deepEqual(await decideWorkflowApproval(prisma, scope, approvedInput), approved);
  assert.equal(await decideWorkflowApproval(prisma, scope, { ...approvedInput, decision: "rejected" }), "conflict");
  await reconcileWorkflowExecutions(prisma, jobs);
  await reconcileWorkflowExecutions(prisma, jobs);
  assert.equal(await downstream(toApprove.id), 1);
  assert.equal(await downstream(toReject.id), 0);
  async function createParallel(approval = false) {
    const branches = {
      nodes: [
        { id: "start", kind: "trigger", x: 0, y: 0, trigger: "manual" },
        { id: "left", kind: "agent", x: 1, y: -1, botId: bot.id, text: "Left branch" },
        approval
          ? { id: "right", kind: "approval", x: 1, y: 1, text: "Review before joining" }
          : { id: "right", kind: "agent", x: 1, y: 1, botId: bot.id, text: "Right branch" },
        { id: "join", kind: "agent", x: 2, y: 0, botId: bot.id, text: "Combine the results" },
      ],
      edges: [
        { id: "one", from: "start", to: "left" },
        { id: "two", from: "start", to: "right" },
        { id: "three", from: "left", to: "join" },
        { id: "four", from: "right", to: "join" },
      ],
    };
    const workflow = await prisma.workflow.create({ data: { ...scope, id: randomUUID(), name: "Parallel test", graph: branches } });
    return prisma.workflowExecution.create({ data: {
      ...scope, id: randomUUID(), workflowId: workflow.id, version: 1, graph: branches,
      triggerId: "start", clientNonce: randomUUID(),
    } });
  }
  const parallel = await createParallel(), failure = await createParallel(), interrupted = await createParallel(true);
  const branchRun = (id: string, step: string) => prisma.run.findFirst({ where: { ...scope, clientNonce: `workflow:${id}:${step}` } });
  await Promise.all([reconcileWorkflowExecutions(prisma, jobs), reconcileWorkflowExecutions(prisma, jobs)]);
  assert.equal(await prisma.run.count({ where: { ...scope, clientNonce: { startsWith: `workflow:${parallel.id}:` } } }), 2);
  const [left, right, failed, sibling, runningWhenRejected] = await Promise.all([
    branchRun(parallel.id, "left"), branchRun(parallel.id, "right"), branchRun(failure.id, "left"),
    branchRun(failure.id, "right"), branchRun(interrupted.id, "left"),
  ]);
  assert.ok(left && right && failed && sibling && runningWhenRejected);
  assert.equal(await branchRun(parallel.id, "join"), null);
  await prisma.run.update({ where: { id: left.id }, data: { status: "completed" } });
  await prisma.run.update({ where: { id: failed.id }, data: { status: "failed", error: "Synthetic failure" } });
  await reconcileWorkflowExecutions(prisma, jobs);
  assert.equal(await branchRun(parallel.id, "join"), null);
  assert.equal((await prisma.run.findUniqueOrThrow({ where: { id: sibling.id } })).status, "cancelled");
  assert.equal((await prisma.workflowExecution.findUniqueOrThrow({ where: { id: failure.id } })).status, "failed");
  assert.equal(await branchRun(failure.id, "join"), null);
  await prisma.run.update({ where: { id: right.id }, data: { status: "completed" } });
  await reconcileWorkflowExecutions(prisma, jobs);
  await reconcileWorkflowExecutions(prisma, jobs);
  assert.ok(await branchRun(parallel.id, "join"));
  assert.equal(await prisma.run.count({ where: { ...scope, clientNonce: { startsWith: `workflow:${parallel.id}:` } } }), 3);
  const stopped = await decideWorkflowApproval(prisma, scope, { executionId: interrupted.id, stepId: "right", decision: "rejected" });
  assert.equal(typeof stopped === "object" && stopped.status, "cancelled");
  assert.equal((await prisma.run.findUniqueOrThrow({ where: { id: runningWhenRejected.id } })).status, "cancelled");
  assert.equal(await branchRun(interrupted.id, "join"), null);
  const savedGraph = WorkflowGraphSchema.parse(graph);
  const historyFlow = await prisma.workflow.create({ data: { ...scope, id: randomUUID(), name: "Original", graph: savedGraph } });
  const save = (version: number, name: string) => prisma.$transaction(tx => saveWorkflowRevision(tx, scope, {
    id: historyFlow.id, expectedVersion: version, name, graph: savedGraph, active: false, nextRunAt: null,
  }));
  assert.equal((await save(1, "First snapshot"))?.version, 2);
  assert.equal((await save(2, "Next edit"))?.version, 3);
  assert.equal(await prisma.workflowVersion.count({ where: { workflowId: historyFlow.id } }), 1);
  assert.equal(await save(2, "Stale edit"), null);
  await prisma.$transaction(async tx => {
    const current = await ownedWorkflow(tx, scope, historyFlow.id);
    assert.ok(current);
    await createWorkflowExecution(tx, current, "start", randomUUID());
  });
  assert.equal(await prisma.workflowVersion.count({ where: { workflowId: historyFlow.id } }), 2);
  const restore = { id: historyFlow.id, version: 2, expectedVersion: 3 };
  assert.equal(await restoreWorkflowVersion(prisma, { ...scope, userId: "other" }, restore), "missing");
  assert.equal(await restoreWorkflowVersion(prisma, scope, { ...restore, expectedVersion: 2 }), "conflict");
  const restored = await restoreWorkflowVersion(prisma, scope, restore);
  assert.ok(typeof restored === "object");
  assert.equal(restored.name, "First snapshot");
  assert.equal(restored.version, 4);
  assert.equal(restored.active, false);
  assert.equal(restored.nextRunAt, null);
  assert.equal(await prisma.workflowExecution.count({ where: { workflowId: historyFlow.id } }), 1);

  const retention = await prisma.workflow.create({ data: { ...scope, id: randomUUID(), version: 55, name: "Retention", graph: savedGraph } });
  await prisma.workflowVersion.createMany({ data: Array.from({ length: 54 }, (_, i) => ({
    ...scope, workflowId: retention.id, version: i + 1, name: "Earlier", graph: savedGraph,
  })) });
  await prisma.$transaction(async tx => {
    const current = await ownedWorkflow(tx, scope, retention.id);
    assert.ok(current);
    await snapshotWorkflow(tx, current, true);
  });
  const versions = await prisma.workflowVersion.findMany({ where: { workflowId: retention.id }, orderBy: { version: "asc" } });
  assert.equal(versions.length, 50);
  assert.deepEqual([versions[0]!.version, versions.at(-1)!.version], [6, 55]);

  const rls = new pg.Client({ connectionString: url });
  await rls.connect();
  try {
    await rls.query("CREATE ROLE workflow_revision_probe NOLOGIN; GRANT SELECT ON workflow_versions TO workflow_revision_probe; SET ROLE workflow_revision_probe");
    await rls.query("SELECT set_config('app.space_id', $1, false), set_config('app.user_id', $2, false)", [scope.spaceId, scope.userId]);
    assert.equal((await rls.query('SELECT version FROM workflow_versions WHERE "workflowId" = $1', [historyFlow.id])).rowCount, 3);
    await rls.query("SELECT set_config('app.user_id', 'foreign', false)");
    assert.equal((await rls.query('SELECT version FROM workflow_versions WHERE "workflowId" = $1', [historyFlow.id])).rowCount, 0);
  } finally { await rls.end(); }
  const webhookApp = new Hono();
  const deps = { prisma: db.prisma, secrets: new EncryptedSecretStore(randomBytes(32).toString("hex")) };
  mountWorkflowWebhooks(webhookApp, deps);
  const webhookGraph = WorkflowGraphSchema.parse({
    ...graph, nodes: graph.nodes.map(node => node.id === "start" ? { ...node, trigger: "webhook" } : node),
  });
  const hookFlow = await prisma.workflow.create({ data: { ...scope, id: randomUUID(), name: "Webhook fixture", graph: webhookGraph } });
  const context = { ...scope, operationId: "test", traceId: "test", signal: new AbortController().signal };
  const hook = await replaceWorkflowWebhook(deps, hookFlow.id, 1, context);
  assert.ok(hook);
  const savedHook = await prisma.workflowWebhook.findUniqueOrThrow({ where: { workflowId: hookFlow.id } });
  assert.ok(savedHook.ciphertext !== hook.secret && !savedHook.ciphertext.includes(hook.secret));
  const body = JSON.stringify({ type: "sample", data: { label: "Synthetic event", token: "sensitive-value" } });
  const send = (eventId: string, secret: string, options: { timestamp?: string; path?: string; tamper?: boolean } = {}) => {
    const timestamp = options.timestamp ?? String(Math.floor(Date.now() / 1000));
    const signature = signRoutineEvent(secret, eventId, timestamp, Buffer.from(body));
    return webhookApp.request(options.path ?? hook.path, {
      method: "POST", body: options.tamper ? body + " " : body,
      headers: { "webhook-id": eventId, "webhook-timestamp": timestamp, "webhook-signature": signature },
    });
  };
  assert.equal((await send("tampered", hook.secret, { tamper: true })).status, 401);
  assert.equal((await send("stale", hook.secret, { timestamp: "100" })).status, 401);
  assert.equal((await send("unknown", hook.secret, { path: workflowWebhookPath("unknown") })).status, 401);
  const pair = await Promise.all([send("once", hook.secret), send("once", hook.secret)]);
  assert.deepEqual(pair.map(reply => reply.status).sort(), [200, 202]);
  const bodies = await Promise.all(pair.map(reply => reply.json() as Promise<{ executionId: string }>));
  assert.equal(bodies[0].executionId, bodies[1].executionId);
  assert.equal((await send("busy", hook.secret)).status, 409);
  const delivered = await prisma.workflowExecution.findUniqueOrThrow({ where: { id: bodies[0].executionId } });
  assert.match(JSON.stringify(delivered.steps), /Untrusted delivery data/);
  assert.match(JSON.stringify(delivered.steps), /Synthetic event/);
  assert.doesNotMatch(JSON.stringify(delivered.steps), /sensitive-value/);
  await prisma.workflowExecution.update({ where: { id: delivered.id }, data: { status: "completed" } });
  await prisma.$transaction(tx => saveWorkflowRevision(tx, scope, {
    id: hookFlow.id, expectedVersion: 1, name: "New version", graph: webhookGraph, active: false, nextRunAt: null,
  }));
  assert.deepEqual(await (await send("paused", hook.secret)).json(), { status: "paused" });
  const replacement = await replaceWorkflowWebhook(deps, hookFlow.id, 2, context);
  assert.ok(replacement);
  assert.equal((await send("obsolete", hook.secret)).status, 401);
  assert.equal((await send("once", replacement.secret)).status, 200);
  assert.equal(await revokeWorkflowWebhook(deps.prisma, hookFlow.id, scope), true);
  assert.equal((await send("revoked", replacement.secret)).status, 401);
  assert.equal(await prisma.workflowExecution.count({ where: { workflowId: hookFlow.id } }), 1);
  console.log(JSON.stringify({ passed: true, checks: ["ownership", "approval replay", "parallel dependencies and cancellation", "version migration, RLS, snapshots, restore and retention", "signed webhook, replay, version, redaction and revocation"], fullRunActor: true, existingAccounts: false, modelsCalled: false }));
} finally {
  try {
    await db?.prisma.$disconnect();
    await db?.pool.end();
  } finally {
    await postgres.stop();
  }
}
