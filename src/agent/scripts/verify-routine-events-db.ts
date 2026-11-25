import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import EmbeddedPostgres from "embedded-postgres";
import { Hono } from "hono";
import pg from "pg";

// Signed webhook routines (specs/mico-automation/spec.md, phase 2) against a fresh disposable
// loopback PostgreSQL cluster. Synthetic rows and a throwaway encryption key only: no production
// data, accounts, credentials or models; never point it at another database.
process.env.NODE_ENV = "test";
process.env.CONTENT_ENCRYPTION = "off";
const run = promisify(execFile);
const { createDb, asSystem, createThreadEvents, pruneRoutineEvents, listRoutineIgnoredEvents } =
  await import("@mycellios/db");
const { routineRunSource } = await import("@mycellios/core");
const { EncryptedSecretStore } = await import("../packages/adapters/src/secrets.js");
const {
  acceptRoutineEvent,
  mountRoutineEventRoutes,
  revokeRoutineWebhookSecrets,
  rotateRoutineWebhookSecret,
  sendRoutineTestEvent,
  signRoutineEvent,
} = await import("../apps/api/src/routine-events.js");
const { deliverWebhookEvent } = await import("../apps/api/src/webhook-inbound.js");
const { routinesRoutes } = await import("../apps/api/src/routes/routines.js");

