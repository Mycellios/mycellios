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
// Checks the real SQL behind the sidebar counts, Mark all as read, Mark as unread and the
// requests a Mico's conversations mirror into its main chat.
process.env.NODE_ENV = "test";
process.env.CONTENT_ENCRYPTION = "off";
const { createDb, asSystem, runAsTenant, createThreadEvents, createRepos } = await import("@mycellios/db");
const { developmentRoutes } = await import("../apps/api/src/routes/development.js");
const { threadsRoutes } = await import("../apps/api/src/routes/threads.js");

const socket = createServer();
await new Promise<void>((resolve) => socket.listen(0, "127.0.0.1", resolve));
const port = (socket.address() as { port: number }).port;
await new Promise<void>((resolve) => socket.close(() => resolve()));
const directory = await mkdtemp(path.join(tmpdir(), "mycellios-conversation-surfaces-"));
const password = randomBytes(24).toString("hex");
const postgres = new EmbeddedPostgres({ databaseDir: path.join(directory, "pg"), port, user: "postgres", password,
  persistent: true, createPostgresUser: false, autoRehydrateSymlinks: true, initdbFlags: ["--encoding=UTF8", "--locale=C"],
  onLog: () => {}, onError: () => {} });
let db: ReturnType<typeof createDb> | undefined;
const checks: string[] = [];
try {
  await postgres.initialise();
  await postgres.start();
  const url = `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`;
  await promisify(execFile)(process.execPath, [path.resolve("node_modules/prisma/build/index.js"), "db", "push", "--config", "packages/db/prisma.config.ts"],
    { windowsHide: true, env: { ...process.env, DATABASE_URL: url, DATABASE_MIGRATION_URL: url }, maxBuffer: 1024 * 1024 });
  db = createDb(url, { encryptContent: false, applicationName: "synthetic-conversation-surfaces" });
  const prisma = db.prisma, system = asSystem(prisma, "synthetic conversation surface fixtures");
  const sql = await db.pool.connect();
  try {
    assert.match((await sql.query("SHOW listen_addresses")).rows[0].listen_addresses, /^(localhost|127\.0\.0\.1|::1)$/);
    await system.organization.create({ data: { id: "org", name: "Synthetic", slug: "conversation-surfaces", createdAt: new Date() } });
    await system.space.create({ data: { id: "space", organizationId: "org", name: "Synthetic" } });
    await system.space.create({ data: { id: "space-2", organizationId: "org", name: "Elsewhere" } });
    const person = async (userId: string, spaceId: string) => {
      await system.user.create({ data: { id: userId, name: userId, email: `${userId}@example.invalid` } });
      await system.member.create({ data: { id: `member-${userId}`, userId, organizationId: "org", role: "owner", createdAt: new Date() } });
      await system.spaceMember.create({ data: { id: `space-member-${userId}`, userId, organizationId: "org", spaceId, role: "owner", createdAt: new Date() } });
      return { userId, spaceId, organizationId: "org", email: `${userId}@example.invalid`, isDeploymentOwner: false };
    };
    const owner = await person("owner", "space");
    const neighbor = await person("neighbor", "space");
    const stranger = await person("stranger", "space-2");
    const mico = async (id: string, actor: { userId: string; spaceId: string }) => (await system.bot.create({ data: {
      id, spaceId: actor.spaceId, userId: actor.userId, name: id, color: "#10B981", agentEngine: "codex",
      thread: { create: { spaceId: actor.spaceId, userId: actor.userId } } }, include: { thread: true } })).thread!.id;
    const main = await mico("mico", owner);
    const otherMain = await mico("other", owner);
    const neighborMain = await mico("neighbor-mico", neighbor);
    const strangerMain = await mico("stranger-mico", stranger);
    const group = await system.chatGroup.create({ data: { spaceId: "space", userId: "owner", name: "Team",
      thread: { create: { spaceId: "space", userId: "owner" } } }, include: { thread: true } });
    const message = (threadId: string, seq: number, role: "user" | "bot", blocks: object[], extra: { runId?: string; clientNonce?: string } = {}) =>
      system.message.create({ data: { threadId, seq, role, blocks, ...extra } });
    const thread = async (id: string, data: Record<string, unknown> = {}, actor = owner, botId = "mico") =>
      system.thread.create({ data: { id, spaceId: actor.spaceId, userId: actor.userId, taskBotId: botId, projectKey: `mico:${botId}`,
        taskKey: `mico-task:${botId}:${id}`, title: id, startedBy: "user", ...data } });
    const run = async (threadId: string, status: string, trigger = "user", actor = owner, botId = "mico") => {
      const task = await system.task.create({ data: { spaceId: actor.spaceId, botId, threadId, userId: actor.userId, prompt: "Synthetic", status } });
      return system.run.create({ data: { spaceId: actor.spaceId, botId, threadId, taskId: task.id, userId: actor.userId, status, trigger } });
    };
    const seq = (id: string, next: number, read: number, unread = true) =>
      system.thread.update({ where: { id }, data: { nextMessageSeq: next, lastReadSeq: read, unread } });

    // Main chat: one reply read, then two replies and a progress note after the person's message.
    await message(main, 0, "bot", [{ kind: "text", text: "Hello" }]);
    await message(main, 1, "user", [{ kind: "text", text: "Compare offers" }]);
    await message(main, 2, "bot", [{ kind: "text", text: "First" }]);
    await message(main, 3, "bot", [{ kind: "progress", text: "Looking" }], { clientNonce: "user-progress:r:1" });
    await message(main, 4, "bot", [{ kind: "text", text: "Second" }]);
    await seq(main, 5, -1);
    await message(otherMain, 0, "bot", [{ kind: "text", text: "Hi" }]);
    await seq(otherMain, 1, -1);
    await seq(group.thread!.id, 3, 0);
    await seq(neighborMain, 2, -1);
    await seq(strangerMain, 2, -1);

    // Conversations of the Mico: open ones count, closed or project ones do not.
    await thread("s-unread", { unread: true, nextMessageSeq: 2, lastReadSeq: 0 });
    await thread("s-waiting");
    const asking = await run("s-waiting", "waiting_input");
    const ask = await message("s-waiting", 0, "bot", [{ kind: "text", text: "Two offers" },
      { kind: "ask", text: "Which supplier?", status: "pending" }], { runId: asking.id });
    await thread("s-takeover");
    await run("s-takeover", "waiting_takeover");
    await thread("s-working");
    await run("s-working", "running");
    await thread("s-background");
    await run("s-background", "running", "tickets");
    await thread("s-archived", { archivedAt: new Date(), unread: true, nextMessageSeq: 3, lastReadSeq: 0 });
    await thread("s-deleting", { deleteAfter: new Date(Date.now() + 60_000), unread: true });
    await thread("s-project", { projectKey: "project:p1", taskKey: "project:p1:t", unread: true });
    await thread("s-neighbor", { unread: true, nextMessageSeq: 1, lastReadSeq: -1 }, neighbor, "neighbor-mico");
    await thread("s-stranger", { unread: true, nextMessageSeq: 1, lastReadSeq: -1 }, stranger, "stranger-mico");

    const repos = createRepos(prisma);
    const list = async () => runAsTenant(owner, () => repos.listBots(owner));
    const roster = async () => new Map((await list()).map((bot) => [bot.id, bot]));
    let bots = await roster();
    assert.equal(bots.get("mico")!.unreadCount, 2);
    assert.deepEqual({ ...bots.get("mico")!.conversations, revision: undefined }, { open: 5, unread: 1, waiting: 2, working: 1, revision: undefined });
    assert.equal(bots.get("other")!.unreadCount, 1);
    assert.equal(bots.get("other")!.conversations, undefined);
    checks.push("roster counts main-chat replies after the read cursor and the person's last message, without progress notes");
    checks.push("roster summarizes only open conversations (not archived, deleting or project ones); background work is not working");
    const revision = bots.get("mico")!.conversations!.revision;
    await message("s-working", 0, "bot", [{ kind: "text", text: "Progress" }]);
    await system.thread.update({ where: { id: "s-working" }, data: { nextMessageSeq: 1, nextEventSeq: 1 } });
    bots = await roster();
    assert.notEqual(bots.get("mico")!.conversations!.revision, revision);
    checks.push("the summary revision moves when a conversation moves, so expanded lists read again");

    // The pending requests mirror into the main chat and answer through the conversation's fenced path.
    const enqueued: unknown[] = [];
    const deps = { prisma, events: createThreadEvents(prisma), jobs: { enqueue: async (job: unknown) => { enqueued.push(job); } }, sandbox: {} };
    const anyRoute = new Proxy({}, { get: () => new Proxy({}, { get: () => ({ handler: (fn: unknown) => fn }) }) });
    const dev = developmentRoutes({ deps, authed: anyRoute } as never).development as unknown as Record<string, (v: unknown) => Promise<any>>;
    const threads = threadsRoutes({ deps, authed: anyRoute, callsEnabled: anyRoute } as never).threads as unknown as Record<string, (v: unknown) => Promise<any>>;
    const call = (fn: ((v: unknown) => Promise<any>) | undefined, input: object, actor = owner) =>
      runAsTenant(actor, () => fn!({ context: { actor }, input }));
    const requests = await call(dev.requests, { botId: "mico" });
    assert.deepEqual(requests.map((request: { threadId: string; kind: string; messageId: string | null }) =>
      [request.threadId, request.kind, request.messageId]).sort(), [["s-takeover", "takeover", null], ["s-waiting", "question", ask.id]]);
    assert.equal(requests.find((request: { threadId: string }) => request.threadId === "s-waiting").block.text, "Which supplier?");
    await assert.rejects(call(dev.requests, { botId: "mico" }, neighbor));
    await assert.rejects(call(dev.requests, { botId: "mico" }, stranger));
    checks.push("development.requests lists a Mico's pending questions and takeovers only to its owner, within the Space");
    await call(threads.answer, { botId: "mico", taskThreadId: "s-waiting", runId: asking.id, messageId: ask.id, answer: "The cheaper one" });
    assert.equal((await system.run.findUniqueOrThrow({ where: { id: asking.id } })).status, "queued");
    assert.equal(enqueued.length, 1);
    const after = await call(dev.requests, { botId: "mico" });
    assert.deepEqual(after.map((request: { threadId: string }) => request.threadId), ["s-takeover"]);
    await assert.rejects(call(threads.answer, { botId: "mico", taskThreadId: "s-waiting", runId: asking.id, messageId: ask.id, answer: "Again" }));
    checks.push("an answer through threads.answer with the conversation's id resolves the request everywhere and cannot be given twice");

    // Mark all as read for one Mico: its main chat and open conversations, nothing else.
    const state = async (id: string) => system.thread.findUniqueOrThrow({ where: { id }, select: { unread: true, lastReadSeq: true, nextMessageSeq: true } });
    const read = await call(threads.markAllRead, { botId: "mico" });
    assert.ok(read.threads >= 2);
    assert.deepEqual(await state(main), { unread: false, lastReadSeq: 4, nextMessageSeq: 5 });
    assert.equal((await state("s-unread")).unread, false);
    assert.equal((await state("s-archived")).unread, true);
    assert.equal((await state("s-deleting")).unread, true);
    assert.equal((await state(otherMain)).unread, true);
    assert.equal((await state(group.thread!.id)).unread, true);
    await assert.rejects(call(threads.markAllRead, { botId: "mico" }, neighbor));
    await assert.rejects(call(threads.markAllRead, { botId: "neighbor-mico" }));
    assert.equal((await state("s-neighbor")).unread, true);
    checks.push("a Mico's Mark as read reads its main chat and open conversations, never archived, deleting or other people's");

    // Mark as unread: the newest reply reads as new again, so the count is one.
    await call(threads.markUnread, { botId: "mico" });
    assert.deepEqual(await state(main), { unread: true, lastReadSeq: 3, nextMessageSeq: 5 });
    assert.equal((await roster()).get("mico")!.unreadCount, 1);
    checks.push("Mark as unread on a Mico makes its newest reply unread with a count of one");

    // Mark all as read for the whole sidebar: every chat of the person in the Space.
    await call(threads.markAllRead, {});
    for (const id of [main, otherMain, group.thread!.id]) assert.equal((await state(id)).unread, false, id);
    assert.equal((await state("s-archived")).unread, true);
    for (const id of [neighborMain, strangerMain, "s-neighbor", "s-stranger"]) assert.equal((await state(id)).unread, true, id);
    bots = await roster();
    assert.equal(bots.get("mico")!.unreadCount, undefined);
    assert.equal(bots.get("mico")!.conversations!.unread, 0);
    checks.push("the sidebar's Mark all as read reads every main chat, group and open conversation of the person, in their Space only");
  } finally {
    sql.release();
  }
  const result = { passed: true, checks, productionAccess: false, modelsCalled: false, directory };
  await writeFile(path.join(directory, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  if (db) { await db.prisma.$disconnect(); await db.pool.end(); }
  await postgres.stop();
}
