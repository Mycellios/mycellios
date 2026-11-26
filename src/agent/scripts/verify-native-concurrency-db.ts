import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import EmbeddedPostgres from "embedded-postgres";

// Synthetic, disposable loopback PostgreSQL only: no production data, accounts or models.
// A verification CLI supplies its own environment and never loads a checkout's .env.
// Covers specs/native-engines/spec.md phase 4 with MYCELLIOS_NATIVE_CONCURRENCY off and on:
// claimMicoRun lanes, the queue's waiting reason, delegation capacity, the work menu's limit
// and the usage-limit hold, through the real transactions and routes.
process.env.NODE_ENV = "test";
process.env.CONTENT_ENCRYPTION = "off";
delete process.env.MYCELLIOS_NATIVE_CONCURRENCY;
const { createDb, asSystem, runAsTenant, createThreadEvents, claimMicoRun, delegateWork, reconcileWork, finalizeRun } =
  await import("@mycellios/db");
const { HOSTED_MODEL_CREDITS_REQUIRED_ERROR } = await import("@mycellios/core");
const { threadsRoutes } = await import("../apps/api/src/routes/threads.js");
const { localCapabilityRoutes } = await import("../apps/api/src/routes/local-capabilities.js");

const socket = createServer();
await new Promise<void>((resolve) => socket.listen(0, "127.0.0.1", resolve));
const port = (socket.address() as { port: number }).port;
await new Promise<void>((resolve) => socket.close(() => resolve()));
const directory = await mkdtemp(path.join(tmpdir(), "mycellios-native-concurrency-"));
const password = randomBytes(24).toString("hex");
const postgres = new EmbeddedPostgres({ databaseDir: path.join(directory, "pg"), port, user: "postgres", password,
  persistent: true, createPostgresUser: false, autoRehydrateSymlinks: true, initdbFlags: ["--encoding=UTF8", "--locale=C"],
  onLog: () => {}, onError: () => {} });
