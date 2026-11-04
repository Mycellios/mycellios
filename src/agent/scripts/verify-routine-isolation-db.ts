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
const { createDb, asSystem, createThreadEvents, ensureRoutineThread, isOwnedRoutineThread, routineDeliveryRouting } = await import("@rakazo/db");
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
  } finally { await sql.end(); }
  db = createDb(url, { encryptContent: false, applicationName: "synthetic-routine-acceptance" });
  const prisma = asSystem(db.prisma, "isolated routine acceptance fixtures");
  const suffix = randomUUID();
  const scope = { spaceId: `space-${suffix}`, userId: `owner-${suffix}` };
  await prisma.user.create({ data: { id: scope.userId, name: "Synthetic owner", email: `${suffix}@example.invalid` } });
  await prisma.organization.create({ data: { id: `org-${suffix}`, name: "Synthetic", slug: suffix, createdAt: new Date() } });
  await prisma.space.create({ data: { id: scope.spaceId, name: "Synthetic", organizationId: `org-${suffix}` } });
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
  const rls = database.getPgClient(); await rls.connect();
  try {
    await rls.query('CREATE ROLE routine_receipt_probe NOLOGIN');
    await rls.query('GRANT SELECT, INSERT ON routine_delivery_receipts TO routine_receipt_probe');
    await rls.query('SET ROLE routine_receipt_probe');
    await rls.query("SELECT set_config('app.space_id', $1, false), set_config('app.user_id', $2, false)", [scope.spaceId, scope.userId]);
    assert.ok(Number((await rls.query('SELECT count(*) AS count FROM routine_delivery_receipts')).rows[0].count) > 0);
    await rls.query("SELECT set_config('app.user_id', 'foreign', false)");
    assert.equal(Number((await rls.query('SELECT count(*) AS count FROM routine_delivery_receipts')).rows[0].count), 0);
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
