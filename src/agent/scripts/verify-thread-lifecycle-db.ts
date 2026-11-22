import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import EmbeddedPostgres from "embedded-postgres";

// Synthetic, disposable loopback PostgreSQL only: no production data, accounts or models.
// A verification CLI supplies its own environment and never loads a checkout's .env.
process.env.NODE_ENV = "test";
process.env.CONTENT_ENCRYPTION = "off";
const { createDb, asSystem, runAsTenant, createThreadEvents, createRepos, recordThreadTurnOutcome, createThreadMessageInTransaction, LocalKeyProvider } =
  await import("@mycellios/db");
const { developmentRoutes } = await import("../apps/api/src/routes/development.js");
const { taskInboxRoutes } = await import("../apps/api/src/routes/task-inbox.js");
const { threadsRoutes } = await import("../apps/api/src/routes/threads.js");
const { purgeDeletedThread, reconcileThreadDeletions } = await import("../packages/adapters/src/thread-deletion.js");
const { PiJsonlSessionRecorder, piSessionBotRoot, piSessionsRoot } = await import("../packages/adapters/src/pi-session.js");
const { MarkdownMemoryStore } = await import("../packages/memory/src/index.js");

const socket = createServer();
await new Promise<void>((resolve) => socket.listen(0, "127.0.0.1", resolve));
const port = (socket.address() as { port: number }).port;
await new Promise<void>((resolve) => socket.close(() => resolve()));
const directory = await mkdtemp(path.join(tmpdir(), "mycellios-thread-lifecycle-"));
const dataDir = path.join(directory, "data");
const password = randomBytes(24).toString("hex");
const postgres = new EmbeddedPostgres({ databaseDir: path.join(directory, "pg"), port, user: "postgres", password,
  persistent: true, createPostgresUser: false, autoRehydrateSymlinks: true, initdbFlags: ["--encoding=UTF8", "--locale=C"],
  onLog: () => {}, onError: () => {} });
