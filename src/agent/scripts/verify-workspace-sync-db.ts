import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import EmbeddedPostgres from "embedded-postgres";

process.env.RAKAZO_PROJECT_LOCAL = "1";
process.env.CONTENT_ENCRYPTION = "off";
const { createDb, asSystem, runAsTenant, createThreadEvents, createRepos, claimMicoRun } = await import("@rakazo/db");
const { taskInboxRoutes } = await import("../apps/api/src/routes/task-inbox.js");
const { developmentRoutes } = await import("../apps/api/src/routes/development.js");
const { resolveThreadTarget } = await import("../apps/api/src/thread-target.js");
const { routineCalendar } = await import("../apps/api/src/routine-calendar.js");
const { usageDashboard } = await import("../apps/api/src/usage-dashboard.js");
const socket = createServer();
await new Promise<void>(resolve => socket.listen(0, "127.0.0.1", resolve));
const port = (socket.address() as { port: number }).port;
await new Promise<void>(resolve => socket.close(() => resolve()));
const directory = await mkdtemp(path.join(tmpdir(), "mycellios-workspace-sync-"));
const password = randomBytes(24).toString("hex");
const isolatedRoot = process.getuid?.() === 0 && process.env.NC_LOCAL_OFFLOAD === "1";
if (isolatedRoot) await chmod(directory, 0o755);
const database = new EmbeddedPostgres({ databaseDir: path.join(directory, "pg"), port, user: "postgres", password,
  persistent: true, createPostgresUser: isolatedRoot, initdbFlags: ["--encoding=UTF8", "--locale=C"], autoRehydrateSymlinks: true, onLog: () => {}, onError: () => {} });
