import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import EmbeddedPostgres from "embedded-postgres";

process.env.RAKAZO_PROJECT_LOCAL = "1";
process.env.CONTENT_ENCRYPTION = "off";
const { createDb, asSystem, runAsTenant, createThreadEvents } = await import("@rakazo/db");
const { developmentRoutes } = await import("../apps/api/src/routes/development.js");
const { projectExecutionLeaseKey } = await import("../packages/adapters/src/project-execution.js");
const { acquireComputerExecutionLease, releaseComputerExecutionLease, renewComputerExecutionLease } = await import("../packages/adapters/src/computer-lifecycle.js");
const socket = createServer(); await new Promise<void>(resolve => socket.listen(0, "127.0.0.1", resolve));
const port = (socket.address() as { port: number }).port; await new Promise<void>(resolve => socket.close(() => resolve()));
const directory = await mkdtemp(path.join(tmpdir(), "mycellios-project-db-"));
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
    assert.match((await sql.query("SHOW listen_addresses")).rows[0].listen_addresses, /^(localhost|127\.0\.0\.1|::1)$/);
    await sql.query('DROP TABLE "development_projects"');
    await sql.query(await readFile("packages/db/prisma/migrations/20261105130000_development_projects/migration.sql", "utf8"));
  } finally { await sql.end(); }
  checks.push("actual additive project migration applied to a fresh loopback database");
  db = createDb(url, { encryptContent: false, applicationName: "synthetic-project-acceptance" });
  const prisma = db.prisma, system = asSystem(prisma, "synthetic project fixtures");
  const id = randomUUID(), scope = { userId: `owner-${id}`, spaceId: `space-${id}` };
  await system.user.create({ data: { id: scope.userId, name: "Synthetic owner", email: `${id}@example.invalid` } });
  await system.organization.create({ data: { id, name: "Synthetic", slug: id, createdAt: new Date() } });
  await system.space.create({ data: { id: scope.spaceId, name: "Synthetic", organizationId: id } });
  const bot = await system.bot.create({ data: { ...scope, name: "Fixture developer", color: "#10B981", thread: { create: scope } }, include: { thread: true } });
  const handler = { handler: (fn: unknown) => fn };
  const routes = developmentRoutes({ deps: { prisma }, authed: { development: { open: handler, list: handler, status: handler, projects: handler, saveProject: handler, projectTask: handler, primaryRun: handler } } } as never).development as unknown as Record<string, (v: unknown) => Promise<any>>;
  const call = (name: string, input: object, actor = scope) => runAsTenant(actor, () => routes[name]!({ context: { actor }, input }));
  const project = { id: randomUUID(), name: "Synthetic application" };
  await call("saveProject", project); await call("saveProject", project);
  const input = { botId: bot.id, projectKey: `project:${project.id}` };
  const [first, duplicate, second] = await Promise.all([
    call("open", { ...input, title: "Login", taskKey: "project-task:login" }),
    call("open", { ...input, title: "Login", taskKey: "project-task:login" }),
    call("open", { ...input, title: "Payments", taskKey: "project-task:payments" }),
  ]);
  assert.equal(first.threadId, duplicate.threadId); assert.notEqual(first.threadId, second.threadId);
  assert.equal((await call("projects", {}))[0].conversations.length, 2);
  assert.equal(await system.bot.count({ where: scope }), 1);
  checks.push("one project, two independent conversations on the same Mico; retry does not create duplicates");
  const events = createThreadEvents(prisma);
  await Promise.all([first, second].map((thread, index) => runAsTenant(scope, () => events.sendUserMessage({
    ...scope, botId: bot.id, threadId: thread.threadId, blocks: [{ kind: "text", text: `Synthetic ${index}` }],
    prompt: `Synthetic ${index}`, clientNonce: `fixture-${index}`, trigger: "user",
  }))));
  assert.equal(await system.run.count({ where: { ...scope, status: "queued" } }), 2);
  assert.equal(await system.message.count({ where: { threadId: bot.thread!.id } }), 0);
  assert.equal(await system.message.count({ where: { threadId: first.threadId } }), 1);
  assert.equal(await system.message.count({ where: { threadId: second.threadId } }), 1);
  checks.push("both task queues accept work concurrently without copying messages to the Mico main chat");
  const computer = await system.computer.create({ data: { ...scope, scopeKey: `fixture-${id}`, homeKey: `fixture-${id}`,
    kind: "desktop", scope: "team", providerRef: "synthetic-native-host", state: "running" } });
  await system.bot.update({ where: { id: bot.id }, data: { computerId: computer.id } });
  const runs = await system.run.findMany({ where: scope, orderBy: { createdAt: "asc" } });
  const sandbox = { environment: async (_computer: unknown, context: { projectSessionId: string }) => ({
    platform: "win32", shell: "pwsh", home: "synthetic", projectPath: "synthetic-worktree",
    projectSessionId: context.projectSessionId, taskIsolation: "worktree-v1",
  }) };
  const leases = await Promise.all(runs.map(async run => {
    const key = await projectExecutionLeaseKey(system as never, sandbox as never, run, computer);
    assert.ok(key);
    return acquireComputerExecutionLease(system as never, { computerId: computer.id, botId: key, runId: run.id });
  }));
  assert.ok(leases[0]); assert.ok(leases[1]); assert.notEqual(leases[0].botId, leases[1].botId);
  await assert.rejects(acquireComputerExecutionLease(system as never, { ...leases[0], runId: "competing-run" }));
  await releaseComputerExecutionLease(system as never, leases[0]);
  assert.equal(await renewComputerExecutionLease(system as never, leases[1]), true);
  const next = await acquireComputerExecutionLease(system as never, { ...leases[0], runId: "next-run" });
  assert.ok(next && next.fence > leases[0].fence);
  await releaseComputerExecutionLease(system as never, leases[1]); await releaseComputerExecutionLease(system as never, next);
  checks.push("real worker leases admit two same-Mico project conversations; same-conversation overlap is refused and cancellation preserves the other fence");
  await assert.rejects(call("projectTask", { botId: bot.id, taskThreadId: first.threadId }, { ...scope, userId: "foreign" }));
  assert.deepEqual(await call("projects", {}, { ...scope, spaceId: "foreign" }), []);
  checks.push("API refuses another owner or Space");
  const rls = database.getPgClient(); await rls.connect();
  try {
    await rls.query("CREATE ROLE project_probe NOLOGIN"); await rls.query("GRANT USAGE ON SCHEMA public TO project_probe");
    await rls.query("GRANT SELECT, INSERT ON development_projects TO project_probe"); await rls.query("SET ROLE project_probe");
    await rls.query("SELECT set_config('app.space_id',$1,false), set_config('app.user_id',$2,false)", [scope.spaceId, scope.userId]);
    assert.equal(Number((await rls.query("SELECT count(*) AS count FROM development_projects")).rows[0].count), 1);
    await rls.query("SELECT set_config('app.user_id','foreign',false)");
    assert.equal(Number((await rls.query("SELECT count(*) AS count FROM development_projects")).rows[0].count), 0);
    await assert.rejects(rls.query('INSERT INTO development_projects (id,"spaceId","userId",name,"updatedAt") VALUES ($1,$2,$3,$4,NOW())', [randomUUID(), scope.spaceId, scope.userId, "Denied"]));
  } finally { await rls.end(); }
  checks.push("real PostgreSQL RLS refuses foreign project reads and writes");
  const result = { passed: true, checks, productionAccess: false, modelsCalled: false, receipt: path.join(directory, "result.json") };
  await writeFile(result.receipt, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
} finally {
  if (db) { await db.prisma.$disconnect(); await db.pool.end(); }
  await database.stop();
}
