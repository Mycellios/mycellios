import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdtemp, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import EmbeddedPostgres from "embedded-postgres";
import { asSystem, createDb, LocalKeyProvider, runAsTenant } from "@rakazo/db";
import type { Actor } from "@rakazo/contracts";
import { applyMicoBusyMode, micoSettingsState, updateMicoSettings } from "../apps/api/src/mico-settings.js";
import { requestAgentNewChat, finishAgentNewChat } from "../packages/adapters/src/agent-new-chat.js";
process.env.RAKAZO_PROJECT_LOCAL = "1";
const socket = createServer();
await new Promise<void>(resolve => socket.listen(0, "127.0.0.1", resolve));
const port = (socket.address() as { port: number }).port;
await new Promise<void>(resolve => socket.close(() => resolve()));
const directory = await mkdtemp(path.join(tmpdir(), "mycellios-mico-settings-")), password = randomBytes(24).toString("hex");
// The container-only postgres OS user must be able to traverse this synthetic parent.
if (process.platform === "linux" && process.getuid?.() === 0 && existsSync("/.dockerenv")) await chmod(directory, 0o755);
const database = new EmbeddedPostgres({ databaseDir: path.join(directory, "pg"), port, user: "postgres", password,
  createPostgresUser: process.platform === "linux" && process.getuid?.() === 0 && existsSync("/.dockerenv"),
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
    await sql.query('ALTER TABLE "user" DROP COLUMN "micoDefaults", DROP COLUMN "micoSettingsVersion"; ALTER TABLE bots DROP COLUMN "micoPreferences"; ALTER TABLE threads DROP COLUMN "agentContextReset"');
    await sql.query(await readFile("packages/db/prisma/migrations/20261112180000_mico_preferences/migration.sql", "utf8"));
  } finally { await sql.end(); }
  checks.push("actual additive migration applied on real PostgreSQL");
  db = createDb(url, { encryptContent: true, keyProvider: new LocalKeyProvider([{ id: "synthetic", key: randomBytes(32) }]) });
  const prisma = db.prisma, system = asSystem(prisma, "synthetic Mico policy qualification");
  const org = randomUUID(), space = randomUUID(), otherSpace = randomUUID(), user = randomUUID(), foreign = randomUUID();
  await system.organization.create({ data: { id: org, name: "Synthetic", slug: org, createdAt: new Date() } });
  for (const id of [space, otherSpace]) await system.space.create({ data: { id, organizationId: org, name: "Synthetic" } });
  for (const id of [user, foreign]) {
    await system.user.create({ data: { id, name: "Synthetic", email: `${id}@example.invalid` } });
    await system.member.create({ data: { id: randomUUID(), organizationId: org, userId: id, role: "member", createdAt: new Date() } });
    for (const spaceId of [space, otherSpace]) await system.spaceMember.create({ data: { id: randomUUID(), organizationId: org, spaceId, userId: id, createdAt: new Date() } });
  }
  const actor: Actor = { userId: user, spaceId: space, email: `${user}@example.invalid`, isDeploymentOwner: false };
  const own = () => runAsTenant(actor, async () => {
    const revision = (await micoSettingsState(prisma, actor)).revision; return revision;
  });
  const bots = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  for (const [index, id] of bots.entries()) await system.bot.create({ data: { id, spaceId: index === 3 ? otherSpace : space, userId: index === 2 ? foreign : user,
    name: `Synthetic ${index}`, color: "green", instructions: "Preserve these instructions", thread: { create: { spaceId: index === 3 ? otherSpace : space, userId: index === 2 ? foreign : user } } } });
  await runAsTenant(actor, async () => {
    let state = await micoSettingsState(prisma, actor); assert.equal(state.bots.length, 2);
    state = await updateMicoSettings(prisma, actor, { kind: "defaults", revision: state.revision, patch: { showPlan: true } });
    await assert.rejects(updateMicoSettings(prisma, actor, { kind: "defaults", revision: 0, patch: { showPlan: false } }));
    await assert.rejects(updateMicoSettings(prisma, actor, { kind: "bot", revision: state.revision, botId: bots[2]!, key: "localScripts", value: true }));
    assert.equal((await micoSettingsState(prisma, actor)).revision, state.revision);
    state = await updateMicoSettings(prisma, actor, { kind: "all", revision: state.revision, key: "showPlan", value: false });
    assert(state.bots.every(bot => bot.preferences.showPlan === false));
    state = await updateMicoSettings(prisma, actor, { kind: "all", revision: state.revision, key: "showPlan", value: null });
    assert(state.bots.every(bot => !Object.hasOwn(bot.preferences, "showPlan"))); assert.equal(state.defaults.showPlan, true);
    const concurrent = await Promise.allSettled([true, false].map(value => updateMicoSettings(prisma, actor, { kind: "bot", botId: bots[0]!, revision: state.revision, key: "localScripts", value })));
    assert.equal(concurrent.filter(result => result.status === "fulfilled").length, 1);
    await applyMicoBusyMode(prisma, actor, "steer", async () => {});
  });
  for (const index of [2, 3]) { const bot = await system.bot.findUniqueOrThrow({ where: { id: bots[index]! } }); assert.deepEqual(bot.micoPreferences, {}); assert.equal(bot.busyMessageMode, null); }
  for (const id of bots) assert.equal((await system.bot.findUniqueOrThrow({ where: { id } })).instructions, "Preserve these instructions");
  checks.push("inheritance, CAS rollback/concurrent writes, bulk updates and account/Space isolation preserve other profiles");
  const bot = await system.bot.findUniqueOrThrow({ where: { id: bots[0]! }, include: { thread: true } });
  const threadId = bot.thread!.id, target = { ...actor, botId: bot.id, threadId }, runId = randomUUID();
  await system.message.create({ data: { threadId, botId: bot.id, role: "user", seq: 0, blocks: [{ kind: "text", text: "Preserved synthetic history" }] } });
  await system.thread.update({ where: { id: threadId }, data: { nextMessageSeq: 40 } });
  const task = await system.task.create({ data: { userId: user, spaceId: space, botId: bot.id, threadId, prompt: "Synthetic", status: "running" } });
  await system.run.create({ data: { id: runId, userId: user, spaceId: space, botId: bot.id, threadId, taskId: task.id, status: "running", trigger: "user", leaseOwner: "test", leaseFence: 1, checkpoint: "old checkpoint" } });
  const notes = { notes: "Synthetic saved notes: preserve constraints and history, no external effects or secrets." };
  await runAsTenant(actor, async () => {
    await assert.rejects(requestAgentNewChat(prisma, target, { runId, owner: "test", fence: 1 }, notes));
    await updateMicoSettings(prisma, actor, { kind: "bot", revision: await own(), botId: bot.id, key: "agentNewChat", value: true });
    await assert.rejects(requestAgentNewChat(prisma, target, { runId, owner: "test", fence: 0 }, notes));
    await requestAgentNewChat(prisma, target, { runId, owner: "test", fence: 1 }, notes);
    const raw = await db!.pool.query('SELECT "agentContextReset" FROM threads WHERE id=$1', [threadId]);
    assert(!JSON.stringify(raw.rows).includes(notes.notes));
    assert.equal(await finishAgentNewChat(prisma, target), null); // still running
    assert.equal((await prisma.thread.findUniqueOrThrow({ where: { id: threadId } })).contextStartSeq, 0);
    await prisma.run.update({ where: { id: runId }, data: { status: "completed" } });
    const follow = await prisma.run.create({ data: { userId: user, spaceId: space, botId: bot.id, threadId, taskId: task.id, status: "queued", trigger: "user" } });
    assert.equal(await finishAgentNewChat(prisma, target), null); // queued work wins
    await prisma.run.update({ where: { id: follow.id }, data: { status: "cancelled" } });
    const reset = await finishAgentNewChat(prisma, target); assert.notEqual(reset?.eventSeq, null);
    const current = await prisma.thread.findUniqueOrThrow({ where: { id: threadId } });
    assert.equal(current.contextStartSeq, 41); assert.equal(current.nextMessageSeq, 42); assert.equal(current.agentContextReset, null);
    assert.equal((await prisma.run.findUniqueOrThrow({ where: { id: runId } })).checkpoint, null);
    assert.equal(await finishAgentNewChat(prisma, target), null);
    const messages = await prisma.message.findMany({ where: { threadId }, orderBy: { seq: "asc" } });
    assert.equal(messages.length, 3); assert(JSON.stringify(messages[0]!.blocks).includes("Preserved synthetic history")); assert(JSON.stringify(messages[2]!.blocks).includes(notes.notes));
  });
  checks.push("encrypted handoff, denied policy/stale lease, live/queued guards, notes-first idle reset, checkpoint invalidation and idempotence");
  console.log(JSON.stringify({ ok: true, checks, externalModelCalls: 0, productionTouched: false }));
} finally {
  await db?.prisma.$disconnect(); await db?.pool.end(); await database.stop().catch(() => undefined);
}
