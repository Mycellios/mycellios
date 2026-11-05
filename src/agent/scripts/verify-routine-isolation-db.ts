import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import EmbeddedPostgres from "embedded-postgres";

// A fresh loopback cluster and synthetic accounts only. No existing database, models or keys.
process.env.RAKAZO_PROJECT_LOCAL = "1";
process.env.CONTENT_ENCRYPTION = "off";
const { createDb, asSystem, createThreadEvents, ensureRoutineThread, isOwnedRoutineThread, routineDeliveryRouting, claimMicoRun, controlWorkTree, workStatus, isOwnedWorkflowThread, stopWorkflowExecution } = await import("@rakazo/db");
const { createWorkflowExecution, reconcileWorkflowExecutions } = await import("../packages/adapters/src/workflows.js");
const { executeWorkflowTool } = await import("../packages/adapters/src/workflow-tools.js");
const { acquireComputerExecutionLease, releaseComputerExecutionLease } = await import("../packages/adapters/src/computer-lifecycle.js");
const { deliverWebhookEvent, inboundDeliveryClientNonce } = await import("../apps/api/src/webhook-inbound.js");
const { findPendingRoutineTick, routineTimerNonce } = await import("../packages/adapters/src/routine-coalescing.js");
const server = createServer(); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const port = (server.address() as { port: number }).port; await new Promise<void>(resolve => server.close(() => resolve()));
const directory = await mkdtemp(path.join(tmpdir(), "mycellios-routine-acceptance-"));
const password = randomBytes(24).toString("hex");
const database = new EmbeddedPostgres({ databaseDir: path.join(directory, "pg"), port, user: "postgres", password,
  persistent: true, autoRehydrateSymlinks: true, onLog: () => {}, onError: () => {} });
