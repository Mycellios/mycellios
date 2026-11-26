import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import EmbeddedPostgres from "embedded-postgres";

process.env.RAKAZO_PROJECT_LOCAL = "1";
process.env.CONTENT_ENCRYPTION = "off";
const { createDb, asSystem, runAsTenant, createThreadEvents, createRepos, claimMicoRun, Prisma } = await import("@mycellios/db");
const { taskInboxRoutes } = await import("../apps/api/src/routes/task-inbox.js");
const { commitBotUpdate } = await import("../packages/db/src/bot-update.js");
const { developmentRoutes } = await import("../apps/api/src/routes/development.js");
const { botsRoutes } = await import("../apps/api/src/routes/bots.js");
const { CreateBotInput } = await import("@mycellios/contracts");
const { resolveThreadTarget } = await import("../apps/api/src/thread-target.js");
const { routineCalendar } = await import("../apps/api/src/routine-calendar.js");
const { sporeRewards, usageDashboard } = await import("../apps/api/src/usage-dashboard.js");
const { selectOfflineCloudWorkspace } = await import("../packages/adapters/src/offline-cloud-workspace.js");
const { acquireDedicatedScreenLeaseFence, provisionComputer, releaseComputerExecutionLease } =
  await import("../packages/adapters/src/computer-lifecycle.js");
