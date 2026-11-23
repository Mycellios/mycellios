import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import EmbeddedPostgres from "embedded-postgres";

// Synthetic, disposable loopback PostgreSQL only: no production data, accounts or models.
// A verification CLI supplies its own environment and never loads a checkout's .env.
// Covers specs/mico-message-queue: the migration, queue order, edit holds, Send now, Steer now,
// delete only while queued, the takeover guarantee, Move to a new conversation and the
// main-chat lane of a Mico's turn limit, through the real routes and transactions.
process.env.NODE_ENV = "test";
process.env.CONTENT_ENCRYPTION = "off";
const {
  createDb, asSystem, runAsTenant, createThreadEvents, createPendingSteeringRun, claimMicoRun, finalizeRun,
  LocalKeyProvider,
} = await import("@mycellios/db");
const { HOSTED_MODEL_CREDITS_REQUIRED_ERROR } = await import("@mycellios/core");
const { threadsRoutes } = await import("../apps/api/src/routes/threads.js");

const socket = createServer();
await new Promise<void>((resolve) => socket.listen(0, "127.0.0.1", resolve));
const port = (socket.address() as { port: number }).port;
await new Promise<void>((resolve) => socket.close(() => resolve()));
const directory = await mkdtemp(path.join(tmpdir(), "mycellios-message-queue-"));
const password = randomBytes(24).toString("hex");
const postgres = new EmbeddedPostgres({ databaseDir: path.join(directory, "pg"), port, user: "postgres", password,
  persistent: true, createPostgresUser: false, autoRehydrateSymlinks: true, initdbFlags: ["--encoding=UTF8", "--locale=C"],
  onLog: () => {}, onError: () => {} });