let db: ReturnType<typeof createDb> | undefined;
const checks: string[] = [];
const flag = (on: boolean) => {
  if (on) process.env.MYCELLIOS_NATIVE_CONCURRENCY = "1";
  else delete process.env.MYCELLIOS_NATIVE_CONCURRENCY;
};
try {
  await postgres.initialise();
  await postgres.start();
  const url = `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`;
  await promisify(execFile)(process.execPath, [path.resolve("node_modules/prisma/build/index.js"), "db", "push", "--config", "packages/db/prisma.config.ts"],
    { windowsHide: true, env: { ...process.env, DATABASE_URL: url, DATABASE_MIGRATION_URL: url }, maxBuffer: 1024 * 1024 });
  db = createDb(url, { encryptContent: false, applicationName: "synthetic-native-concurrency" });
  const prisma = db.prisma, system = asSystem(prisma, "synthetic native concurrency fixtures");
  const sql = await db.pool.connect();
  try {
    assert.match((await sql.query("SHOW listen_addresses")).rows[0].listen_addresses, /^(localhost|127\.0\.0\.1|::1)$/);
  } finally {
    sql.release();
  }
  const scope = { spaceId: "space", userId: "owner" };
  const actor = { ...scope, organizationId: "org", email: "owner@example.invalid", isDeploymentOwner: false };
  await system.user.create({ data: { id: actor.userId, name: "Synthetic owner", email: actor.email } });
  await system.organization.create({ data: { id: "org", name: "Synthetic", slug: "native-concurrency", createdAt: new Date() } });
  await system.space.create({ data: { id: "space", organizationId: "org", name: "Synthetic" } });
  await system.member.create({ data: { id: "member", userId: "owner", organizationId: "org", role: "owner", createdAt: new Date() } });
  await system.spaceMember.create({ data: { id: "space-member", userId: "owner", organizationId: "org", spaceId: "space", role: "owner", createdAt: new Date() } });
  const mico = (id: string, agentEngine: string, taskConcurrency: number) => system.bot.create({ data: { id, ...scope, name: id, color: "#10B981",
    agentEngine, taskConcurrency, thread: { create: { ...scope } } }, include: { thread: true } });
  const side = (botId: string, key: string) => system.thread.create({ data: { ...scope, taskBotId: botId, projectKey: `mico:${botId}`, taskKey: `mico-task:${botId}:${key}` } });
  const queuedRun = async (threadId: string, botId: string) => {
    const task = await system.task.create({ data: { ...scope, botId, threadId, prompt: "Synthetic", status: "queued" } });
    return system.run.create({ data: { ...scope, botId, threadId, taskId: task.id, status: "queued", trigger: "user" } });
  };
  const admit = (run: { id: string; botId: string; threadId: string }) => runAsTenant(actor, () => claimMicoRun(prisma, { ...run, ...scope },
    { status: "queued" }, { status: "leased", leaseOwner: "worker", leaseFence: 1, leaseExpiresAt: new Date(Date.now() + 60_000) }));
  const admitted = async (threadId: string, botId: string) => (await admit(await queuedRun(threadId, botId))).count === 1;
  const endAll = (botId: string) => system.run.updateMany({ where: { botId, status: { in: ["queued", "leased", "running"] } },
    data: { status: "completed", completedAt: new Date(), leaseOwner: null, leaseExpiresAt: null } });
  // A message that waits in a conversation's queue, as a send with delivery "queue" leaves it.
  let messageSeq = 0;
  const waitingMessage = async (threadId: string, botId: string) => {
    const message = await system.message.create({ data: { threadId, seq: ++messageSeq, role: "user", blocks: [{ kind: "text", text: "Synthetic" }] } });
    await system.steeringMessage.create({ data: { messageId: message.id, botId, userId: "owner", originTrigger: "queued_user", position: messageSeq } });
    return message.id;
  };

  const handler = { handler: (fn: unknown) => fn };
  const anyRoute = new Proxy({}, { get: () => new Proxy({}, { get: () => handler }) });
  const deps = { prisma, events: createThreadEvents(prisma), jobs: { enqueue: async () => undefined }, sandbox: {} };
  const threads = threadsRoutes({ deps, authed: anyRoute, callsEnabled: anyRoute } as never).threads as unknown as Record<string, (v: unknown) => Promise<any>>;
  const local = localCapabilityRoutes({ deps, authed: anyRoute, repos: {} } as never) as unknown as { tasks: Record<string, (v: unknown) => Promise<any>> };
  const queueState = (botId: string, taskThreadId?: string) =>
    runAsTenant(actor, () => threads.queueState!({ context: { actor }, input: { botId, ...(taskThreadId ? { taskThreadId } : {}) } }));
  const workMenuLimit = (botId: string) => runAsTenant(actor, () => local.tasks.concurrency!({ context: { actor }, input: { botId } }));

  const codex = await mico("codex-mico", "codex", 2);
  const acp = await mico("acp-mico", "acp", 4);
  const claude = await mico("claude-mico", "claude", 2);
  const lead = await mico("lead-mico", "pi", 4);
  const [codexA, codexB, codexC] = [await side(codex.id, "a"), await side(codex.id, "b"), await side(codex.id, "c")];
  const [acpA, acpB] = [await side(acp.id, "a"), await side(acp.id, "b")];

  // 1. Off (the default): every native Mico runs one turn at a time in total, main chat included.
  flag(false);
  assert.equal(await admitted(codexA.id, codex.id), true);
  assert.equal(await admitted(codex.thread!.id, codex.id), false);
  assert.equal(await admitted(codexB.id, codex.id), false);
  await waitingMessage(codexB.id, codex.id);
  assert.deepEqual(await queueState(codex.id, codexB.id).then((state) => [state.waiting, state.slots]), ["slot", { running: 1, limit: 1 }]);
  await waitingMessage(codex.thread!.id, codex.id);
  assert.deepEqual(await queueState(codex.id).then((state) => [state.waiting, state.slots]), ["slot", { running: 1, limit: 1 }]);
  assert.deepEqual(await workMenuLimit(codex.id), { limit: 2, effectiveLimit: 1 });
  assert.deepEqual(await workMenuLimit(lead.id), { limit: 4, effectiveLimit: 4 });
  await endAll(codex.id);
  checks.push("off: a native Mico admits one turn in total, its main chat waits for the slot with its reason, and the work menu says one");

  // Delegated work to a native Mico whose main chat works waits while the switch is off.
  const leadTask = await system.task.create({ data: { ...scope, botId: lead.id, threadId: lead.thread!.id, prompt: "Synthetic lead", status: "running" } });
  const leadRun = await system.run.create({ data: { ...scope, botId: lead.id, threadId: lead.thread!.id, taskId: leadTask.id, status: "running",
    trigger: "user", leaseOwner: "lead-worker", leaseFence: 1, leaseExpiresAt: new Date(Date.now() + 60_000) } });
  const delegated = await delegateWork(system, { ...scope, id: leadRun.id, taskId: leadTask.id, botId: lead.id, threadId: lead.thread!.id,
    leaseOwner: "lead-worker", leaseFence: 1 }, { key: "native-delegation", botId: claude.id, instruction: "Check synthetic notes", expectedResult: "Notes checked" });
  await system.run.update({ where: { id: leadRun.id }, data: { status: "completed", completedAt: new Date(), leaseOwner: null, leaseExpiresAt: null } });
  assert.equal(await admitted(claude.thread!.id, claude.id), true);
  await reconcileWork(system);
  assert.equal((await system.task.findUniqueOrThrow({ where: { id: delegated.taskId } })).delegatedRunId, null);
  checks.push("off: delegated work waits behind a native Mico's main-chat turn");

  // 2. On: Codex, Claude Code and OpenCode get the Pi lanes.
  flag(true);
  await reconcileWork(system);
  const started = await system.task.findUniqueOrThrow({ where: { id: delegated.taskId } });
  assert.ok(started.delegatedRunId);
  assert.equal((await system.run.findUniqueOrThrow({ where: { id: started.delegatedRunId } })).status, "queued");
  await endAll(claude.id);
  checks.push("on: delegated work starts beside a native Mico's main-chat turn, in one of its conversation slots");

  const many = [];
  for (let index = 0; index < 6; index++) many.push(await queuedRun((await side(codex.id, `race-${index}`)).id, codex.id));
  const raced = await Promise.all(many.map(admit));
  assert.equal(raced.filter((claim) => claim.count === 1).length, 2);
  assert.equal(await admitted(codexA.id, codex.id), false);
  // With both slots taken, a main-chat turn that has not started waits only for its own lane.
  const mainTurn = await queuedRun(codex.thread!.id, codex.id);
  const mainState = await queueState(codex.id);
  assert.deepEqual([mainState.waiting, mainState.slots], ["busy", undefined]);
  assert.equal((await admit(mainTurn)).count, 1);
  assert.equal(await admitted(codex.thread!.id, codex.id), false);
  const racedWinner = many.find((_, index) => raced[index]!.count === 1)!;
  assert.equal(await admitted(racedWinner.threadId, codex.id), false);
  checks.push("on: simultaneous claims admit exactly the Mico's conversation limit, the main chat runs beside them one turn at a time, and each conversation keeps one turn");

  assert.equal(await admitted(codexC.id, codex.id), false);
  await waitingMessage(codexC.id, codex.id);
  assert.deepEqual(await queueState(codex.id, codexC.id).then((state) => [state.waiting, state.slots]), ["slot", { running: 2, limit: 2 }]);
  assert.deepEqual(await workMenuLimit(codex.id), { limit: 2, effectiveLimit: 2 });
  await endAll(codex.id);
  checks.push("on: a side conversation past the limit waits for a slot with its count, the main chat never does, and the work menu shows the limit");

  assert.equal(await admitted(acpA.id, acp.id), true);
  assert.equal(await admitted(acp.thread!.id, acp.id), false);
  assert.equal(await admitted(acpB.id, acp.id), false);
  assert.deepEqual(await workMenuLimit(acp.id), { limit: 4, effectiveLimit: 1 });
  await endAll(acp.id);
  checks.push("on: a generic ACP agent stays at one turn in total");

  // 3. On: a usage-limit failure in one conversation still holds that conversation's queue.
  const failing = await queuedRun(codexB.id, codex.id);
  assert.equal((await admit(failing)).count, 1);
  await system.run.update({ where: { id: failing.id }, data: { status: "running", startedAt: new Date() } });
  const attempt = await system.attempt.create({ data: { runId: failing.id, fence: 1, status: "running" } });
  await runAsTenant(actor, () => finalizeRun(prisma, { ...scope, threadId: codexB.id, botId: codex.id, runId: failing.id, taskId: failing.taskId,
    attemptId: attempt.id, leaseOwner: "worker", leaseFence: 1, outcome: "failed", error: HOSTED_MODEL_CREDITS_REQUIRED_ERROR }));
  assert.equal(await system.run.count({ where: { threadId: codexB.id, status: "queued" } }), 0);
  assert.equal((await queueState(codex.id, codexB.id)).waiting, "usage");
  assert.equal(await admitted(codexA.id, codex.id), true);
  await endAll(codex.id);
  checks.push("on: a usage-limit failure keeps that conversation's queued message waiting while other conversations keep running");

  // 4. Off again: the same Micos go back to one turn in total at once.
  flag(false);
  assert.equal(await admitted(codexA.id, codex.id), true);
  assert.equal(await admitted(codexC.id, codex.id), false);
  assert.equal(await admitted(codex.thread!.id, codex.id), false);
  await endAll(codex.id);
  checks.push("switching the flag off restores one turn in total for the next admission");

  // 5. Off: a separate-browser routine turn runs on a server workspace with a Pi model, so it
  // neither takes nor waits for the native Mico's single slot. Other routines still do.
  const routineTurn = async (isolatedBrowser: boolean, key: string) => {
    const thread = await side(claude.id, key);
    const routine = await system.routine.create({ data: { ...scope, botId: claude.id, threadId: thread.id, name: key,
      prompt: "Synthetic routine", isolatedBrowser } });
    const task = await system.task.create({ data: { ...scope, botId: claude.id, threadId: thread.id, prompt: "Synthetic", status: "queued" } });
    return system.run.create({ data: { ...scope, botId: claude.id, threadId: thread.id, taskId: task.id, status: "queued",
      trigger: "routine", routineId: routine.id } });
  };
  const [claudeA, claudeB] = [await side(claude.id, "a"), await side(claude.id, "b")];
  assert.equal((await admit(await routineTurn(true, "browser-1"))).count, 1);
  assert.equal(await admitted(claudeA.id, claude.id), true);
  assert.equal((await admit(await routineTurn(true, "browser-2"))).count, 1);
  assert.equal(await admitted(claudeB.id, claude.id), false);
  await waitingMessage(claudeB.id, claude.id);
  assert.deepEqual(await queueState(claude.id, claudeB.id).then((state) => [state.waiting, state.slots]), ["slot", { running: 1, limit: 1 }]);
  assert.equal((await admit(await routineTurn(false, "plain"))).count, 0);
  await endAll(claude.id);
  // A separate-browser routine turn that already began on this PC keeps counting.
  const begun = await routineTurn(true, "begun");
  assert.equal((await admit(begun)).count, 1);
  await system.run.update({ where: { id: begun.id }, data: { status: "running", startedAt: new Date() } });
  assert.equal(await admitted(claudeA.id, claude.id), false);
  await endAll(claude.id);
  checks.push("off: separate-browser routine turns on the server neither take nor wait for a native Mico's slot; plain and already-begun routine turns still count");

  const result = { passed: true, checks, productionAccess: false, modelsCalled: false, directory };
  await writeFile(path.join(directory, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  flag(false);
  await db?.prisma.$disconnect().catch(() => undefined);
  await db?.pool.end().catch(() => undefined);
  await postgres.stop();
}