const { FakeSandboxProvider } = await import("../packages/adapters/src/fake-sandbox.js");
const { HostAwareSandbox } = await import("../packages/adapters/src/host-aware-sandbox.js");
const { LocalAgentHomeStore } = await import("../packages/adapters/src/home.js");
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
    await sql.query(await readFile("packages/db/prisma/migrations/20261115100000_task_followup/migration.sql", "utf8"));
    // Prisma db push omits these published ownership constraints. Exercise the real constraints too.
    const ownership = await readFile("packages/db/prisma/migrations/20261103170000_mico_project_conversations/migration.sql", "utf8");
    await sql.query(ownership.split("ALTER TABLE \"threads\" ADD CONSTRAINT \"threads_owner_chk\"")[1]!.split(";")[0]!.replace(/^/, 'ALTER TABLE "threads" ADD CONSTRAINT "threads_owner_chk"') + ";");
    await sql.query(ownership.split('ALTER TABLE "threads" ADD CONSTRAINT "threads_task_project_chk"')[1]!.replace(/^/, 'ALTER TABLE "threads" ADD CONSTRAINT "threads_task_project_chk"'));
    await sql.query('ALTER TABLE "runs" DROP COLUMN "cloudComputerId"');
    for (const migration of [
      "20261107160000_offline_mico_workspace",
      "20261107160100_offline_mico_workspace_index",
      "20261107160200_offline_mico_workspace_validate",
    ]) {
      await sql.query(await readFile(`packages/db/prisma/migrations/${migration}/migration.sql`, "utf8"));
    }
    await sql.query('DROP INDEX "usage_records_userId_idx"');
    await sql.query(await readFile("packages/db/prisma/migrations/20261108170000_usage_records_account_rewards_index/migration.sql", "utf8"));
  } finally { await sql.end(); }
  checks.push("additive inbox migration with the published thread owner constraints");
  db = createDb(url, { encryptContent: false, applicationName: "synthetic-workspace-sync" });
  const prisma = db.prisma, system = asSystem(prisma, "synthetic workspace fixtures");
  const id = randomUUID(), actor = { userId: `owner-${id}`, spaceId: `space-${id}` };
  await system.user.create({ data: { id: actor.userId, name: "Synthetic owner", email: `${id}@example.invalid` } });
  await system.organization.create({ data: { id, name: "Synthetic", slug: id, createdAt: new Date() } });
  await system.space.create({ data: { id: actor.spaceId, name: "Synthetic", organizationId: id } });
  // db push omits the CHECK from 0008_team_computers; reproduce it so the new
  // mode is qualified against a genuine upgrade, not just Prisma's loose String.
  const scopeSql = database.getPgClient(); await scopeSql.connect();
  try {
    await scopeSql.query(`ALTER TABLE computers ADD CONSTRAINT computers_scope_check CHECK (scope IN ('team', 'dedicated'))`);
    const legacy = await system.computer.create({ data: {
      ...actor, scope: "team", scopeKey: `legacy-scope:${id}`, homeKey: `legacy-home:${id}`, kind: "none",
    } });
    const probe = { ...actor, scope: "isolated", scopeKey: `scope-probe:${id}`, homeKey: `scope-probe:${id}`, kind: "none" };
    await assert.rejects(system.computer.create({ data: probe }), /computers_scope_check/);
    await scopeSql.query(await readFile("packages/db/prisma/migrations/20261116070000_isolated_computers/migration.sql", "utf8"));
    assert.deepEqual(await system.computer.findUniqueOrThrow({ where: { id: legacy.id } }), legacy);
    const admitted = await system.computer.create({ data: probe });
    await system.computer.delete({ where: { id: admitted.id } });
    await assert.rejects(system.computer.create({ data: { ...probe, scope: "invalid" } }), /computers_scope_check/);
    checks.push("real legacy scope CHECK migration preserves existing rows, admits isolated and rejects unknown scopes");
  } finally { await scopeSql.end(); }
  const bot = await system.bot.create({ data: { ...actor, name: "Fixture Mico", color: "#10B981", agentEngine: "codex", taskConcurrency: 1, thread: { create: actor } }, include: { thread: true } });
  const handler = { handler: (fn: unknown) => fn };
  const taskInbox = Object.fromEntries(["followUp", "available", "list", "start", "messages", "read", "send", "markRead", "archive", "stop", "answer"].map(name => [name, handler]));
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
  const development = Object.fromEntries(["open", "rename", "list", "requests", "status", "projects", "saveProject", "projectTask", "primaryRun", "archive", "restore", "remove", "branch"].map(name => [name, handler]));
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
  const local = await system.computer.create({
    data: { ...actor, scope: "dedicated", scopeKey: `bot:${bot.id}`, homeKey: bot.id, kind: "desktop" },
  });
  await system.bot.update({ where: { id: bot.id }, data: { computerId: local.id } });
  const offlineRun = await system.run.update({
    where: { id: waiting.id },
    data: { status: "running", leaseOwner: "synthetic-worker", leaseFence: 1, leaseExpiresAt: new Date(Date.now() + 60_000) },
  });
  const isolated = new FakeSandboxProvider();
  let pcOnline = false;
  const sandbox = new HostAwareSandbox(isolated, new FakeSandboxProvider(), async () => pcOnline);
  const workerLease = { workerId: "synthetic-worker", fence: 1 };
  const select = () => selectOfflineCloudWorkspace(prisma, sandbox, offlineRun, local, workerLease);
  await assert.rejects(runAsTenant(actor, () =>
    selectOfflineCloudWorkspace(prisma, sandbox, offlineRun, local, { ...workerLease, fence: 0 })));
  assert.equal(await system.computer.count({ where: { scopeKey: { startsWith: "cloud:" } } }), 0);
  const cloud = await runAsTenant(actor, select);
  assert.ok(cloud);
  assert.notEqual(cloud.homeKey, local.homeKey);
  const persisted = await system.run.findUniqueOrThrow({ where: { id: offlineRun.id } });
  pcOnline = true;
  assert.equal((await runAsTenant(actor, () =>
    selectOfflineCloudWorkspace(prisma, sandbox, persisted, local, workerLease)))?.id, cloud.id);
  await assert.rejects(runAsTenant(actor, () => selectOfflineCloudWorkspace(
    prisma, sandbox, { ...persisted, userId: "other-user" }, local, workerLease,
  )));
  const cloudFence = await runAsTenant(actor, () => acquireDedicatedScreenLeaseFence(prisma, {
    computerId: cloud.id, botId: bot.id, runId: offlineRun.id, workerId: workerLease.workerId,
    runFence: workerLease.fence, cloudWorkspace: true,
  }));
  const ref = await runAsTenant(actor, () => provisionComputer({
    prisma, sandbox, home: new LocalAgentHomeStore(path.join(directory, "homes")),
    jobs: { ...jobs, cancel: async () => undefined, close: async () => undefined },
    events: deps.events,
  }, cloud.id, {
    ...actor, operationId: offlineRun.id, traceId: offlineRun.id, runId: offlineRun.id, botId: bot.id,
    cloudWorkspace: { workerId: workerLease.workerId, runFence: workerLease.fence },
    signal: AbortSignal.timeout(10_000),
  }, "bot"));
  assert.equal(ref.providerRef, `fake-${cloud.homeKey}`);
  assert.equal((await system.bot.findUniqueOrThrow({ where: { id: bot.id } })).computerId, local.id);
  assert.deepEqual(await system.computer.findUniqueOrThrow({ where: { id: local.id } }), local);
  await runAsTenant(actor, () => releaseComputerExecutionLease(prisma, cloudFence));
  checks.push("real offline workspace migration, worker fencing, owner isolation and separate provisioning after Desktop reconnects");
  // Archive stops the conversation's work first, then archives the thread itself.
  await call("archive", { id: first.id, archived: true });
  assert.equal(await system.run.count({ where: { threadId: first.threadId,
    status: { in: ["queued", "leased", "running", "waiting_input", "waiting_takeover"] } } }), 0);
  assert.ok((await system.thread.findUniqueOrThrow({ where: { id: first.threadId } })).archivedAt);
  // Writing from Tasks brings it back in the same transaction, with its history.
  // A native engine needs no model connection in this synthetic fixture.
  await system.bot.update({ where: { id: bot.id }, data: { agentEngine: "codex" } });
  await call("send", { id: first.id, text: "Restore by writing", clientNonce: randomUUID() });
  await system.bot.update({ where: { id: bot.id }, data: { agentEngine: "pi" } });
  assert.equal((await system.thread.findUniqueOrThrow({ where: { id: first.threadId } })).archivedAt, null);
  await call("archive", { id: first.id, archived: true });
  await call("archive", { id: first.id, archived: false });
  assert.equal((await system.thread.findUniqueOrThrow({ where: { id: first.threadId } })).archivedAt, null);
  checks.push("existing task tabs see inbox conversations; archive stops active work first and a send from Tasks restores");
  // The same persistence path used by bots.update must leave conversations,
  // memory and the computer's files intact when an owner selects another model.
  await system.memoryDocument.create({ data: {
    ...actor, botId: bot.id, scope: "bot", path: "notes.md", content: "Owner-approved fixture notes", userControlled: true,
  } });
  const homeDirectory = new LocalAgentHomeStore(path.join(directory, "homes")).pathFor(bot.id);
  await mkdir(homeDirectory, { recursive: true });
  const homeFile = path.join(homeDirectory, "continuity.txt");
  await writeFile(homeFile, "Original workspace file", "utf8");
  const continuity = async () => ({
    threads: await system.thread.findMany({ where: { OR: [{ botId: bot.id }, { taskBotId: bot.id }] }, orderBy: { id: "asc" } }),
    messages: await system.message.findMany({ where: { thread: { OR: [{ botId: bot.id }, { taskBotId: bot.id }] } }, orderBy: { id: "asc" } }),
    memory: await system.memoryDocument.findMany({ where: { botId: bot.id }, orderBy: { id: "asc" } }),
    computer: await system.computer.findUniqueOrThrow({ where: { id: local.id } }),
    file: await readFile(homeFile, "utf8"),
    usage: await system.usageRecord.count(),
    runs: await system.run.findMany({ where: { botId: bot.id }, orderBy: { id: "asc" } }),
  });
  const beforeProviderChange = await continuity();
  const originalProfile = await system.bot.findUniqueOrThrow({ where: { id: bot.id } });
  for (const [modelProvider, modelId] of [["fixture-managed", "credit-model"], ["fixture-personal", "own-model"]]) {
    await runAsTenant(actor, () => commitBotUpdate({
      prisma, notify: async () => { throw Error("Model selection must not notify a new task"); },
      ...actor, threadId: bot.thread!.id, botId: bot.id, emitBotUpdated: false,
      data: { modelProvider, modelId, agentEngine: "pi", nativeConfig: Prisma.JsonNull, thinkingLevel: null },
    }));
    const updated = await system.bot.findUniqueOrThrow({ where: { id: bot.id } });
    assert.equal(updated.modelProvider, modelProvider);
    assert.equal(updated.modelId, modelId);
    const { modelProvider: _oldProvider, modelId: _oldModel, agentEngine: _oldEngine, nativeConfig: _oldConfig, thinkingLevel: _oldEffort, updatedAt: _oldUpdated, ...oldIdentity } = originalProfile;
    const { modelProvider: _provider, modelId: _model, agentEngine: _engine, nativeConfig: _config, thinkingLevel: _effort, updatedAt: _updated, ...newIdentity } = updated;
    assert.deepEqual(newIdentity, oldIdentity);
    assert.deepEqual(await continuity(), beforeProviderChange);
  }
  checks.push("real PostgreSQL model persistence preserves Mico identity, task histories, memory, computer, files and usage without replay");
  await assert.rejects(call("read", { id: first.id }, { ...actor, userId: "foreign" }));
  await assert.rejects(call("read", { id: first.id }, { ...actor, spaceId: "foreign" }));
  const range = { from: new Date(Date.now() - 86400000).toISOString(), to: new Date(Date.now() + 86400000).toISOString(), timeZone: "Europe/Madrid" };
  const usage = await runAsTenant(actor, () => usageDashboard(prisma, actor, range));
  assert.equal(usage.totals.costUsd, null);
  assert.equal((await runAsTenant(actor, () => routineCalendar(prisma, actor, range))).routines.length, 0);
  await assert.rejects(runAsTenant({ ...actor, userId: "foreign" }, () => usageDashboard(prisma, { ...actor, userId: "foreign" }, { ...range, botId: bot.id })));
  checks.push("bounded calendar/usage reads and API owner/Space isolation; missing usage is not zero cost");
  const balance = () => runAsTenant(actor, () => sporeRewards(prisma, actor));
  assert.deepEqual(await balance(), { welcome: 100, earned: 0, progressTokens: 0 });
  const modelUsage = { provider: "fixture", model: "fixture", operationKind: "compaction" };
  const firstCall = { ...modelUsage, ...actor, callId: randomUUID(), totalTokens: 999_999 };
  await system.usageRecord.create({ data: firstCall });
  assert.deepEqual(await balance(), { welcome: 100, earned: 0, progressTokens: 999_999 });
  await system.usageRecord.createMany({
    skipDuplicates: true,
    data: [
      firstCall,
      { ...modelUsage, userId: actor.userId, spaceId: "other-space", operationKind: "setup",
        inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4,
        cacheWrite1hTokens: 4, reasoningTokens: 2 },
      { ...modelUsage, ...actor, inputTokens: 99_000_000 },
      { ...modelUsage, ...actor, userId: "another-user", totalTokens: 10_000_000 },
    ],
  });
  const expectedRewards = { welcome: 100, earned: 1, progressTokens: 9 };
  assert.deepEqual(await balance(), expectedRewards);
  assert.deepEqual(await balance(), expectedRewards);
  checks.push("trial Spore threshold, cross-Space account ownership, canonical usage and replay safety");
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
  // Default creation assigns private metadata, never a live provider resource.
  // Keep this proof on a distinct synthetic member so existing fixtures stay intact.
  const privateActor = { ...actor, userId: `isolated-${id}` };
  await system.user.create({ data: { id: privateActor.userId, name: "Synthetic isolated member", email: `isolated-${id}@example.invalid` } });
  await system.member.create({ data: { id: randomUUID(), userId: privateActor.userId, organizationId: id, role: "member", createdAt: new Date() } });
  await system.spaceMember.create({ data: { id: randomUUID(), userId: privateActor.userId, organizationId: id, spaceId: actor.spaceId, role: "member", createdAt: new Date() } });
  const previousProvider = process.env.SANDBOX_PROVIDER;
  const previousLimit = process.env.SANDBOX_MAX_COMPUTERS_PER_USER;
  const legacyAssignment = await system.bot.findUniqueOrThrow({ where: { id: bot.id } });
  try {
    process.env.SANDBOX_PROVIDER = "fake";
    process.env.SANDBOX_MAX_COMPUTERS_PER_USER = "2";
    const privateRepos = createRepos(prisma);
    const create = (name: string) => runAsTenant(privateActor, () => privateRepos.createBot(privateActor, { name, spawnKey: `isolated-fixture:${name}` }));
    const firstPrivate = await create("First private Mico");
    const secondPrivate = await create("Second private Mico");
    const repeatPrivate = await create("First private Mico");
    assert.equal(repeatPrivate.id, firstPrivate.id);
    assert.equal(firstPrivate.computerMode, "isolated");
    assert.equal(secondPrivate.computerMode, "isolated");
    const rows = await system.bot.findMany({ where: { userId: privateActor.userId }, include: { computer: true, thread: true }, orderBy: { name: "asc" } });
    assert.equal(rows.length, 2);
    assert.notEqual(rows[0]!.computerId, rows[1]!.computerId);
    assert.notEqual(rows[0]!.computer!.homeKey, rows[1]!.computer!.homeKey);
    assert(rows.every(row => row.computer!.scope === "isolated" && row.computer!.state === "stopped" && row.computer!.providerRef === null));
    assert.equal(await system.run.count({ where: { userId: privateActor.userId } }), 0);
    await assert.rejects(create("Past the limit"), /computer limit/);
    assert.equal(await system.bot.count({ where: { userId: privateActor.userId } }), 2);
    await assert.rejects(runAsTenant(actor, () => privateRepos.getBot(actor, firstPrivate.id)));
    const isolatedProvider = new FakeSandboxProvider();
    const forbiddenHost = new FakeSandboxProvider();
    const hostDescription = forbiddenHost.describe();
    forbiddenHost.describe = () => ({ ...hostDescription, id: "desktop" });
    let hostCalls = 0;
    forbiddenHost.provision = async () => { hostCalls++; throw Error("Unexpected Desktop provision"); };
    const pinnedSandbox = new HostAwareSandbox(isolatedProvider, forbiddenHost, async () => true);
    const privateDeps = {
      prisma, sandbox: pinnedSandbox, home: new LocalAgentHomeStore(path.join(directory, "isolated-homes")),
      jobs: { ...jobs, cancel: async () => undefined, close: async () => undefined }, events: deps.events,
    };
    await assert.rejects(runAsTenant(actor, () => provisionComputer(privateDeps, rows[0]!.computerId!, {
      ...actor, botId: bot.id, operationId: "foreign-boot", traceId: id, signal: AbortSignal.timeout(10_000),
    })), /not assigned/);
    assert.equal(isolatedProvider.boxes.size, 0);
    const refs = [];
    const privateLeases = [];
    for (const row of rows) {
      const ctx = { ...privateActor, botId: row.id, operationId: `boot:${row.id}`, traceId: row.id, signal: AbortSignal.timeout(10_000) };
      refs.push(await runAsTenant(privateActor, () => provisionComputer(privateDeps, row.computerId!, ctx)));
      const task = await system.task.create({ data: { ...privateActor, botId: row.id, threadId: row.thread!.id, prompt: "Synthetic lease only", status: "running" } });
      const active = await system.run.create({ data: { ...privateActor, botId: row.id, threadId: row.thread!.id, taskId: task.id, status: "running", trigger: "user", leaseOwner: "isolated-worker", leaseFence: 1, leaseExpiresAt: new Date(Date.now() + 60_000) } });
      const input = { computerId: row.computerId!, botId: row.id, runId: active.id, workerId: "isolated-worker", runFence: 1 };
      await assert.rejects(runAsTenant(privateActor, () => acquireDedicatedScreenLeaseFence(prisma, { ...input, runFence: 0 })));
      privateLeases.push(await runAsTenant(privateActor, () => acquireDedicatedScreenLeaseFence(prisma, input)));
    }
    assert.notEqual(privateLeases[0]!.computerId, privateLeases[1]!.computerId);
    assert.equal(hostCalls, 0);
    assert.equal(isolatedProvider.boxes.size, 2);
    const fileContext = { ...privateActor, operationId: "private-file-proof", traceId: id, signal: AbortSignal.timeout(10_000), isolatedWorkspace: true };
    await pinnedSandbox.writeFile(refs[0]!, { path: "secret.txt", content: new TextEncoder().encode("First Mico only") }, fileContext);
    await assert.rejects(pinnedSandbox.readFile(refs[1]!, "secret.txt", fileContext));
    assert.equal(new TextDecoder().decode(await pinnedSandbox.readFile(refs[0]!, "secret.txt", fileContext)), "First Mico only");
    assert.deepEqual(await system.bot.findUniqueOrThrow({ where: { id: bot.id } }), legacyAssignment);
    for (const held of privateLeases) await runAsTenant(privateActor, () => releaseComputerExecutionLease(prisma, held));
    checks.push("real PostgreSQL default isolated assignment, idempotency, quota, account boundaries, private files, independent screen fences and no Desktop fallback (synthetic provider only)");
  } finally {
    if (previousProvider === undefined) delete process.env.SANDBOX_PROVIDER; else process.env.SANDBOX_PROVIDER = previousProvider;
    if (previousLimit === undefined) delete process.env.SANDBOX_MAX_COMPUTERS_PER_USER; else process.env.SANDBOX_MAX_COMPUTERS_PER_USER = previousLimit;
  }

  // Team setup uses a distinct endpoint so an older server cannot ignore a flag
  // and silently enqueue a model greeting. Exercise its actual route and repos.
  await system.member.create({ data: { id: randomUUID(), userId: actor.userId, organizationId: id, role: "owner", createdAt: new Date() } });
  await system.spaceMember.create({ data: { id: randomUUID(), userId: actor.userId, organizationId: id, spaceId: actor.spaceId, role: "owner", createdAt: new Date() } });
  let modelReads = 0, enqueued = 0;
  const protectedTables = new Set(["userModelRole", "userModelPreference", "userModelCredential"]);
  const guarded = new Proxy(prisma, { get(target, property) {
    if (protectedTables.has(String(property))) { modelReads++; throw Error("No model access during profile setup"); }
    return Reflect.get(target, property);
  } });
  const authed: any = new Proxy({}, { get: () => new Proxy({}, { get: () => handler }) });
  const profileRoutes = botsRoutes({ deps: { prisma: guarded, env: { agentRuntime: "pi" }, jobs: { enqueue: async () => { enqueued++; } } }, repos: createRepos(guarded), authed } as never).bots as any;
  const createProfile = (scope = actor, name = "Synthetic lead") => runAsTenant(scope, () => profileRoutes.createProfile({ context: { actor: scope }, input: { ...CreateBotInput.parse({ name, spawnKey: "onboarding:first" }), expectedUserId: actor.userId } }));
  const beforeRuns = await system.run.count(), beforeUsage = await system.usageRecord.count();
  const [profile, repeated] = await Promise.all([createProfile(), createProfile()]);
  assert.equal(profile.id, repeated.id);
  await system.bot.update({ where: { id: profile.id }, data: { instructions: "Owner-edited instructions" } });
  assert.equal((await createProfile(actor, "Another requested name")).id, profile.id);
  assert.equal((await system.bot.findUniqueOrThrow({ where: { id: profile.id } })).instructions, "Owner-edited instructions");
  await assert.rejects(createProfile({ ...actor, userId: "foreign" }));
  assert.equal(modelReads, 0); assert.equal(enqueued, 0);
  assert.equal(await system.run.count(), beforeRuns); assert.equal(await system.usageRecord.count(), beforeUsage);
  checks.push("profile-only API creates once, preserves edits and account isolation, without model access or queued runs");
  const result = { passed: true, checks, productionAccess: false, modelsCalled: false };
  await writeFile(path.join(directory, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  if (db) { await db.prisma.$disconnect(); await db.pool.end(); }
  await database.stop();
}