let db: ReturnType<typeof createDb> | undefined;
let memoryDb: ReturnType<typeof createDb> | undefined;
const checks: string[] = [];
try {
  await postgres.initialise();
  await postgres.start();
  const url = `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`;
  await promisify(execFile)(process.execPath, [path.resolve("node_modules/prisma/build/index.js"), "db", "push", "--config", "packages/db/prisma.config.ts"],
    { windowsHide: true, env: { ...process.env, DATABASE_URL: url, DATABASE_MIGRATION_URL: url }, maxBuffer: 1024 * 1024 });
  db = createDb(url, { encryptContent: false, applicationName: "synthetic-thread-lifecycle" });
  const prisma = db.prisma, system = asSystem(prisma, "synthetic thread lifecycle fixtures");
  const sql = await db.pool.connect();
  const one = async <T = Record<string, unknown>>(text: string, values: unknown[] = []) => (await sql.query(text, values)).rows[0] as T;
  try {
    assert.match((await sql.query("SHOW listen_addresses")).rows[0].listen_addresses, /^(localhost|127\.0\.0\.1|::1)$/);
    const actor = { userId: "owner", spaceId: "space", organizationId: "org", email: "owner@example.invalid", isDeploymentOwner: false };
    await system.user.create({ data: { id: actor.userId, name: "Synthetic owner", email: actor.email } });
    await system.organization.create({ data: { id: "org", name: "Synthetic", slug: "thread-lifecycle", createdAt: new Date() } });
    await system.space.create({ data: { id: "space", organizationId: "org", name: "Synthetic" } });
    await system.member.create({ data: { id: "member", userId: "owner", organizationId: "org", role: "owner", createdAt: new Date() } });
    await system.spaceMember.create({ data: { id: "space-member", userId: "owner", organizationId: "org", spaceId: "space", role: "owner", createdAt: new Date() } });
    const bot = await system.bot.create({ data: { id: "mico", spaceId: "space", userId: "owner", name: "Synthetic Mico", color: "#10B981",
      agentEngine: "codex", thread: { create: { spaceId: "space", userId: "owner" } } }, include: { thread: true } });
    const main = bot.thread!.id;

    // 1. The real migration on rows written before it: archive, opener, title source and outcome.
    const legacy = async (id: string, projectKey: string, taskKey: string, title: string | null) =>
      system.thread.create({ data: { id, spaceId: "space", userId: "owner", taskBotId: "mico", projectKey, taskKey, title } });
    await legacy("conv-archived", "mico:mico", "mico-task:mico:a", "Plan");
    await legacy("conv-open", "mico:mico", "mico-task:mico:b", null);
    await legacy("routine", "routine:r1", "routine:r1", "Daily");
    await legacy("flow", "workflow:w1", "workflow:e1:mico", "Step");
    await legacy("helper", "work:root", "delegation:k1", "Check");
    await legacy("transfer", "work:root", "work-transfer:t1:1", "Moved");
    await legacy("project", "project:p1", "project:p1:t1", "Repo");
    const run = async (threadId: string, status: string, minutes: number, extra: { trigger?: string; error?: string } = {}) => {
      const task = await system.task.create({ data: { spaceId: "space", botId: "mico", threadId, userId: "owner", prompt: "Synthetic", status } });
      return system.run.create({ data: { spaceId: "space", botId: "mico", threadId, taskId: task.id, userId: "owner", status,
        trigger: extra.trigger ?? "user", error: extra.error ?? null, createdAt: new Date(Date.UTC(2026, 10, 1, 0, minutes)) } });
    };
    await run("conv-open", "completed", 1);
    await run("conv-open", "failed", 2, { error: `  ${"x".repeat(2500)}` });
    await run("conv-open", "failed", 3, { trigger: "tickets", error: "background" });
    await run("conv-open", "queued", 4);
    await run("routine", "cancelled", 1, { trigger: "routine" });
    await run("helper", "failed", 1, { error: "old" });
    await run("helper", "completed", 2, { trigger: "delegated_task" });
    await sql.query(`INSERT INTO task_inbox (id,"spaceId","userId","botId","threadId","clientNonce",title,"archivedAt")
      VALUES ('i-a','space','owner','mico','conv-archived','conversation:conv-archived','Plan','2026-11-01T00:00:00Z'),
             ('i-b','space','owner','mico','conv-open','conversation:conv-open','Open',NULL)`);
    await sql.query(`ALTER TABLE threads DROP COLUMN "archivedAt", DROP COLUMN "titleSource", DROP COLUMN "startedBy",
      DROP COLUMN "startedByRunId", DROP COLUMN "outcome", DROP COLUMN "lastError", DROP COLUMN "deleteAfter",
      DROP COLUMN "branchedFromThreadId", DROP COLUMN "branchedFromMessageId"`);
    await sql.query(await readFile("packages/db/prisma/migrations/20261122120000_thread_lifecycle/migration.sql", "utf8"));
    const after = async (id: string) => one<{ archivedAt: string | null; startedBy: string | null; titleSource: string | null; outcome: string | null; lastError: string | null }>(
      `SELECT to_char("archivedAt",'YYYY-MM-DD HH24:MI:SS') AS "archivedAt","startedBy","titleSource",outcome,"lastError" FROM threads WHERE id=$1`, [id]);
    assert.equal((await after("conv-archived")).archivedAt, "2026-11-01 00:00:00");
    assert.equal((await after("conv-open")).archivedAt, null);
    const openers: Record<string, string | null> = {};
    for (const id of ["conv-archived", "conv-open", "routine", "flow", "helper", "transfer", "project", main])
      openers[id] = (await after(id)).startedBy;
    assert.deepEqual(openers, { "conv-archived": "user", "conv-open": "user", routine: "routine", flow: "routine", helper: "delegation", transfer: "delegation", project: "user", [main]: null });
    assert.equal((await after("routine")).titleSource, "auto");
    assert.equal((await after("helper")).titleSource, "auto");
    assert.equal((await after("conv-archived")).titleSource, null);
    assert.equal((await after("project")).titleSource, null);
    const open = await after("conv-open");
    assert.equal(open.outcome, "failed");
    assert.equal(Array.from(open.lastError ?? "").length, 2000);
    assert.equal(open.lastError?.startsWith("xxx"), true);
    assert.equal((await after("routine")).outcome, "interrupted");
    assert.deepEqual([(await after("helper")).outcome, (await after("helper")).lastError], ["completed", null]);
    assert.equal((await after("conv-archived")).outcome, null);
    checks.push("migration backfills archive from Tasks, opener per thread kind, server title sources and the last finished non-background turn with a bounded error");
    await assert.rejects(sql.query(`UPDATE threads SET "titleSource"='robot' WHERE id='conv-open'`));
    await assert.rejects(sql.query(`UPDATE threads SET outcome='answered' WHERE id='conv-open'`));
    await assert.rejects(sql.query(`UPDATE threads SET "lastError"=repeat('y',2001) WHERE id='conv-open'`));
    await assert.rejects(sql.query(`UPDATE threads SET "archivedAt"=now() WHERE id=$1`, [main]));
    await assert.rejects(sql.query(`UPDATE threads SET "deleteAfter"=now() WHERE id=$1`, [main]));
    const starter = await run("helper", "completed", 3);
    await sql.query(`UPDATE threads SET "startedByRunId"=$1,"branchedFromThreadId"='conv-open' WHERE id='transfer'`, [starter.id]);
    await system.run.delete({ where: { id: starter.id } });
    assert.equal((await one<{ startedByRunId: string | null }>(`SELECT "startedByRunId" FROM threads WHERE id='transfer'`)).startedByRunId, null);
    checks.push("constraints refuse unknown sources/outcomes, oversized errors and any archive or delete of the main chat; reference columns clear on source deletion");

    // 2. Real routes: title rule, rename, archive that stops work, restore on send from Tasks.
    const handler = { handler: (fn: unknown) => fn };
    const enqueued: Array<{ name: string; payload: unknown; availableAt?: Date }> = [];
    const jobs = { enqueue: async (job: { name: string; payload: unknown; availableAt?: Date }) => { enqueued.push(job); } };
    const deps = { prisma, events: createThreadEvents(prisma), jobs, sandbox: {} };
    const anyRoute = new Proxy({}, { get: () => new Proxy({}, { get: () => handler }) });
    const dev = developmentRoutes({ deps, authed: anyRoute } as never).development as unknown as Record<string, (v: unknown) => Promise<any>>;
    const inbox = taskInboxRoutes({ deps, repos: createRepos(prisma), authed: anyRoute } as never).taskInbox as unknown as Record<string, (v: unknown) => Promise<any>>;
    const threads = threadsRoutes({ deps, authed: anyRoute, callsEnabled: anyRoute } as never).threads as unknown as Record<string, (v: unknown) => Promise<any>>;
    const call = (fn: ((v: unknown) => Promise<any>) | undefined, input: object, scope = actor) => runAsTenant(scope, () => fn!({ context: { actor: scope }, input }));
    const opened = await call(dev.open, { botId: "mico", projectKey: "mico:mico", taskKey: `mico-task:mico:${randomUUID()}` });
    const conv = opened.threadId as string;
    const send = (text: string, clientNonce = randomUUID()) => call(threads.send, { botId: "mico", taskThreadId: conv, text, clientNonce });
    const firstNonce = randomUUID();
    const firstSend = await send("  \n  Revisar el presupuesto de 2027 \nCon detalle", firstNonce);
    const row = async () => (await call(dev.list, { botId: "mico" })).find((item: any) => item.threadId === conv);
    assert.deepEqual([(await row()).title, (await row()).titleSource, (await row()).startedBy, (await row()).state], ["Revisar el presupuesto de 2027", "auto", "user", "queued"]);
    await assert.rejects(call(dev.rename, { botId: "mico", taskThreadId: conv, title: "Dos\nlíneas" }), /1 to 120 characters/);
    await assert.rejects(call(dev.rename, { botId: "mico", taskThreadId: conv, title: "x".repeat(121) }), /1 to 120 characters/);
    await call(dev.rename, { botId: "mico", taskThreadId: conv, title: " Presupuesto 2027 " });
    await send("Otro mensaje");
    assert.deepEqual([(await row()).title, (await row()).titleSource], ["Presupuesto 2027", "user"]);
    checks.push("first non-empty line titles a conversation; rename validates 1-120 characters on one line, marks a person's title and is never replaced");
    await assert.rejects(call(dev.remove, { botId: "mico", taskThreadId: conv }), (error: any) => error.code === "busy");
    await assert.rejects(call(dev.archive, { botId: "mico", taskThreadId: main }));
    await assert.rejects(call(dev.remove, { botId: "mico", taskThreadId: main }));
    await call(inbox.list, {});
    const archived = await call(dev.archive, { botId: "mico", taskThreadId: conv });
    assert.ok(archived.archivedAt);
    assert.equal(await system.run.count({ where: { threadId: conv, status: { in: ["queued", "leased", "running", "waiting_input", "waiting_takeover"] } } }), 0);
    assert.deepEqual([(await row()).state, (await row()).archived, (await row()).outcome], ["closed", true, "interrupted"]);
    const mirror = async () => one<{ archivedAt: Date | null; pinned: boolean }>(`SELECT "archivedAt",pinned FROM task_inbox WHERE "threadId"=$1`, [conv]);
    assert.ok((await mirror()).archivedAt);
    const entry = (await call(inbox.list, {})).find((item: any) => item.threadId === conv);
    assert.ok(entry.archivedAt);
    assert.equal(entry.outcome, "interrupted");
    checks.push("archive cancels queued messages and runs, records a stopped turn, archives the thread and mirrors Tasks; main chat refused; delete refused while work runs");
    const before = await system.message.count({ where: { threadId: conv } });
    await call(inbox.send, { id: entry.id, text: "Seguimos desde Tareas", clientNonce: randomUUID() });
    assert.equal(await system.message.count({ where: { threadId: conv } }), before + 1);
    assert.deepEqual([(await row()).archived, (await row()).outcome, (await row()).state], [false, null, "queued"]);
    assert.equal((await mirror()).archivedAt, null);
    await call(inbox.archive, { id: entry.id, archived: true });
    assert.equal((await row()).archived, true);
    await call(inbox.archive, { id: entry.id, archived: false });
    assert.equal((await row()).archived, false);
    checks.push("a Tasks send restores an archived conversation in the send transaction; Tasks archive stops running work first and restores through the thread");
    const failed = await system.run.findFirstOrThrow({ where: { threadId: conv }, orderBy: { createdAt: "asc" } });
    await runAsTenant(actor, () => prisma.$transaction((tx) => recordThreadTurnOutcome(tx, { threadId: conv, runIds: [failed.id], outcome: "failed", error: "z".repeat(2100) })));
    assert.equal(Array.from((await row()).lastError).length, 2000);
    const background = await run(conv, "failed", 9, { trigger: "project_prepare" });
    await runAsTenant(actor, () => prisma.$transaction((tx) => recordThreadTurnOutcome(tx, { threadId: conv, runIds: [background.id], outcome: "completed" })));
    assert.equal((await row()).outcome, "failed");
    await runAsTenant(actor, () => prisma.$transaction((tx) => createThreadMessageInTransaction(tx, { threadId: conv, role: "user", blocks: [{ kind: "text", text: "Reintenta" }] })));
    assert.deepEqual([(await row()).outcome, (await row()).lastError], [null, null]);
    checks.push("turn outcome and error are bounded, background work never changes them and the next message clears them");

    // 3. Delete with undo, refused sends, uncertain nonce replay and removal.
    await call(threads.stop, { botId: "mico", taskThreadId: conv });
    const deleted = await call(dev.remove, { botId: "mico", taskThreadId: conv });
    const deleteAfter = new Date(deleted.deleteAfter);
    assert.ok(deleteAfter.getTime() > Date.now() + 4000 && deleteAfter.getTime() <= Date.now() + 6000);
    assert.equal((await call(dev.remove, { botId: "mico", taskThreadId: conv })).deleteAfter, deleted.deleteAfter);
    const job = enqueued.find((item) => item.name === "thread.delete");
    assert.equal(job?.availableAt?.getTime(), deleteAfter.getTime() + 5000);
    assert.deepEqual([(await row()).state, (await row()).deleteAfter], ["closed", deleted.deleteAfter]);
    assert.equal((await call(inbox.list, {})).some((item: any) => item.threadId === conv), false);
    await assert.rejects(send("No debería llegar"), (error: any) => error.code === "deleting");
    await assert.rejects(call(dev.rename, { botId: "mico", taskThreadId: conv, title: "Nuevo" }));
    const messages = await system.message.count({ where: { threadId: conv } });
    const replayed = await send("ignored", firstNonce);
    assert.deepEqual([replayed.messageId, replayed.taskId], [firstSend.messageId, firstSend.taskId]);
    assert.equal(await system.message.count({ where: { threadId: conv } }), messages);
    assert.deepEqual(await call(dev.restore, { botId: "mico", taskThreadId: conv }), { ok: true, restored: "delete" });
    assert.equal((await row()).deleteAfter, null);
    checks.push("delete hides the conversation for a 6 s undo window, refuses new writes, replays an uncertain send by its nonce and undo brings it back");
    // A send waiting on the delete's lock is refused once the delete commits.
    const holder = await db.pool.connect();
    try {
      await holder.query("BEGIN");
      await holder.query(`SELECT id FROM threads WHERE id=$1 FOR UPDATE`, [conv]);
      await holder.query(`UPDATE threads SET "deleteAfter"=(now() AT TIME ZONE 'UTC')+interval '6 seconds' WHERE id=$1`, [conv]);
      let settled = false;
      const racing = send("Mientras se borra").finally(() => { settled = true; });
      racing.catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 300));
      assert.equal(settled, false);
      await holder.query("COMMIT");
      await assert.rejects(racing, (error: any) => error.code === "deleting");
    } finally { await holder.query("ROLLBACK").catch(() => undefined); holder.release(); }
    checks.push("a send that waits on a concurrent delete's thread lock is refused after it commits");

    // Removal: owned outputs, sessions, pins, notes, Tasks entry; shared outputs and uploads stay.
    const convRuns = await system.run.findMany({ where: { threadId: conv }, select: { id: true, taskId: true } });
    const helperRun = await system.run.findFirstOrThrow({ where: { threadId: "helper" } });
    const artifact = (id: string, runId: string | null, rootArtifactId?: string) => system.artifact.create({ data: { id, spaceId: "space",
      userId: "owner", botId: "mico", runId, rootArtifactId, name: `${id}.txt`, mimeType: "text/plain", size: 1, hash: id, storageKey: `key-${id}`,
      version: rootArtifactId ? 2 : 1 } });
    await artifact("own", convRuns[0]!.id); await artifact("own-v2", convRuns[1]!.id, "own");
    await artifact("shown-elsewhere", convRuns[0]!.id); await artifact("uploaded", null);
    await artifact("mixed", convRuns[0]!.id); await artifact("mixed-v2", helperRun.id, "mixed");
    await system.message.create({ data: { threadId: main, seq: 900, role: "user", blocks: [{ kind: "file", artifactId: "shown-elsewhere", name: "x", mimeType: "text/plain", size: 1 }] } });
    const convMessage = await system.message.findFirstOrThrow({ where: { threadId: conv } });
    await system.messagePin.create({ data: { messageId: convMessage.id, threadId: conv, spaceId: "space", userId: "owner" } });
    await system.memoryDocument.create({ data: { spaceId: "space", userId: "owner", botId: "mico", scope: "bot", path: `tasks/${conv}/notes.md`, content: "Nota", taskThreadId: conv } });
    memoryDb = createDb(url, {
      encryptContent: true,
      keyProvider: new LocalKeyProvider([{ id: "synthetic", key: randomBytes(32) }]),
      applicationName: "synthetic-encrypted-memory",
    });
    const memoryPrisma = memoryDb.prisma;
    const memorySystem = asSystem(memoryPrisma, "synthetic encrypted memories");
    const memory = async (id: string, userId: string, sources: string[]) => {
      const revisions = sources.map((sourceThreadId, index) => ({
        sourceThreadId, revision: index + 1, content: `${id} version ${index + 1}`,
      }));
      const latest = revisions.at(-1)!;
      await memorySystem.memoryDocument.create({ data: {
        id, spaceId: actor.spaceId, userId, scope: "user", path: `reviews/${id}.md`,
        content: latest.content, revision: latest.revision,
      } });
      for (const revision of revisions) {
        await memorySystem.memoryRevision.create({ data: { documentId: id, ...revision } });
      }
    };
    await memory("derived-only", actor.userId, [conv]);
    await memory("restore-earlier", actor.userId, [main, conv]);
    await memory("keep-current", actor.userId, [conv, main]);
    await memory("other-owner", "another-user", [conv]);
    const child = await system.task.create({ data: { spaceId: "space", botId: "mico", threadId: "helper", userId: "owner", prompt: "Hijo", status: "completed",
      delegationState: "completed", parentTaskId: convRuns[0]!.taskId } });
    const recorder = new PiJsonlSessionRecorder(piSessionsRoot(dataDir), dataDir);
    for (const threadId of [conv, "helper"]) await recorder.start({ runId: randomUUID(), threadId, botId: "mico", userId: "owner",
      provider: "synthetic", model: "synthetic", thinkingLevel: "off", systemPrompt: "Synthetic", initialMessages: [] });
    const nativeFolder = path.join(dataDir, "native-agents", createHash("sha256").update(JSON.stringify(["space", "owner", "mico", conv, "codex"])).digest("hex"));
    await mkdir(nativeFolder, { recursive: true });
    const removed: string[] = [];
    const store = { remove: async (key: string) => { removed.push(key); } } as never;
    const pending = await call(dev.remove, { botId: "mico", taskThreadId: conv });
    const due = new Date(new Date(pending.deleteAfter).getTime() + 1);
    const source = await system.thread.findUniqueOrThrow({ where: { id: conv } });
    const memoryStore = new MarkdownMemoryStore(memoryPrisma);
    await assert.rejects(runAsTenant(actor, () => memoryStore.commit({
      scope: "user", path: "reviews/late-review.md", content: "Late result",
      sourceThreadId: conv, sourceContext: {
        generation: source.historyCompactionGeneration, startSeq: source.contextStartSeq, nextSeq: source.nextMessageSeq,
      },
    }, {
      ...actor, botId: "mico", operationId: "fixture", traceId: "fixture", signal: AbortSignal.timeout(5000),
    })), /Memory review source changed/);
    assert.equal(await runAsTenant(actor, () => purgeDeletedThread({ prisma, artifacts: store, dataDir }, conv, new Date(due.getTime() - 1000))), "not_due");
    assert.equal(await system.thread.count({ where: { id: conv } }), 1);
    assert.equal(await system.memoryDocument.count({ where: { id: "derived-only" } }), 1);
    assert.equal(await runAsTenant(actor, () => purgeDeletedThread({ prisma: memoryPrisma, artifacts: store, dataDir }, conv, due)), "purged");
    assert.equal(await system.thread.count({ where: { id: conv } }), 0);
    assert.equal(await system.message.count({ where: { threadId: conv } }), 0);
    assert.equal(await system.run.count({ where: { threadId: conv } }), 0);
    assert.equal(await system.messagePin.count({ where: { threadId: conv } }), 0);
    assert.equal(await system.memoryDocument.count({ where: { taskThreadId: conv } }), 0);
    assert.equal(await system.memoryDocument.count({ where: { id: "derived-only" } }), 0);
    assert.deepEqual(await memorySystem.memoryDocument.findUnique({
      where: { id: "restore-earlier" }, select: { content: true, revision: true },
    }), { content: "restore-earlier version 1", revision: 3 });
    assert.deepEqual(await memorySystem.memoryDocument.findUnique({
      where: { id: "keep-current" }, select: { content: true, revision: true },
    }), { content: "keep-current version 2", revision: 2 });
    assert.notEqual((await one<{ content: string }>(
      "SELECT content FROM memory_documents WHERE id = $1", ["restore-earlier"],
    )).content, "restore-earlier version 1");
    assert.equal(await system.memoryRevision.count({
      where: { sourceThreadId: conv, document: { userId: actor.userId } },
    }), 0);
    assert.equal(await system.memoryRevision.count({ where: { documentId: "other-owner" } }), 1);
    assert.equal(await system.inboxTask.count({ where: { threadId: conv } }), 0);
    assert.deepEqual(removed.sort(), ["key-own", "key-own-v2"]);
    assert.deepEqual((await system.artifact.findMany({ orderBy: { id: "asc" }, select: { id: true } })).map((item) => item.id),
      ["mixed", "mixed-v2", "shown-elsewhere", "uploaded"]);
    assert.equal((await system.task.findUniqueOrThrow({ where: { id: child.id } })).parentTaskId, null);
    const sessions = await readdir(piSessionBotRoot(piSessionsRoot(dataDir), "owner", "mico"));
    assert.equal(sessions.length, 1);
    assert.match(await readFile(path.join(piSessionBotRoot(piSessionsRoot(dataDir), "owner", "mico"), sessions[0]!), "utf8"), /ThreadId":"helper"/);
    await assert.rejects(stat(nativeFolder));
    assert.equal(await system.thread.count({ where: { id: main } }), 1);
    checks.push("removal after the window deletes messages, runs, pins, task notes, the Tasks entry, owned outputs and session files; shared outputs, uploads and delegated children stay");
    checks.push("a pending delete fences late reviews, and permanent deletion forgets only the owner's sourced memory revisions, restoring an independent encrypted version");

    // Lost jobs are finished by the reconciler; an undo after the window is refused.
    const late = await call(dev.open, { botId: "mico", projectKey: "mico:mico", taskKey: `mico-task:mico:${randomUUID()}` });
    await call(dev.remove, { botId: "mico", taskThreadId: late.threadId });
    await sql.query(`UPDATE threads SET "deleteAfter"=(now() AT TIME ZONE 'UTC')-interval '1 second' WHERE id=$1`, [late.threadId]);
    await assert.rejects(call(dev.restore, { botId: "mico", taskThreadId: late.threadId }), (error: any) => error.code === "deleted");
    await reconcileThreadDeletions({ prisma, artifacts: store, dataDir }, new Date(Date.now() + 10_000));
    assert.equal(await system.thread.count({ where: { id: late.threadId } }), 0);
    checks.push("an undo after the window is refused and the reconciler finishes deletes whose job was lost");

    // A conversation the Mico opened for the person is theirs to rename and delete; delegated work is not.
    const startedId = "mico-started";
    await system.thread.create({ data: { id: startedId, spaceId: "space", userId: "owner", taskBotId: "mico", projectKey: "mico:mico",
      taskKey: `agent-task:mico:${randomUUID()}`, startedBy: "agent", title: "Comparar ofertas", titleSource: "agent" } });
    const started = async () => (await call(dev.list, { botId: "mico" })).find((item: any) => item.threadId === startedId);
    assert.deepEqual([(await started()).startedBy, (await started()).unread], ["agent", false]);
    await sql.query(`UPDATE threads SET unread=true WHERE id=$1`, [startedId]);
    assert.equal((await started()).unread, true);
    await call(dev.rename, { botId: "mico", taskThreadId: startedId, title: " Ofertas de luz " });
    assert.deepEqual([(await started()).title, (await started()).titleSource], ["Ofertas de luz", "user"]);
    const startedDelete = await call(dev.remove, { botId: "mico", taskThreadId: startedId });
    assert.equal((await started()).deleteAfter, startedDelete.deleteAfter);
    assert.deepEqual(await call(dev.restore, { botId: "mico", taskThreadId: startedId }), { ok: true, restored: "delete" });
    await assert.rejects(call(dev.rename, { botId: "mico", taskThreadId: "helper", title: "Mine" }));
    await assert.rejects(call(dev.remove, { botId: "mico", taskThreadId: "helper" }), (error: any) => error.code === "not_deletable");
    checks.push("a conversation the Mico opened lists its opener and unread replies, takes the person's title and deletes with undo; delegated work keeps its name and stays");
  } finally {
    sql.release();
  }
  const result = { passed: true, checks, productionAccess: false, modelsCalled: false, directory };
  await writeFile(path.join(directory, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  if (memoryDb) { await memoryDb.prisma.$disconnect(); await memoryDb.pool.end(); }
  if (db) { await db.prisma.$disconnect(); await db.pool.end(); }
  await postgres.stop();
}