const clients: Array<ReturnType<typeof createDb>> = [];
const checks: string[] = [];
try {
  await postgres.initialise();
  await postgres.start();
  const url = `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`;
  await promisify(execFile)(process.execPath, [path.resolve("node_modules/prisma/build/index.js"), "db", "push", "--config", "packages/db/prisma.config.ts"],
    { windowsHide: true, env: { ...process.env, DATABASE_URL: url, DATABASE_MIGRATION_URL: url }, maxBuffer: 1024 * 1024 });
  const db = createDb(url, { encryptContent: false, applicationName: "synthetic-message-queue" });
  clients.push(db);
  const prisma = db.prisma, system = asSystem(prisma, "synthetic message queue fixtures");
  const sql = await db.pool.connect();
  const rows = async <T = Record<string, unknown>>(text: string, values: unknown[] = []) => (await sql.query(text, values)).rows as T[];
  try {
    assert.match((await sql.query("SHOW listen_addresses")).rows[0].listen_addresses, /^(localhost|127\.0\.0\.1|::1)$/);
    const actor = { userId: "owner", spaceId: "space", organizationId: "org", email: "owner@example.invalid", isDeploymentOwner: false };
    await system.user.create({ data: { id: actor.userId, name: "Synthetic owner", email: actor.email } });
    await system.organization.create({ data: { id: "org", name: "Synthetic", slug: "message-queue", createdAt: new Date() } });
    await system.space.create({ data: { id: "space", organizationId: "org", name: "Synthetic" } });
    await system.member.create({ data: { id: "member", userId: "owner", organizationId: "org", role: "owner", createdAt: new Date() } });
    await system.spaceMember.create({ data: { id: "space-member", userId: "owner", organizationId: "org", spaceId: "space", role: "owner", createdAt: new Date() } });
    // A native engine keeps the send routes free of model setup; queue rules do not depend on it.
    const bot = await system.bot.create({ data: { id: "mico", spaceId: "space", userId: "owner", name: "Synthetic Mico", color: "#10B981",
      agentEngine: "codex", thread: { create: { spaceId: "space", userId: "owner" } } }, include: { thread: true } });
    const main = bot.thread!.id;

    let runNumber = 0;
    const liveRun = async (threadId: string, botId = "mico", extra: { trigger?: string; status?: string } = {}) => {
      runNumber++;
      const task = await system.task.create({ data: { spaceId: "space", botId, threadId, userId: "owner", prompt: "Synthetic", status: "running" } });
      return system.run.create({ data: { spaceId: "space", botId, threadId, taskId: task.id, userId: "owner", status: extra.status ?? "running",
        trigger: extra.trigger ?? "user", startedAt: new Date(), leaseOwner: "worker", leaseFence: 1, leaseExpiresAt: new Date(Date.now() + 300_000),
        createdAt: new Date(Date.UTC(2026, 10, 1, 0, runNumber)) } });
    };
    const endRun = (id: string) => system.run.update({ where: { id }, data: { status: "completed", completedAt: new Date(), leaseOwner: null, leaseExpiresAt: null } });

    // 1. The real migration on rows written before it: waiting rows keep their order.
    const legacyMessage = (seq: number) => system.message.create({ data: { threadId: main, seq, role: "user", blocks: [{ kind: "text", text: `Legacy ${seq}` }] } });
    const legacy = [await legacyMessage(1), await legacyMessage(2), await legacyMessage(3)];
    await system.thread.update({ where: { id: main }, data: { nextMessageSeq: 4 } });
    const legacyRun = await liveRun(main);
    await sql.query('ALTER TABLE runs DROP COLUMN "modelExecution"');
    await sql.query(await readFile("packages/db/prisma/migrations/20261123100000_conversation_turn_model/migration.sql", "utf8"));
    assert.equal((await system.run.findUniqueOrThrow({ where: { id: legacyRun.id } })).modelExecution, null);
    const execution = { agentEngine: "codex", nativeConfig: { modelId: "fixture-model" }, provider: "native-codex",
      modelId: "default", credentialId: null, thinkingLevel: null };
    await system.run.update({ where: { id: legacyRun.id }, data: { modelExecution: execution } });
    assert.deepEqual((await system.run.findUniqueOrThrow({ where: { id: legacyRun.id } })).modelExecution, execution);
    checks.push("turn model migration preserves old rows and stores the native selection without credentials");
    await sql.query(`ALTER TABLE steering_messages DROP COLUMN "position", DROP COLUMN "heldBy", DROP COLUMN "heldAt", DROP COLUMN "editDraft"`);
    await sql.query(`INSERT INTO steering_messages (id,"messageId","botId","userId","runId","originTrigger") VALUES
      ('legacy-a',$1,'mico','owner',NULL,'queued_user'), ('legacy-b',$2,'mico','owner',NULL,'queued_user'), ('legacy-steer',$3,'mico','owner',$4,NULL)`,
      [legacy[0]!.id, legacy[1]!.id, legacy[2]!.id, legacyRun.id]);
    await sql.query(await readFile("packages/db/prisma/migrations/20261123090000_message_queue_controls/migration.sql", "utf8"));
    const migrated = await rows<{ id: string; position: number | null; heldBy: string | null; editDraft: string | null }>(
      `SELECT id, position, "heldBy", "editDraft" FROM steering_messages ORDER BY id`);
    assert.deepEqual(migrated.map((row) => [row.id, row.position, row.heldBy, row.editDraft]),
      [["legacy-a", 1, null, null], ["legacy-b", 2, null, null], ["legacy-steer", null, null, null]]);
    await sql.query(`DELETE FROM messages WHERE id = ANY($1)`, [legacy.map((message) => message.id)]);
    await endRun(legacyRun.id);
    checks.push("migration adds position, hold and draft columns and keeps each waiting message's order as its message number");

    // Real routes, as the API mounts them.
    const handler = { handler: (fn: unknown) => fn };
    const enqueued: string[] = [];
    const jobs = { enqueue: async (job: { name: string; payload: unknown }) => { enqueued.push(JSON.stringify(job.payload)); } };
    const deps = { prisma, events: createThreadEvents(prisma), jobs, sandbox: {} };
    const anyRoute = new Proxy({}, { get: () => new Proxy({}, { get: () => handler }) });
    const threads = threadsRoutes({ deps, authed: anyRoute, callsEnabled: anyRoute } as never).threads as unknown as Record<string, (v: unknown) => Promise<any>>;
    const call = (name: string, input: object) => runAsTenant(actor, () => threads[name]!({ context: { actor }, input }));
    const conflict = (code: string) => (error: any) => error?.code === "CONFLICT" && error?.data?.queueCode === code;
    const queue = (text: string, target: object = { botId: "mico" }) => call("send", { ...target, text, clientNonce: randomUUID(), delivery: "queue" });
    const state = (target: object = { botId: "mico" }) => call("queueState", target);
    const order = async (target: object = { botId: "mico" }) => (await state(target)).messages.map((row: any) => row.text);
    const queuedRow = (messageId: string) => system.steeringMessage.findFirst({ where: { messageId } });

    // 2. Order, and the guarantee that the running turn never takes a queued message.
    const r1 = await liveRun(main);
    const [m1, m2, m3] = [await queue("Uno"), await queue("Dos"), await queue("Tres")];
    assert.deepEqual(await order(), ["Uno", "Dos", "Tres"]);
    const first = await state();
    assert.deepEqual([first.waiting, first.steer], ["busy", { available: true }]);
    assert.equal(first.messages[0].canMove, true);
    assert.equal((await queuedRow(m1.messageId))?.position, m1.seq);
    const claimed = await runAsTenant(actor, () => deps.events.claimSteering({ threadId: main, botId: "mico", runId: r1.id, leaseOwner: "worker", leaseFence: 1, seenIds: [] }));
    assert.deepEqual(claimed, []);
    assert.equal(await system.steeringMessage.count({ where: { originTrigger: "queued_user", runId: null } }), 3);
    checks.push("queued messages list in send order with why they wait, and a running turn's steering claim never takes them");

    // 3. Reorder with a stale-order check.
    await call("queueReorder", { botId: "mico", expected: [m1.messageId, m2.messageId, m3.messageId], order: [m3.messageId, m1.messageId, m2.messageId] });
    assert.deepEqual(await order(), ["Tres", "Uno", "Dos"]);
    await assert.rejects(call("queueReorder", { botId: "mico", expected: [m1.messageId, m2.messageId, m3.messageId], order: [m2.messageId, m1.messageId, m3.messageId] }), conflict("stale"));
    const positions = (await system.steeringMessage.findMany({ where: { originTrigger: "queued_user", runId: null } })).map((row) => row.position!).sort((a, b) => a - b);
    assert.deepEqual(positions, [m1.seq, m2.seq, m3.seq].sort((a, b) => a - b));
    await queue("Cuatro");
    assert.deepEqual(await order(), ["Tres", "Uno", "Dos", "Cuatro"]);
    checks.push("reorder keeps the queue's own positions, a later message still goes last, and an order someone else changed is refused as stale");

    // 4. An edit hold blocks dispatch until Save; drafts and holds are durable; another device is refused or takes over.
    const holdA = randomUUID(), holdB = randomUUID();
    const opened = await call("queueEdit", { botId: "mico", messageId: m3.messageId, holdId: holdA });
    assert.deepEqual(opened, { text: "Tres", draft: null });
    await assert.rejects(call("queueEdit", { botId: "mico", messageId: m3.messageId, holdId: holdB }), conflict("held"));
    await call("queueEditDraft", { botId: "mico", messageId: m3.messageId, holdId: holdA, draft: "Tres, revisado" });
    await assert.rejects(call("queueSendNow", { botId: "mico", messageId: m3.messageId }), conflict("held"));
    await assert.rejects(call("queueSteer", { botId: "mico", messageId: m3.messageId }), conflict("held"));
    await endRun(r1.id);
    const blocked = await runAsTenant(actor, () => prisma.$transaction((tx) => createPendingSteeringRun(tx, { spaceId: "space", threadId: main, botId: "mico" })));
    assert.equal(blocked, null);
    assert.equal((await state()).waiting, "held");
    const reread = createDb(url, { encryptContent: false, applicationName: "synthetic-message-queue-restart" });
    clients.push(reread);
    const durable = await asSystem(reread.prisma, "restart check").steeringMessage.findFirstOrThrow({ where: { messageId: m3.messageId } });
    assert.deepEqual([durable.heldBy, durable.editDraft], [holdA, "Tres, revisado"]);
    const taken = await call("queueEdit", { botId: "mico", messageId: m3.messageId, holdId: holdB, takeOver: true });
    assert.equal(taken.draft, "Tres, revisado");
    await assert.rejects(call("queueEditSave", { botId: "mico", messageId: m3.messageId, holdId: holdA, text: "Viejo" }), conflict("not_held"));
    await assert.rejects(call("queueEditSave", { botId: "mico", messageId: m3.messageId, holdId: holdB, text: "   " }), conflict("empty"));
    await call("queueEditSave", { botId: "mico", messageId: m3.messageId, holdId: holdB, text: "Tres, revisado" });
    const edited = await system.message.findUniqueOrThrow({ where: { id: m3.messageId } });
    assert.deepEqual(edited.blocks, [{ kind: "text", text: "Tres, revisado" }]);
    assert.equal(await system.event.count({ where: { threadId: main, type: "thread.message.updated", payload: { path: ["messageId"], equals: m3.messageId } } }), 1);
    const started = await system.run.findFirstOrThrow({ where: { threadId: main, sourceMessageId: m3.messageId } });
    assert.deepEqual([started.status, started.trigger], ["queued", "follow_up"]);
    assert.equal((await queuedRow(m3.messageId))?.runId, started.id);
    checks.push("an edit holds the first message so nothing is sent, survives a new client, refuses a second device unless it takes over (keeping the draft), and Save rewrites the message and starts it");

    // 5. Delete only while queued; a message someone edits needs confirmation.
    await assert.rejects(call("queueDelete", { botId: "mico", messageId: m3.messageId }), conflict("gone"));
    await assert.rejects(call("queueEdit", { botId: "mico", messageId: m3.messageId, holdId: holdA }), conflict("gone"));
    await call("queueEdit", { botId: "mico", messageId: m2.messageId, holdId: holdA });
    await assert.rejects(call("queueDelete", { botId: "mico", messageId: m2.messageId }), conflict("held"));
    await call("queueDelete", { botId: "mico", messageId: m2.messageId, force: true });
    assert.equal(await system.message.count({ where: { id: m2.messageId } }), 0);
    assert.equal(await system.event.count({ where: { threadId: main, type: "thread.message.deleted", payload: { path: ["messageId"], equals: m2.messageId } } }), 1);
    assert.deepEqual(await order(), ["Uno", "Cuatro"]);
    checks.push("delete removes only a message that still waits, from the queue and the conversation, and asks before removing one being edited");

    // 6. Send now stops only the current turn and starts the chosen message next.
    await endRun(started.id);
    const r2 = await liveRun(main);
    const a = await queue("Alfa");
    assert.deepEqual(await order(), ["Uno", "Cuatro", "Alfa"]);
    const sent = await call("queueSendNow", { botId: "mico", messageId: a.messageId });
    assert.equal((await system.run.findUniqueOrThrow({ where: { id: r2.id } })).status, "cancelled");
    const next = await system.run.findUniqueOrThrow({ where: { id: sent.runId } });
    assert.deepEqual([next.sourceMessageId, next.status], [a.messageId, "queued"]);
    assert.deepEqual(await order(), ["Uno", "Cuatro"]);
    await endRun(next.id);
    const following = await runAsTenant(actor, () => prisma.$transaction((tx) => createPendingSteeringRun(tx, { spaceId: "space", threadId: main, botId: "mico" })));
    assert.equal((await system.run.findUniqueOrThrow({ where: { id: following! } })).sourceMessageId, m1.messageId);
    await endRun(following!);
    // A queued message whose turn has not started yet goes back to the queue instead.
    const r2b = await liveRun(main);
    const [, gamma] = [await queue("Beta"), await queue("Gamma")];
    await endRun(r2b.id);
    const waitingTurn = await runAsTenant(actor, () => prisma.$transaction((tx) => createPendingSteeringRun(tx, { spaceId: "space", threadId: main, botId: "mico" })));
    assert.deepEqual(await order(), ["Beta", "Gamma"]);
    const jumped = await call("queueSendNow", { botId: "mico", messageId: gamma.messageId });
    assert.equal((await system.run.findUniqueOrThrow({ where: { id: waitingTurn! } })).status, "cancelled");
    assert.equal((await system.run.findUniqueOrThrow({ where: { id: jumped.runId } })).sourceMessageId, gamma.messageId);
    assert.deepEqual(await order(), ["Cuatro", "Beta"]);
    await endRun(jumped.runId);
    checks.push("Send now cancels only the running turn, starts that message next and leaves the rest of the queue in order; a queued turn that had not started gives its message back");

    // 7. Steer now joins the running turn as the person's own correction; never during a routine.
    const r3 = await liveRun(main);
    const steerMe = await queue("Usa marzo");
    await call("queueSteer", { botId: "mico", messageId: steerMe.messageId });
    const steered = await queuedRow(steerMe.messageId);
    assert.deepEqual([steered?.runId, steered?.originTrigger, steered?.position], [r3.id, null, null]);
    const taken3 = await runAsTenant(actor, () => deps.events.claimSteering({ threadId: main, botId: "mico", runId: r3.id, leaseOwner: "worker", leaseFence: 1, seenIds: [] }));
    assert.deepEqual(taken3.map((item) => item.messageId), [steerMe.messageId]);
    await endRun(r3.id);
    await system.steeringMessage.deleteMany({ where: { messageId: steerMe.messageId } });
    const routine = await liveRun(main, "mico", { trigger: "routine" });
    const later = await queue("Después de la rutina");
    await assert.rejects(call("queueSteer", { botId: "mico", messageId: later.messageId }), conflict("routine"));
    assert.deepEqual((await state()).steer, { available: false, blocked: "routine" });
    await endRun(routine.id);
    assert.deepEqual((await state()).steer, { available: false, blocked: "idle" });
    checks.push("Steer now hands the message to the running turn as owner steering it claims at its next step, and is refused while a routine runs");

    // 8. Queue actions never release a human takeover.
    const held = await liveRun(main, "mico", { status: "waiting_takeover" });
    const duringTakeover = await queue("Cuando termines");
    await call("queueSteer", { botId: "mico", messageId: duringTakeover.messageId });
    const another = await queue("Otra más");
    const current = (await state()).messages.map((row: any) => row.messageId as string);
    assert.ok(current.includes(another.messageId) && current.includes(later.messageId));
    await call("queueReorder", { botId: "mico", expected: current, order: [...current].reverse() });
    assert.equal((await system.run.findUniqueOrThrow({ where: { id: held.id } })).status, "waiting_takeover");
    assert.equal(await system.event.count({ where: { threadId: main, type: "computer.takeover.released" } }), 0);
    assert.equal((await queuedRow(duringTakeover.messageId))?.runId, held.id);
    await system.run.update({ where: { id: held.id }, data: { status: "cancelled", completedAt: new Date() } });
    await system.steeringMessage.deleteMany({ where: { messageId: duringTakeover.messageId } });
    checks.push("queueing, Steer now and reorder during a human takeover leave the takeover in place; the steered message waits for the turn to resume");

    // 9. Move to a new conversation: one transaction, titled by S1 rules, refused once started.
    const r4 = await liveRun(main);
    const move = await queue("  \n Plan the Lisbon trip \n with the hotel list");
    const moved = await call("queueMove", { botId: "mico", messageId: move.messageId });
    const conversation = await system.thread.findUniqueOrThrow({ where: { id: moved.threadId } });
    assert.deepEqual([conversation.taskBotId, conversation.projectKey, conversation.startedBy, conversation.title, conversation.titleSource],
      ["mico", "mico:mico", "user", "Plan the Lisbon trip", "auto"]);
    assert.equal(moved.title, "Plan the Lisbon trip");
    const movedMessages = await system.message.findMany({ where: { threadId: moved.threadId } });
    assert.equal(movedMessages.length, 1);
    assert.equal(movedMessages[0]!.role, "user");
    const movedRun = await system.run.findUniqueOrThrow({ where: { id: moved.runId } });
    assert.deepEqual([movedRun.threadId, movedRun.trigger, movedRun.status, movedRun.sourceMessageId], [moved.threadId, "user", "queued", movedMessages[0]!.id]);
    assert.equal(await system.message.count({ where: { id: move.messageId } }), 0);
    await assert.rejects(call("queueMove", { botId: "mico", messageId: move.messageId }), conflict("gone"));
    assert.equal(await system.thread.count({ where: { taskBotId: "mico", startedBy: "user", taskKey: { startsWith: "mico-task:mico:queue:" } } }), 1);
    assert.ok(enqueued.some((payload) => payload.includes(moved.runId)));
    // A failure inside the move leaves everything where it was.
    const stuck = await queue("No se mueve");
    await system.thread.create({ data: { spaceId: "space", userId: "owner", taskBotId: "mico", projectKey: "mico:mico", taskKey: `mico-task:mico:queue:${stuck.messageId}` } });
    const threadsBefore = await system.thread.count();
    await assert.rejects(call("queueMove", { botId: "mico", messageId: stuck.messageId }));
    assert.equal(await system.thread.count(), threadsBefore);
    assert.equal((await queuedRow(stuck.messageId))?.runId, null);
    assert.equal(await system.message.count({ where: { id: stuck.messageId } }), 1);
    await endRun(r4.id);
    checks.push("Move to a new conversation opens a person-started side conversation titled from the first line, starts the message there and removes it here in one transaction; a started or failed move changes nothing");

    // 10. A usage-limit failure holds the queue until the person sends one now.
    const r5 = await liveRun(main);
    const attempt = await system.attempt.create({ data: { runId: r5.id, fence: 1, status: "running" } });
    await system.steeringMessage.deleteMany({ where: { message: { threadId: main } } });
    const waiting = [await queue("Primero"), await queue("Segundo")];
    await runAsTenant(actor, () => finalizeRun(prisma, { spaceId: "space", threadId: main, botId: "mico", runId: r5.id, taskId: r5.taskId,
      attemptId: attempt.id, leaseOwner: "worker", leaseFence: 1, outcome: "failed", error: HOSTED_MODEL_CREDITS_REQUIRED_ERROR }));
    assert.equal(await system.run.count({ where: { threadId: main, status: "queued" } }), 0);
    assert.equal((await state()).waiting, "usage");
    const resumed = await call("queueSendNow", { botId: "mico", messageId: waiting[1]!.messageId });
    assert.equal((await system.run.findUniqueOrThrow({ where: { id: resumed.runId } })).sourceMessageId, waiting[1]!.messageId);
    await endRun(resumed.runId);
    checks.push("a turn that fails on a usage limit leaves the queue waiting with its reason instead of spending it; Send now starts the chosen message");

    // 11. The main chat has its own lane; side conversations wait for a free slot.
    const pi = await system.bot.create({ data: { id: "pi-mico", spaceId: "space", userId: "owner", name: "Pi Mico", color: "#10B981",
      agentEngine: "pi", taskConcurrency: 1, thread: { create: { spaceId: "space", userId: "owner" } } }, include: { thread: true } });
    const side = (key: string) => system.thread.create({ data: { spaceId: "space", userId: "owner", taskBotId: "pi-mico", projectKey: "mico:pi-mico", taskKey: `mico-task:pi-mico:${key}` } });
    const [sideA, sideB] = [await side("a"), await side("b")];
    await system.run.update({ where: { id: (await liveRun(sideA.id, "pi-mico")).id }, data: { status: "leased" } });
    const queuedRun = async (threadId: string, botId: string) => {
      const task = await system.task.create({ data: { spaceId: "space", botId, threadId, userId: "owner", prompt: "Synthetic", status: "queued" } });
      return system.run.create({ data: { spaceId: "space", botId, threadId, taskId: task.id, userId: "owner", status: "queued", trigger: "user" } });
    };
    const admit = (run: { id: string; botId: string; threadId: string }) => runAsTenant(actor, () => claimMicoRun(prisma, { ...run, spaceId: "space", userId: "owner" },
      { status: "queued" }, { status: "leased", leaseOwner: "worker-2", leaseFence: 1, leaseExpiresAt: new Date(Date.now() + 60_000) }));
    const waitingSide = await queuedRun(sideB.id, "pi-mico");
    assert.equal((await admit(waitingSide)).count, 0);
    await system.message.create({ data: { threadId: sideB.id, seq: 1, role: "user", blocks: [{ kind: "text", text: "Espera" }] } }).then((message) =>
      system.steeringMessage.create({ data: { messageId: message.id, botId: "pi-mico", userId: "owner", originTrigger: "queued_user", position: 1 } }));
    const sideState = await state({ botId: "pi-mico", taskThreadId: sideB.id });
    assert.deepEqual([sideState.waiting, sideState.slots], ["slot", { running: 1, limit: 1 }]);
    const mainTurn = await queuedRun(pi.thread!.id, "pi-mico");
    assert.equal((await admit(mainTurn)).count, 1);
    const secondMain = await queuedRun(pi.thread!.id, "pi-mico");
    assert.equal((await admit(secondMain)).count, 0);
    const native = await system.bot.create({ data: { id: "native-mico", spaceId: "space", userId: "owner", name: "Native", color: "#10B981",
      agentEngine: "claude", taskConcurrency: 4, thread: { create: { spaceId: "space", userId: "owner" } } }, include: { thread: true } });
    const nativeSide = await system.thread.create({ data: { spaceId: "space", userId: "owner", taskBotId: "native-mico", projectKey: "mico:native-mico", taskKey: "mico-task:native-mico:a" } });
    await system.run.update({ where: { id: (await liveRun(nativeSide.id, "native-mico")).id }, data: { status: "leased" } });
    assert.equal((await admit(await queuedRun(native.thread!.id, "native-mico"))).count, 0);
    checks.push("a Pi Mico's main chat never waits behind its side conversations (one turn at a time there), side conversations past the limit wait for a free slot, and native engines stay one turn in total");

    // 12. An unsaved edit is sealed with the Space key like message content.
    const masterKey = { id: "synthetic-queue", key: randomBytes(32) };
    const sealed = createDb(url, { encryptContent: true, keyProvider: new LocalKeyProvider([masterKey]), applicationName: "synthetic-message-queue-sealed" });
    clients.push(sealed);
    const sealedThreads = threadsRoutes({ deps: { ...deps, prisma: sealed.prisma, events: createThreadEvents(sealed.prisma) }, authed: anyRoute, callsEnabled: anyRoute } as never)
      .threads as unknown as Record<string, (v: unknown) => Promise<any>>;
    const sealedCall = (name: string, input: object) => runAsTenant(actor, () => sealedThreads[name]!({ context: { actor }, input }));
    const r6 = await liveRun(main);
    const secret = await sealedCall("send", { botId: "mico", text: "Factura privada", clientNonce: randomUUID(), delivery: "queue" });
    const sealedHold = randomUUID();
    await sealedCall("queueEdit", { botId: "mico", messageId: secret.messageId, holdId: sealedHold });
    await sealedCall("queueEditDraft", { botId: "mico", messageId: secret.messageId, holdId: sealedHold, draft: "Factura privada de marzo" });
    const stored = await rows<{ editDraft: string }>(`SELECT "editDraft" FROM steering_messages WHERE "messageId"=$1`, [secret.messageId]);
    assert.ok(stored[0]?.editDraft && !stored[0].editDraft.includes("marzo"));
    const shown = (await sealedCall("queueState", { botId: "mico" })).messages.find((row: any) => row.messageId === secret.messageId);
    assert.equal(shown.editing.draft, "Factura privada de marzo");
    await sealedCall("queueEditSave", { botId: "mico", messageId: secret.messageId, holdId: sealedHold, text: "Factura de marzo" });
    assert.equal((await sealedCall("queueState", { botId: "mico" })).messages.find((row: any) => row.messageId === secret.messageId).text, "Factura de marzo");
    await endRun(r6.id);
    checks.push("an edit draft is stored sealed with the Space key and reads back as text; the saved edit replaces the sealed message");
    // 13. Moving a queued message to a new conversation seals its first message inside the
    // same transaction, which needs the new conversation's Space before it commits.
    const r7 = await liveRun(main);
    const privateMove = await sealedCall("send", { botId: "mico", text: "Borrador privado aparte", clientNonce: randomUUID(), delivery: "queue" });
    const sealedMove = await sealedCall("queueMove", { botId: "mico", messageId: privateMove.messageId });
    const [movedRow] = await rows<{ blocks: unknown }>('SELECT blocks FROM messages WHERE "threadId" = $1', [sealedMove.threadId]);
    assert.ok(movedRow && !JSON.stringify(movedRow.blocks).includes("Borrador privado aparte"));
    const movedOpened = await runAsTenant(actor, () => sealed.prisma.message.findFirstOrThrow({ where: { threadId: sealedMove.threadId } }));
    assert.ok(JSON.stringify(movedOpened.blocks).includes("Borrador privado aparte"));
    await endRun(r7.id);
    checks.push("a queued message moved to a new conversation is sealed with the Space key in the same transaction and reads back as text");
  } finally {
    sql.release();
  }
  const result = { passed: true, checks, productionAccess: false, modelsCalled: false, directory };
  await writeFile(path.join(directory, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  for (const db of clients.reverse()) { await db.prisma.$disconnect().catch(() => undefined); await db.pool.end().catch(() => undefined); }
  await postgres.stop();
}