let db: ReturnType<typeof createDb> | undefined;
const checks: string[] = [];
try {
  await database.initialise();
  await database.start();
  const url = `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`;
  await promisify(execFile)(process.execPath, [path.resolve("node_modules/prisma/build/index.js"), "db", "push", "--config", "packages/db/prisma.config.ts"],
    { windowsHide: true, env: { ...process.env, DATABASE_URL: url, DATABASE_MIGRATION_URL: url }, maxBuffer: 1024 * 1024 });
  const sql = database.getPgClient(); await sql.connect();
  try {
    assert.match((await sql.query("SHOW listen_addresses")).rows[0].listen_addresses, /^(localhost|127\.0\.0\.1|::1)$/);
    await sql.query('DROP TABLE "task_inbox"');
    await sql.query(await readFile("packages/db/prisma/migrations/20261106110000_task_inbox/migration.sql", "utf8"));
    // Prisma db push omits these published ownership constraints. Exercise the real constraints too.
    const ownership = await readFile("packages/db/prisma/migrations/20261103170000_mico_project_conversations/migration.sql", "utf8");
    await sql.query(ownership.split("ALTER TABLE \"threads\" ADD CONSTRAINT \"threads_owner_chk\"")[1]!.split(";")[0]!.replace(/^/, 'ALTER TABLE "threads" ADD CONSTRAINT "threads_owner_chk"') + ";");
    await sql.query(ownership.split('ALTER TABLE "threads" ADD CONSTRAINT "threads_task_project_chk"')[1]!.replace(/^/, 'ALTER TABLE "threads" ADD CONSTRAINT "threads_task_project_chk"'));
  } finally { await sql.end(); }
  checks.push("additive inbox migration with the published thread owner constraints");
  db = createDb(url, { encryptContent: false, applicationName: "synthetic-workspace-sync" });
  const prisma = db.prisma, system = asSystem(prisma, "synthetic workspace fixtures");
  const id = randomUUID(), actor = { userId: `owner-${id}`, spaceId: `space-${id}` };
  await system.user.create({ data: { id: actor.userId, name: "Synthetic owner", email: `${id}@example.invalid` } });
  await system.organization.create({ data: { id, name: "Synthetic", slug: id, createdAt: new Date() } });
  await system.space.create({ data: { id: actor.spaceId, name: "Synthetic", organizationId: id } });
  const bot = await system.bot.create({ data: { ...actor, name: "Fixture Mico", color: "#10B981", agentEngine: "codex", thread: { create: actor } }, include: { thread: true } });
  const handler = { handler: (fn: unknown) => fn };
  const taskInbox = Object.fromEntries(["available", "list", "start", "messages", "read", "send", "markRead", "archive", "stop", "answer"].map(name => [name, handler]));
  const jobs = { enqueue: async () => undefined };
  const deps = { prisma, events: createThreadEvents(prisma), jobs, sandbox: {} };
  const routes = taskInboxRoutes({ deps, repos: createRepos(prisma), authed: { taskInbox } } as never).taskInbox as unknown as Record<string, (v: unknown) => Promise<any>>;
  const call = (name: string, input: object = {}, scope = actor) => runAsTenant(scope, () => routes[name]!({ context: { actor: scope }, input }));
  await call("available");
  const firstInput = { botId: bot.id, text: "Synthetic first task", clientNonce: randomUUID() };
  const [first, duplicate, second] = await Promise.all([call("start", firstInput), call("start", firstInput), call("start", { ...firstInput, text: "Synthetic second task", clientNonce: randomUUID() })]);
  assert.equal(first.id, duplicate.id);
  assert.notEqual(first.threadId, second.threadId);
  assert.equal(await system.inboxTask.count(), 2);
  assert.equal(await system.run.count(), 2);
  assert.equal(await system.message.count({ where: { threadId: bot.thread!.id } }), 0);
  const target = await runAsTenant(actor, () => resolveThreadTarget(prisma, actor, { botId: bot.id, taskThreadId: first.threadId }));
  assert.equal(target.threadId, first.threadId);
  assert.equal("projectSessionId" in target, false);
  checks.push("real starts retain nonce identity and create independent normal Mico task conversations");
  const development = Object.fromEntries(["open", "list", "status", "projects", "saveProject", "projectTask", "primaryRun"].map(name => [name, handler]));
  const dev = developmentRoutes({ deps, authed: { development } } as never).development as unknown as Record<string, (v: unknown) => Promise<any>>;
  const tabs = await runAsTenant(actor, () => dev.list!({ context: { actor }, input: { botId: bot.id } }));
  assert.equal(tabs.length, 2);
  assert.ok(tabs.some((tab: { threadId: string }) => tab.threadId === first.threadId));
  assert.equal((await call("read", { id: first.id })).thread.threadId, first.threadId);
  assert.equal((await call("list")).length, 2);
  const runs = await system.run.findMany({ where: { botId: bot.id } });
  const claim = (run: (typeof runs)[number]) => runAsTenant(actor, () => claimMicoRun(prisma, run,
    { id: run.id, status: "queued" }, { status: "leased", leaseOwner: "synthetic-worker", leaseFence: 1, leaseExpiresAt: new Date(Date.now() + 60_000) }));
  const admitted = await Promise.all(runs.map(claim));
  assert.deepEqual(admitted.map(result => result.count).sort(), [0, 1]);
  const waiting = runs[admitted.findIndex(result => result.count === 0)]!;
  assert.equal((await claim({ ...waiting, userId: "foreign" })).count, 0);
  await system.bot.update({ where: { id: bot.id }, data: { agentEngine: "pi", taskConcurrency: 2 } });
  assert.equal((await claim(waiting)).count, 1);
  checks.push("real concurrent PostgreSQL admission retains the native single slot, owner fence and explicit Pi concurrency");
  await assert.rejects(call("archive", { id: first.id, archived: true }));
  await system.run.updateMany({ where: { threadId: first.threadId }, data: { status: "completed", completedAt: new Date() } });
  await call("archive", { id: first.id, archived: true });
  await assert.rejects(call("send", { id: first.id, text: "Refuse archived", clientNonce: randomUUID() }));
  await call("archive", { id: first.id, archived: false });
  checks.push("existing task tabs see inbox conversations; archive refuses active or archived sends");
  await assert.rejects(call("read", { id: first.id }, { ...actor, userId: "foreign" }));
  await assert.rejects(call("read", { id: first.id }, { ...actor, spaceId: "foreign" }));
  const range = { from: new Date(Date.now() - 86400000).toISOString(), to: new Date(Date.now() + 86400000).toISOString(), timeZone: "Europe/Madrid" };
  const usage = await runAsTenant(actor, () => usageDashboard(prisma, actor, range));
  assert.equal(usage.totals.costUsd, null);
  assert.equal((await runAsTenant(actor, () => routineCalendar(prisma, actor, range))).routines.length, 0);
  await assert.rejects(runAsTenant({ ...actor, userId: "foreign" }, () => usageDashboard(prisma, { ...actor, userId: "foreign" }, { ...range, botId: bot.id })));
  checks.push("bounded calendar/usage reads and API owner/Space isolation; missing usage is not zero cost");
  const rls = database.getPgClient(); await rls.connect();
  try {
    await rls.query("CREATE ROLE inbox_probe NOLOGIN");
    await rls.query("GRANT USAGE ON SCHEMA public TO inbox_probe");
    await rls.query("GRANT SELECT, INSERT ON task_inbox TO inbox_probe");
    await rls.query("SET ROLE inbox_probe");
    await rls.query("SELECT set_config('app.space_id',$1,false), set_config('app.user_id',$2,false)", [actor.spaceId, actor.userId]);
    assert.equal(Number((await rls.query("SELECT count(*) AS count FROM task_inbox")).rows[0].count), 2);
    await rls.query("SELECT set_config('app.user_id','foreign',false)");
    assert.equal(Number((await rls.query("SELECT count(*) AS count FROM task_inbox")).rows[0].count), 0);
  } finally { await rls.end(); }
  checks.push("real PostgreSQL RLS conceals another member's inbox");
  const result = { passed: true, checks, productionAccess: false, modelsCalled: false };
  await writeFile(path.join(directory, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  if (db) { await db.prisma.$disconnect(); await db.pool.end(); }
  await database.stop();
}