const freePort = async () => {
  const socket = createServer();
  await new Promise<void>((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const port = (socket.address() as { port: number }).port;
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  return port;
};
const port = await freePort();
const directory = await mkdtemp(path.join(tmpdir(), "mycellios-routine-events-"));
const password = randomBytes(24).toString("hex");
const postgres = new EmbeddedPostgres({
  databaseDir: path.join(directory, "pg"),
  port,
  user: "postgres",
  password,
  persistent: true,
  createPostgresUser: false,
  autoRehydrateSymlinks: true,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
  onLog: () => {},
  onError: () => {},
});
const prismaCli = path.resolve("node_modules/prisma/build/index.js");
const migration = "packages/db/prisma/migrations/20261125120000_routine_signed_webhooks/migration.sql";
let db: ReturnType<typeof createDb> | undefined;
const checks: string[] = [];
const HOUR = 60 * 60 * 1000;

try {
  await postgres.initialise();
  await postgres.start();
  const url = `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`;
  await run(process.execPath, [prismaCli, "db", "push", "--config", "packages/db/prisma.config.ts"], {
    windowsHide: true,
    env: { ...process.env, DATABASE_URL: url, DATABASE_MIGRATION_URL: url },
    maxBuffer: 4 * 1024 * 1024,
  });
  const sql = new pg.Client({ connectionString: url });
  await sql.connect();
  try {
    const address = await sql.query("SHOW listen_addresses");
    assert.match(address.rows[0].listen_addresses, /^(localhost|127\.0\.0\.1|::1)$/);
    // The schema the previous release runs on, then this release's migration.
    await sql.query('DROP TABLE "routine_event_receipts"; DROP TABLE "routine_webhook_secrets"');
    await sql.query('ALTER TABLE "routines" DROP COLUMN "webhookEventType", DROP COLUMN "webhookFilters"');
    await sql.query(await readFile(migration, "utf8"));
    const columns = await sql.query(`SELECT column_name, is_nullable, column_default FROM information_schema.columns
      WHERE table_name = 'routines' AND column_name IN ('webhookEventType', 'webhookFilters') ORDER BY 1`);
    assert.deepEqual(
      columns.rows.map((row: { column_name: string; is_nullable: string; column_default: string | null }) => [
        row.column_name,
        row.is_nullable,
        row.column_default,
      ]),
      [
        ["webhookEventType", "YES", null],
        ["webhookFilters", "YES", null],
      ],
    );
    const policies = await sql.query(`SELECT tablename, policyname FROM pg_policies
      WHERE tablename IN ('routine_webhook_secrets', 'routine_event_receipts') ORDER BY 1, 2`);
    assert.deepEqual(
      policies.rows.map((row: { policyname: string }) => row.policyname),
      [
        "routine_event_receipts_system",
        "routine_event_receipts_tenant",
        "routine_webhook_secrets_system",
        "routine_webhook_secrets_tenant",
      ],
    );
    const secured = await sql.query(`SELECT relname FROM pg_class WHERE relrowsecurity
      AND relname IN ('routine_webhook_secrets', 'routine_event_receipts') ORDER BY 1`);
    assert.equal(secured.rows.length, 2);
    await assert.rejects(
      sql.query(`INSERT INTO routine_event_receipts (id, "spaceId", "userId", "routineId", "keyDigest", result)
        VALUES ('x', 's', 'u', 'missing', 'k', 'queued')`),
    );
    checks.push("the additive migration applies with nullable columns, RLS policies and owned foreign keys");
  } finally {
    await sql.end();
  }

  db = createDb(url, { encryptContent: false, applicationName: "synthetic-routine-events" });
  const prisma = asSystem(db.prisma, "isolated signed routine event fixtures");
  const suffix = randomBytes(6).toString("hex");
  const scope = { spaceId: `space-${suffix}`, userId: `owner-${suffix}` };
  await prisma.user.create({ data: { id: scope.userId, name: "Synthetic owner", email: `${suffix}@example.invalid` } });
  await prisma.organization.create({ data: { id: `org-${suffix}`, name: "Synthetic", slug: suffix, createdAt: new Date() } });
  await prisma.space.create({ data: { id: scope.spaceId, name: "Synthetic", organizationId: `org-${suffix}` } });
  await prisma.member.create({ data: { id: `member-${suffix}`, organizationId: `org-${suffix}`, userId: scope.userId, role: "owner", createdAt: new Date() } });
  await prisma.spaceMember.create({ data: { id: `membership-${suffix}`, ...scope, organizationId: `org-${suffix}`, role: "owner", createdAt: new Date() } });
  const bot = await prisma.bot.create({
    data: { ...scope, name: "Synthetic Mico", color: "#10B981", thread: { create: { ...scope } } },
    include: { thread: true },
  });
  // The previous release creates routines without the new columns; they read as no type and no filters.
  const routineId = `routine-${suffix}`;
  const legacy = new pg.Client({ connectionString: url });
  await legacy.connect();
  await legacy.query(
    `INSERT INTO routines (id, "spaceId", "botId", "userId", name, prompt, crons, active, "webhookEnabled", "updatedAt")
     VALUES ($1, $2, $3, $4, 'Synthetic invoices', 'Summarize the synthetic invoice', '{}', true, true, now())`,
    [routineId, scope.spaceId, bot.id, scope.userId],
  );
  await legacy.end();
  const routine = await prisma.routine.findUniqueOrThrow({ where: { id: routineId } });
  assert.equal(routine.webhookEventType, null);
  assert.equal(routine.webhookFilters, null);

  const secrets = new EncryptedSecretStore(randomBytes(32).toString("hex"));
  const events = createThreadEvents(prisma);
  const jobs: unknown[] = [];
  const deps = { prisma, secrets, events, jobs: { enqueue: async (job: unknown) => { jobs.push(job); } } };
  const context = () => ({
    operationId: "synthetic",
    traceId: "synthetic",
    ...scope,
    signal: new AbortController().signal,
  });
  const cache = new Map();
  const send = (
    secret: string,
    payload: unknown,
    options: { id?: string; now?: Date; body?: Buffer; routine?: string; signedAt?: Date } = {},
  ) => {
    const now = options.now ?? new Date();
    const id = options.id ?? `msg_${randomBytes(8).toString("hex")}`;
    const timestamp = String(Math.floor((options.signedAt ?? now).getTime() / 1000));
    const signedBody = Buffer.from(JSON.stringify(payload));
    const headers: Record<string, string> = {
      "webhook-id": id,
      "webhook-timestamp": timestamp,
      "webhook-signature": signRoutineEvent(secret, id, timestamp, signedBody),
    };
    return acceptRoutineEvent(
      deps,
      cache,
      { routineId: options.routine ?? routineId, header: (name) => headers[name], body: options.body ?? signedBody },
      { now },
    );
  };
  const invoice = { type: "invoice.paid", timestamp: new Date().toISOString(), data: { status: "paid", amount: 42 } };

  // 1. Signatures: no secret yet, then the valid one, a wrong one, a stale or changed event.
  assert.equal((await send(`whsec_${randomBytes(32).toString("base64")}`, invoice)).status, 401);
  const first = await rotateRoutineWebhookSecret(deps, routine, context());
  assert.match(first, /^whsec_/);
  const stored = await prisma.routineWebhookSecret.findFirstOrThrow({ where: { routineId } });
  assert.ok(!stored.ciphertext.includes(first.slice("whsec_".length)));
  assert.equal(stored.expiresAt, null);
  const accepted = await send(first, invoice, { id: "msg_first" });
  assert.equal(accepted.status, 202);
  assert.ok("runId" in accepted.body && accepted.body.runId);
  const runId = accepted.body.runId;
  const started = await prisma.run.findUniqueOrThrow({ where: { id: runId }, include: { thread: true, sourceMessage: true } });
  assert.equal(started.trigger, "webhook");
  assert.equal(started.routineId, routineId);
  assert.match(started.clientNonce ?? "", /^routine-event:/);
  assert.equal(routineRunSource(started), "webhook");
  assert.equal(started.thread.taskKey, `routine:${routineId}`);
  assert.notEqual(started.threadId, bot.thread!.id);
  const prompt = JSON.stringify(started.sourceMessage?.blocks);
  assert.ok(prompt.includes("untrusted_delivery_payload") && prompt.includes("Run routine"));
  assert.equal(jobs.length, 1);
  const wrong = await send(`whsec_${randomBytes(32).toString("base64")}`, invoice);
  const stale = await send(first, invoice, { signedAt: new Date(Date.now() - 6 * 60 * 1000) });
  const future = await send(first, invoice, { signedAt: new Date(Date.now() + 6 * 60 * 1000) });
  const changed = await send(first, invoice, { body: Buffer.from(JSON.stringify({ ...invoice, data: { status: "void" } })) });
  for (const refused of [wrong, stale, future, changed]) assert.deepEqual(refused, { status: 401, body: { error: "Unauthorized" } });
  assert.equal(await prisma.run.count({ where: { routineId } }), 1);
  checks.push("a valid signature starts one run in the routine's own conversation with the payload fenced; a wrong secret, stale or future timestamp and changed body get the same 401");

  // 2. Receipts: a repeat starts nothing; the receipt keeps the id digest, result and run only.
  const repeat = await send(first, invoice, { id: "msg_first" });
  assert.deepEqual(repeat, { status: 200, body: { ok: true, duplicate: true, status: "queued", runId } });
  assert.equal(await prisma.run.count({ where: { routineId } }), 1);
  const receipt = await prisma.routineEventReceipt.findFirstOrThrow({ where: { routineId } });
  assert.equal(receipt.keyDigest, createHash("sha256").update("msg_first").digest("hex"));
  assert.deepEqual([receipt.result, receipt.reason, receipt.runId, receipt.test], ["queued", null, runId, false]);
  assert.ok(!JSON.stringify(receipt).includes("invoice"));
  checks.push("a repeated delivery id answers 200 with the first run and starts nothing; receipts keep no body");

  // 3. Rotation keeps the previous secret for 24 hours; Revoke ends both.
  const rotatedAt = new Date();
  const second = await rotateRoutineWebhookSecret(deps, routine, context(), rotatedAt);
  const rows = await prisma.routineWebhookSecret.findMany({ where: { routineId }, orderBy: { createdAt: "asc" } });
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.expiresAt?.getTime(), rotatedAt.getTime() + 24 * HOUR);
  assert.equal((await send(first, invoice)).status, 202);
  assert.equal((await send(second, invoice)).status, 202);
  const third = await rotateRoutineWebhookSecret(deps, routine, context());
  assert.equal((await send(first, invoice)).status, 401);
  assert.equal((await send(second, invoice)).status, 202);
  assert.equal((await send(third, invoice)).status, 202);
  assert.equal((await send(second, invoice, { now: new Date(Date.now() + 25 * HOUR) })).status, 401);
  await revokeRoutineWebhookSecrets(prisma, routine);
  assert.equal((await send(second, invoice)).status, 401);
  assert.equal((await send(third, invoice)).status, 401);
  assert.equal(await prisma.routineWebhookSecret.count({ where: { routineId } }), 0);
  checks.push("both secrets work during a rotation, the previous one ends after 24 hours or at the next rotation, and Revoke ends both at once");

  // 4. Event type and filters decide before any run; a paused routine records its events.
  const key = await rotateRoutineWebhookSecret(deps, routine, context());
  await prisma.routine.update({
    where: { id: routineId },
    data: { webhookEventType: "invoice.paid", webhookFilters: [{ pointer: "/status", value: "paid" }, { pointer: "/amount", value: 42 }] },
  });
  const runsBefore = await prisma.run.count({ where: { routineId } });
  assert.deepEqual((await send(key, { ...invoice, type: "invoice.failed" })).body, { ok: true, status: "ignored", reason: "event_type" });
  assert.deepEqual((await send(key, { ...invoice, data: { status: "paid", amount: "42" } })).body, { ok: true, status: "ignored", reason: "filter" });
  assert.deepEqual((await send(key, { ...invoice, data: undefined })).body, { ok: true, status: "ignored", reason: "filter" });
  assert.equal((await send(key, invoice)).body.status, "queued");
  await prisma.routine.update({ where: { id: routineId }, data: { active: false } });
  const paused = await send(key, invoice);
  assert.deepEqual([paused.status, paused.body], [202, { ok: true, status: "ignored", reason: "paused" }]);
  assert.equal(await prisma.run.count({ where: { routineId } }), runsBefore + 1);
  const ignored = await listRoutineIgnoredEvents(prisma, { ...scope, routineId });
  assert.deepEqual(ignored.map((event) => event.reason), ["paused", "filter", "filter", "event_type"]);
  checks.push("an event of another type, one a filter refuses and one for a paused routine answer 202, start nothing and show in the history with their reason");

  // 5. Send test event: signed with the current secret, runs even while paused, skips the filters.
  const testRun = await sendRoutineTestEvent(deps, { ...routine, webhookEventType: "invoice.paid", secret: await prisma.routineWebhookSecret.findFirstOrThrow({ where: { routineId, expiresAt: null } }) }, "click-1");
  const tested = await prisma.run.findUniqueOrThrow({ where: { id: testRun } });
  assert.equal(tested.trigger, "webhook");
  assert.match(tested.clientNonce ?? "", /^routine-test:event:/);
  assert.equal(routineRunSource(tested), "manual");
  assert.equal(await sendRoutineTestEvent(deps, { ...routine, webhookEventType: "invoice.paid", secret: await prisma.routineWebhookSecret.findFirstOrThrow({ where: { routineId, expiresAt: null } }) }, "click-1"), testRun);
  assert.equal((await prisma.routineEventReceipt.findFirstOrThrow({ where: { routineId, runId: testRun } })).test, true);
  await assert.rejects(
    sendRoutineTestEvent(deps, { ...routine, webhookEventType: null, secret: null }, "click-2"),
    /Create a secret/,
  );
  checks.push("Send test event signs a sample with the routine's secret and starts one routine-test run, also while paused; a retry returns the same run");

  // 6. At most 60 events an hour per routine, counted over every accepted event; repeats still answer.
  await prisma.routine.update({ where: { id: routineId }, data: { active: true } });
  const limited = await prisma.routine.create({
    data: { ...scope, botId: bot.id, name: "Synthetic limit", prompt: "Count", crons: [], active: true, webhookEnabled: true, webhookEventType: "never.sent" },
  });
  const limitKey = await rotateRoutineWebhookSecret(deps, limited, context());
  const start = new Date();
  for (let index = 0; index < 60; index += 1) {
    const answer = await send(limitKey, invoice, { routine: limited.id, id: `msg_limit_${index}`, now: new Date(start.getTime() + index * 1_000) });
    assert.equal(answer.status, 202);
  }
  const later = new Date(start.getTime() + 61_000);
  const refused = await send(limitKey, invoice, { routine: limited.id, id: "msg_limit_60", now: later });
  assert.equal(refused.status, 429);
  assert.ok("retryAfterSeconds" in refused && refused.retryAfterSeconds > 0 && refused.retryAfterSeconds <= 3_600);
  assert.equal((await send(limitKey, invoice, { routine: limited.id, id: "msg_limit_3", now: later })).status, 200);
  assert.equal((await send(limitKey, invoice, { routine: limited.id, id: "msg_limit_60", now: new Date(start.getTime() + HOUR + 1_000) })).status, 202);
  const app = new Hono();
  mountRoutineEventRoutes(app, deps);
  const body = Buffer.from(JSON.stringify(invoice));
  const httpId = "msg_limit_http";
  const timestamp = String(Math.floor(Date.now() / 1000));
  // The window is still full at the real clock, so the HTTP route answers 429 with Retry-After.
  const http = await app.request(`/api/v1/routines/${limited.id}/events`, {
    method: "POST",
    headers: { "content-type": "application/json", "webhook-id": httpId, "webhook-timestamp": timestamp, "webhook-signature": signRoutineEvent(limitKey, httpId, timestamp, body) },
    body,
  });
  assert.equal(http.status, 429);
  assert.ok(Number(http.headers.get("retry-after")) > 0);
  checks.push("a routine takes 60 events an hour, then 429 with Retry-After; repeats still answer 200 and the window slides");

  // 7. Receipts expire after 7 days: an old id is new again, and the pruner drops old rows.
  const aged = new Date(Date.now() - 8 * 24 * HOUR);
  await prisma.routineEventReceipt.updateMany({ where: { routineId, keyDigest: createHash("sha256").update("msg_first").digest("hex") }, data: { createdAt: aged } });
  const runsBeforeExpiry = await prisma.run.count({ where: { routineId } });
  const afterExpiry = await send(key, invoice, { id: "msg_first" });
  // No longer a known repeat, yet the run keeps its delivery identity: still no second run.
  assert.deepEqual(afterExpiry, { status: 202, body: { ok: true, status: "queued", runId } });
  assert.equal(await prisma.run.count({ where: { routineId } }), runsBeforeExpiry);
  const oldReceipt = await prisma.routineEventReceipt.create({
    data: { ...scope, routineId, keyDigest: "c".repeat(64), result: "ignored", reason: "filter", createdAt: aged },
  });
  const removed = await pruneRoutineEvents(prisma);
  assert.ok(removed.receipts >= 1);
  assert.equal(await prisma.routineEventReceipt.count({ where: { id: oldReceipt.id } }), 0);
  assert.ok((await prisma.routineEventReceipt.count({ where: { routineId } })) > 0);
  checks.push("receipts expire after 7 days and the pruner drops only those; an expired id still never starts a second run");

  // 8. The per-Mico Bearer route keeps serving routines without their own secret, only those.
  const older = await prisma.routine.create({
    data: { ...scope, botId: bot.id, name: "Synthetic legacy", prompt: "Legacy", crons: [], active: true, webhookEnabled: true },
  });
  const target = { bot: { id: bot.id, ...scope }, threadId: bot.thread!.id };
  await deliverWebhookEvent(deps, target, {
    source: "webhook",
    idempotencyKey: "legacy-delivery",
    prompt: "Untrusted synthetic event",
    routines: [routine, older].map((row) => ({ ...row, id: row.id })),
  });
  assert.equal(await prisma.run.count({ where: { routineId: older.id } }), 1);
  assert.equal(await prisma.run.count({ where: { routineId, clientNonce: { startsWith: "webhook:" } } }), 0);
  checks.push("the per-Mico Bearer route still reaches routines without their own secret and never one with it");

  // 9. Person-facing calls stay inside the owner's Space; another owner sees nothing.
  const authed = { routines: new Proxy({}, { get: () => ({ handler: (fn: unknown) => fn }) }) };
  const routes = routinesRoutes({ deps, authed } as never).routines as unknown as Record<
    string,
    (input: { context: { actor: typeof scope; signal?: AbortSignal }; input: Record<string, unknown> }) => Promise<Record<string, unknown>>
  >;
  const foreign = { ...scope, userId: "foreign" };
  for (const name of ["rotateWebhookSecret", "revokeWebhookSecret", "sendTestEvent"]) {
    await assert.rejects(routes[name]!({ context: { actor: foreign }, input: { routineId } }), /NOT_FOUND|Not Found/i);
  }
  const rotated = await routes.rotateWebhookSecret!({ context: { actor: scope }, input: { routineId } });
  assert.match(String(rotated.secret), /^whsec_/);
  assert.equal(rotated.path, `/api/v1/routines/${routineId}/events`);
  assert.ok((rotated.webhook as { previousSecretExpiresAt: string | null }).previousSecretExpiresAt);
  const history = await routes.history!({ context: { actor: scope }, input: { routineId } });
  assert.ok(Array.isArray(history.events) && history.events.length >= 4);
  const revoked = await routes.revokeWebhookSecret!({ context: { actor: scope }, input: { routineId } });
  assert.deepEqual(revoked.webhook, { secretCreatedAt: null, previousSecretExpiresAt: null, eventType: "invoice.paid", filters: [{ pointer: "/status", value: "paid" }, { pointer: "/amount", value: 42 }] });
  checks.push("rotate, revoke, test event and history act only on the owner's routine");

  // 10. Row-level security: the receipts and secrets of one owner stay invisible to another.
  await rotateRoutineWebhookSecret(deps, routine, context());
  const rls = new pg.Client({ connectionString: url });
  await rls.connect();
  try {
    await rls.query("CREATE ROLE routine_event_probe NOLOGIN");
    await rls.query("GRANT SELECT, INSERT ON routine_event_receipts, routine_webhook_secrets TO routine_event_probe");
    await rls.query("SET ROLE routine_event_probe");
    const count = async (table: string) => Number((await rls.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n);
    await rls.query("SELECT set_config('app.space_id', $1, false), set_config('app.user_id', $2, false)", [scope.spaceId, scope.userId]);
    assert.ok((await count("routine_event_receipts")) > 0);
    assert.ok((await count("routine_webhook_secrets")) > 0);
    await rls.query("SELECT set_config('app.user_id', 'foreign', false)");
    assert.equal(await count("routine_event_receipts"), 0);
    assert.equal(await count("routine_webhook_secrets"), 0);
    await rls.query("SELECT set_config('app.space_id', 'foreign', false), set_config('app.user_id', $1, false)", [scope.userId]);
    assert.equal(await count("routine_event_receipts"), 0);
    await assert.rejects(
      rls.query(`INSERT INTO routine_event_receipts (id, "spaceId", "userId", "routineId", "keyDigest", result) VALUES ($1, $2, $3, $4, $5, 'queued')`,
        [`probe-${suffix}`, scope.spaceId, scope.userId, routineId, "d".repeat(64)]),
    );
    checks.push("PostgreSQL RLS hides receipts and secrets from another owner or Space and refuses their writes");
  } finally {
    await rls.end();
  }

  // 11. Deleting a routine deletes its secrets and receipts.
  await prisma.routine.delete({ where: { id: routineId } });
  assert.equal(await prisma.routineWebhookSecret.count({ where: { routineId } }), 0);
  assert.equal(await prisma.routineEventReceipt.count({ where: { routineId } }), 0);
  checks.push("deleting a routine deletes its secrets and receipts");

  const result = { passed: true, checks, productionAccess: false, modelsCalled: false };
  await writeFile(path.join(directory, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, receipt: path.join(directory, "result.json") }, null, 2));
} finally {
  await db?.prisma.$disconnect().catch(() => undefined);
  await db?.pool.end().catch(() => undefined);
  await postgres.stop().catch(() => undefined);
}