let db: ReturnType<typeof createDb> | undefined;
const checks: string[] = [];
try {
  await database.initialise(); await database.start();
  const url = `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`;
  await promisify(execFile)(process.execPath, [path.resolve("node_modules/prisma/build/index.js"), "db", "push", "--config", "packages/db/prisma.config.ts"],
    { windowsHide: true, env: { ...process.env, DATABASE_URL: url, DATABASE_MIGRATION_URL: url }, maxBuffer: 1024 * 1024 });
  const sql = database.getPgClient(); await sql.connect();
  try {
    const address = await sql.query("SHOW listen_addresses");
    assert.match(address.rows[0].listen_addresses, /^(localhost|127\.0\.0\.1|::1)$/);
    await sql.query('DROP TABLE "routine_delivery_receipts"');
    await sql.query(await readFile("packages/db/prisma/migrations/20261104200000_routine_delivery_routing/migration.sql", "utf8"));
    checks.push("actual additive routing migration applies to an isolated PostgreSQL schema");
    await sql.query('ALTER TABLE bots DROP COLUMN "taskConcurrency"');
    await sql.query(await readFile("packages/db/prisma/migrations/20261105100000_mico_concurrency/migration.sql", "utf8"));
    await sql.query('DROP TABLE workflow_executions; DROP TABLE workflows');
    await sql.query(await readFile("packages/db/prisma/migrations/20261105101000_workflow_canvas/migration.sql", "utf8"));
    checks.push("actual additive Mico concurrency and workflow migrations apply with owned foreign keys");
  } finally { await sql.end(); }
  db = createDb(url, { encryptContent: false, applicationName: "synthetic-routine-acceptance" });
  const prisma = asSystem(db.prisma, "isolated routine acceptance fixtures");
  const suffix = randomUUID();
  const scope = { spaceId: `space-${suffix}`, userId: `owner-${suffix}` };
  await prisma.user.create({ data: { id: scope.userId, name: "Synthetic owner", email: `${suffix}@example.invalid` } });
  await prisma.organization.create({ data: { id: `org-${suffix}`, name: "Synthetic", slug: suffix, createdAt: new Date() } });
  await prisma.space.create({ data: { id: scope.spaceId, name: "Synthetic", organizationId: `org-${suffix}` } });
  await prisma.member.create({ data: { id: `member-${suffix}`, organizationId: `org-${suffix}`, userId: scope.userId, role: "owner", createdAt: new Date() } });
  await prisma.spaceMember.create({ data: { id: `membership-${suffix}`, ...scope, organizationId: `org-${suffix}`, role: "owner", createdAt: new Date() } });
  const bot = await prisma.bot.create({ data: { ...scope, name: "Synthetic Mico", color: "#10B981", thread: { create: { ...scope } } }, include: { thread: true } });
  const routines = await Promise.all(["A", "B"].map(name => prisma.routine.create({ data: {
    ...scope, botId: bot.id, name: `Synthetic ${name}`, prompt: `Synthetic ${name} task`, crons: [], active: true,
    webhookEnabled: true, modelProvider: "openai-compatible", modelId: `synthetic-${name}`,
  } })));
  const [one, duplicate] = await Promise.all([ensureRoutineThread(prisma, scope, routines[0]!.id), ensureRoutineThread(prisma, scope, routines[0]!.id)]);
  assert.equal(one.id, duplicate.id); assert.notEqual(one.id, bot.thread!.id);
  const own = await prisma.thread.findUniqueOrThrow({ where: { id: one.id } });
  assert.equal(await isOwnedRoutineThread(prisma, scope, own), true);
  await assert.rejects(ensureRoutineThread(prisma, { ...scope, userId: "foreign" }, routines[0]!.id));
  assert.equal(await isOwnedRoutineThread(prisma, { ...scope, spaceId: "foreign" }, own), false);
  checks.push("concurrent first preparation creates one private thread and refuses another owner or Space");
  const events = createThreadEvents(prisma);
  const jobs: unknown[] = [];
  const deps = { prisma, events, jobs: { enqueue: async (job: unknown) => { jobs.push(job); } } };
  const target = { bot: { id: bot.id, ...scope }, threadId: bot.thread!.id };
  const input = { source: "webhook" as const, idempotencyKey: "synthetic-delivery", prompt: "Untrusted synthetic event data", routines };
  await Promise.all([deliverWebhookEvent(deps, target, input), deliverWebhookEvent(deps, target, input)]);
  assert.equal(await prisma.run.count({ where: { botId: bot.id } }), 2);
  assert.equal(await prisma.message.count({ where: { threadId: bot.thread!.id } }), 0);
  const runs = await prisma.run.findMany({ where: { botId: bot.id }, include: { thread: true }, orderBy: { modelId: "asc" } });
  assert.equal(new Set(runs.map(run => run.threadId)).size, 2);
  assert.deepEqual(runs.map(run => run.modelId), ["synthetic-A", "synthetic-B"]);
  assert.ok(runs.every(run => run.modelPinned && run.routineId && run.thread.taskBotId === bot.id));
  assert.equal(await prisma.routineDeliveryReceipt.count({ where: { botId: bot.id } }), 1);
  checks.push("duplicate signed delivery produces one run per routine with independent models and no primary-chat messages");
  await events.clearThread({ ...scope, botId: bot.id, threadId: one.id });
  const later = await prisma.routine.create({ data: { ...scope, botId: bot.id, name: "Synthetic C", prompt: "Do not run on an earlier delivery", crons: [], active: true, webhookEnabled: true } });
  await deliverWebhookEvent(deps, target, { ...input, routines: [...routines, later] });
  assert.equal(await prisma.run.count({ where: { botId: bot.id } }), 2);
  assert.equal(await prisma.message.count({ where: { threadId: one.id } }), 0);
  assert.equal(await prisma.run.count({ where: { routineId: later.id } }), 0);
  checks.push("clearing history or adding another routine cannot replay an accepted delivery or change its recipients");
  const old = await events.sendUserMessage({ ...scope, botId: bot.id, threadId: bot.thread!.id, blocks: [{ kind: "text", text: "Synthetic legacy event" }],
    prompt: "Synthetic legacy event", trigger: "webhook", clientNonce: inboundDeliveryClientNonce("webhook", bot.id, "legacy-delivery") });
  const reply = await deliverWebhookEvent(deps, target, { ...input, idempotencyKey: "legacy-delivery" });
  assert.equal(reply.runId, old.runId);
  assert.equal(await prisma.run.count({ where: { botId: bot.id } }), 3);
  checks.push("an older shared-chat delivery is acknowledged without replaying it into new threads");
  const frozen = await routineDeliveryRouting(prisma, { ...scope, botId: bot.id }, { source: "webhook", keyDigest: "a".repeat(64), routineIds: [routines[0]!.id] });
  const unchanged = await routineDeliveryRouting(prisma, { ...scope, botId: bot.id }, { source: "webhook", keyDigest: "a".repeat(64), routineIds: [later.id] });
  assert.deepEqual(unchanged.routineIds, frozen.routineIds);
  await assert.rejects(routineDeliveryRouting(prisma, { ...scope, userId: "foreign", botId: bot.id }, { source: "webhook", keyDigest: "a".repeat(64), routineIds: [] }));
  checks.push("routing receipts retain their first recipients and enforce Mico ownership");
  await deliverWebhookEvent(deps, target, { ...input, source: "github", routines: [], idempotencyKey: "github-disabled" });
  await prisma.routine.update({ where: { id: later.id }, data: { githubEnabled: true } });
  const ignored = await deliverWebhookEvent(deps, target, { ...input, source: "github", routines: [later], idempotencyKey: "github-disabled" });
  assert.equal(ignored.runId, null);
  assert.equal(await prisma.run.count({ where: { routineId: later.id } }), 0);
  checks.push("a GitHub delivery ignored before routines were enabled stays ignored on retry");
  const timer = await prisma.routine.create({ data: { ...scope, botId: bot.id, name: "Upgrade timer", prompt: "Synthetic timer", crons: ["* * * * *"], active: true } });
  const timerThread = await ensureRoutineThread(prisma, scope, timer.id);
  const timerRuns = [];
  for (const [index, threadId] of [bot.thread!.id, timerThread.id].entries()) {
    const task = await prisma.task.create({ data: { ...scope, botId: bot.id, threadId, prompt: timer.prompt, status: "queued" } });
    timerRuns.push(await prisma.run.create({ data: { ...scope, botId: bot.id, threadId, taskId: task.id, routineId: timer.id,
      status: "queued", trigger: "routine", clientNonce: routineTimerNonce(timer.id, new Date(1000 + index).toISOString()), createdAt: new Date(1000 + index) } }));
  }
  const retained = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM routines WHERE id = ${timer.id} FOR UPDATE`;
    return findPendingRoutineTick(tx, { ...scope, botId: bot.id, routineId: timer.id, threadId: timerThread.id,
      legacyPrimaryThreadId: bot.thread!.id, prompt: timer.prompt });
  });
  assert.equal(retained?.id, timerRuns[0]!.id);
  assert.equal((await prisma.run.findUniqueOrThrow({ where: { id: timerRuns[0]!.id } })).threadId, bot.thread!.id);
  assert.equal((await prisma.run.findUniqueOrThrow({ where: { id: timerRuns[1]!.id } })).status, "cancelled");
  assert.equal(retained?.cancelledEvents?.[0]?.threadId, timerThread.id);
  checks.push("upgrade catch-up retains unattempted timer work in its original thread without creating another tick");
  const slots = [];
  for (let n = 0; n < 6; n++) {
    const thread = await prisma.thread.create({ data: { ...scope, taskBotId: bot.id, projectKey: `mico:${bot.id}`, taskKey: `mico-task:${bot.id}:${n}` } });
    const task = await prisma.task.create({ data: { ...scope, botId: bot.id, threadId: thread.id, prompt: "Synthetic concurrency", status: "queued" } });
    slots.push(await prisma.run.create({ data: { ...scope, botId: bot.id, taskId: task.id, threadId: thread.id, status: "queued", trigger: "user" } }));
  }
  const claim = (run: typeof slots[number]) => claimMicoRun(prisma, run, { id: run.id, status: "queued", leaseFence: 0 },
    { status: "leased", leaseOwner: "synthetic-worker", leaseFence: 1, leaseExpiresAt: new Date(Date.now() + 60000) });
  const claims = await Promise.all(slots.map(claim)); assert.equal(claims.filter(value => value.count === 1).length, 4);
  const held = slots.find((_, index) => claims[index]!.count === 1)!;
  await prisma.run.updateMany({ where: { botId: bot.id, id: { not: held.id }, status: "leased" }, data: { status: "completed", leaseOwner: null, leaseExpiresAt: null } });
  const duplicateTask = await prisma.task.create({ data: { ...scope, botId: bot.id, threadId: held.threadId, prompt: "Same conversation", status: "queued" } });
  const duplicateRun = await prisma.run.create({ data: { ...scope, botId: bot.id, taskId: duplicateTask.id, threadId: held.threadId, status: "queued", trigger: "user" } });
  assert.equal((await claim(duplicateRun)).count, 0);
  const waiting = slots.find((_, index) => claims[index]!.count === 0)!;
  await prisma.bot.update({ where: { id: bot.id }, data: { agentEngine: "codex" } });
  assert.equal((await claim(waiting)).count, 0);
  await prisma.bot.update({ where: { id: bot.id }, data: { agentEngine: "pi", taskConcurrency: 1 } });
  assert.equal((await claim(waiting)).count, 0);
  assert.equal((await claimMicoRun(prisma, { ...waiting, userId: "foreign" }, { id: waiting.id }, { status: "leased" })).count, 0);
  await prisma.run.updateMany({ where: { botId: bot.id, status: "leased" }, data: { status: "completed", leaseOwner: null, leaseExpiresAt: null } });
  assert.equal((await claimMicoRun(prisma, { ...waiting, threadId: held.threadId }, { id: waiting.id, status: "queued" }, { status: "leased" })).count, 0);
  checks.push("simultaneous workers admit at most four Mico lanes, preserve one turn per thread, and enforce native/owner/configured limits");
  const computer = await prisma.computer.create({ data: { ...scope, scope: "team", scopeKey: `synthetic:${suffix}`, homeKey: `synthetic:${suffix}`, kind: "docker", state: "running" } });
  await prisma.bot.update({ where: { id: bot.id }, data: { computerId: computer.id } });
  const firstLease = await acquireComputerExecutionLease(prisma, { computerId: computer.id, botId: bot.id, runId: held.id });
  assert.ok(firstLease);
  await assert.rejects(acquireComputerExecutionLease(prisma, { computerId: computer.id, botId: bot.id, runId: waiting.id }));
  await releaseComputerExecutionLease(prisma, firstLease);
  const nextLease = await acquireComputerExecutionLease(prisma, { computerId: computer.id, botId: bot.id, runId: waiting.id });
  assert.ok(nextLease); await releaseComputerExecutionLease(prisma, nextLease);
  checks.push("parallel conversation admission never shares the same Mico computer lease across runs");
  const delegated = await prisma.task.create({ data: { ...scope, botId: bot.id, threadId: bot.thread!.id, prompt: "Synthetic parent", status: "queued", delegationState: "waiting" } });
  const child = await prisma.task.create({ data: { ...scope, botId: bot.id, threadId: held.threadId, prompt: "Synthetic child", status: "queued", parentTaskId: delegated.id, delegationRootId: delegated.id, delegationState: "queued" } });
  await controlWorkTree(prisma, { ...scope, email: "not-a-Prisma-field" } as typeof scope, { taskId: child.id, expectedRevision: child.delegationRevision, action: "pause" });
  const paused = await prisma.task.findUniqueOrThrow({ where: { id: child.id } }); assert.equal(paused.paused, true);
  await assert.rejects(controlWorkTree(prisma, scope, { taskId: child.id, expectedRevision: child.delegationRevision, action: "cancel" }));
  await prisma.task.update({ where: { id: child.id }, data: { workStopPending: false } });
  await controlWorkTree(prisma, scope, { taskId: child.id, expectedRevision: paused.delegationRevision, action: "cancel" });
  const cancelled = await prisma.task.findUniqueOrThrow({ where: { id: child.id } }); assert.equal(cancelled.delegationState, "cancelled");
  await assert.rejects(controlWorkTree(prisma, scope, { taskId: child.id, expectedRevision: cancelled.delegationRevision, action: "resume" }));
  assert.ok((await workStatus(prisma, { ...scope, taskId: delegated.id })).some(value => value.id === child.id && value.delegationState === "cancelled"));
  checks.push("delegated controls preserve version fences, reject stale changes and never silently resume cancelled work");
  const graph = { nodes: [
    { id: "start", kind: "trigger", trigger: "manual", title: "Start", text: "approved", x: 0, y: 0 },
    { id: "condition", kind: "condition", title: "Decision", text: "", x: 200, y: 0, condition: { operator: "contains", value: "approved" } },
    { id: "agent", kind: "agent", botId: bot.id, title: "Mico", text: "Synthetic task", x: 400, y: 0 },
    { id: "no", kind: "output", title: "No", text: "Rejected", x: 400, y: 200 },
    { id: "result", kind: "output", title: "Result", text: "", x: 600, y: 0 },
  ], edges: [{ id: "a", from: "start", to: "condition" }, { id: "b", from: "condition", to: "agent", branch: "yes" }, { id: "c", from: "condition", to: "no", branch: "no" }, { id: "d", from: "agent", to: "result" }] };
  const flow = await executeWorkflowTool(prisma, scope, "save_workflow", { name: "Synthetic workflow", graph }, "synthetic-save");
  const replayFlow = await executeWorkflowTool(prisma, scope, "save_workflow", { name: "Synthetic workflow", graph }, "synthetic-save");
  assert.equal((flow as { id: string }).id, (replayFlow as { id: string }).id);
  const flowId = (flow as { id: string }).id;
  const execution = await executeWorkflowTool(prisma, scope, "run_workflow", { id: flowId, expectedVersion: 1, triggerId: "start" }, "synthetic-execute") as { id: string };
  await reconcileWorkflowExecutions(prisma, deps.jobs);
  const stepRun = await prisma.run.findFirstOrThrow({ where: { clientNonce: `workflow:${execution.id}:agent` }, include: { thread: true } });
  assert.equal(stepRun.thread.taskBotId, bot.id); assert.notEqual(stepRun.threadId, bot.thread!.id);
  assert.equal(await isOwnedWorkflowThread(prisma, scope, stepRun.thread), true);
  await reconcileWorkflowExecutions(prisma, deps.jobs);
  assert.equal(await prisma.run.count({ where: { clientNonce: stepRun.clientNonce } }), 1);
  await prisma.message.create({ data: { threadId: stepRun.threadId, role: "bot", seq: 1, runId: stepRun.id, blocks: [{ kind: "text", text: "Synthetic verified result" }] } });
  await prisma.run.update({ where: { id: stepRun.id }, data: { status: "completed" } });
  await reconcileWorkflowExecutions(prisma, deps.jobs);
  const finished = await prisma.workflowExecution.findUniqueOrThrow({ where: { id: execution.id } });
  assert.equal(finished.status, "completed");
  assert.equal((finished.steps as Record<string, { status: string }>).no?.status, "skipped");
  assert.match((finished.steps as Record<string, { output?: string }>).result?.output ?? "", /Synthetic verified result/);
  await assert.rejects(executeWorkflowTool(prisma, { ...scope, userId: "foreign" }, "run_workflow", { id: flowId, expectedVersion: 1, triggerId: "start" }, "foreign-execute"));
  await assert.rejects(executeWorkflowTool(prisma, scope, "save_workflow", { id: flowId, expectedVersion: 99, name: "Stale edit", graph }, "stale-save"));
  checks.push("workflows resume durable steps exactly once, use private Mico conversations, select a condition branch and retain output across reconciliations");
  checks.push("workflow tools enforce ownership, deterministic creation identity and optimistic graph versions");
  const stoppedExecution = await executeWorkflowTool(prisma, scope, "run_workflow", { id: flowId, expectedVersion: 1, triggerId: "start" }, "synthetic-stop") as { id: string };
  await reconcileWorkflowExecutions(prisma, deps.jobs);
  const stoppedRun = await prisma.run.findFirstOrThrow({ where: { clientNonce: `workflow:${stoppedExecution.id}:agent` } });
  await assert.rejects(stopWorkflowExecution(prisma, { ...scope, userId: "foreign" }, stoppedExecution.id));
  await stopWorkflowExecution(prisma, scope, stoppedExecution.id);
  await stopWorkflowExecution(prisma, scope, stoppedExecution.id);
  assert.equal((await prisma.run.findUniqueOrThrow({ where: { id: stoppedRun.id } })).status, "cancelled");
  assert.equal((await prisma.task.findUniqueOrThrow({ where: { id: stoppedRun.taskId } })).workStopPending, true);
  await reconcileWorkflowExecutions(prisma, deps.jobs);
  assert.equal(await prisma.run.count({ where: { clientNonce: stoppedRun.clientNonce } }), 1);
  checks.push("workflow Stop atomically cancels its exact runs and persists teardown across retries and reconciliation");
  const rls = database.getPgClient(); await rls.connect();
  try {
    await rls.query('CREATE ROLE routine_receipt_probe NOLOGIN');
    await rls.query('GRANT SELECT, INSERT ON routine_delivery_receipts, workflows, workflow_executions TO routine_receipt_probe');
    await rls.query('SET ROLE routine_receipt_probe');
    await rls.query("SELECT set_config('app.space_id', $1, false), set_config('app.user_id', $2, false)", [scope.spaceId, scope.userId]);
    assert.ok(Number((await rls.query('SELECT count(*) AS count FROM routine_delivery_receipts')).rows[0].count) > 0);
    assert.ok(Number((await rls.query('SELECT count(*) AS count FROM workflows')).rows[0].count) > 0);
    assert.ok(Number((await rls.query('SELECT count(*) AS count FROM workflow_executions')).rows[0].count) > 0);
    await rls.query("SELECT set_config('app.user_id', 'foreign', false)");
    assert.equal(Number((await rls.query('SELECT count(*) AS count FROM routine_delivery_receipts')).rows[0].count), 0);
    assert.equal(Number((await rls.query('SELECT count(*) AS count FROM workflows')).rows[0].count), 0);
    assert.equal(Number((await rls.query('SELECT count(*) AS count FROM workflow_executions')).rows[0].count), 0);
    await rls.query("SELECT set_config('app.space_id', 'foreign', false), set_config('app.user_id', $1, false)", [scope.userId]);
    assert.equal(Number((await rls.query('SELECT count(*) AS count FROM routine_delivery_receipts')).rows[0].count), 0);
    await assert.rejects(rls.query('INSERT INTO routine_delivery_receipts (id, "spaceId", "userId", "botId", source, "keyDigest", "routineIds") VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [randomUUID(), scope.spaceId, scope.userId, bot.id, "webhook", "b".repeat(64), []]));
    checks.push("PostgreSQL RLS denies receipt reads and writes from a different owner or Space");
  } finally { await rls.end(); }
  const result = { passed: true, checks, productionAccess: false, modelsCalled: false, receipt: path.join(directory, "result.json") };
  await writeFile(result.receipt, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
} finally {
  if (db) { await db.prisma.$disconnect(); await db.pool.end(); }
  await database.stop();
}
