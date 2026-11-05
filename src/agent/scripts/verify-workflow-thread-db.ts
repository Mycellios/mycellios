import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import EmbeddedPostgres from "embedded-postgres";
import { createDb, asSystem, isOwnedWorkflowThread } from "@rakazo/db";

// Fresh synthetic loopback database only; never load existing accounts or .env.
process.env.RAKAZO_PROJECT_LOCAL = "1";
process.env.CONTENT_ENCRYPTION = "off";
const listener = createServer();
await new Promise<void>(resolve => listener.listen(0, "127.0.0.1", resolve));
const port = (listener.address() as { port: number }).port;
await new Promise<void>(resolve => listener.close(() => resolve()));
const directory = await mkdtemp(path.join(tmpdir(), "mycellios-workflow-thread-"));
const password = randomBytes(24).toString("hex");
const postgres = new EmbeddedPostgres({ databaseDir: path.join(directory, "pg"), port, user: "postgres", password, persistent: true, autoRehydrateSymlinks: true, onLog: () => {}, onError: () => {} });
let db: ReturnType<typeof createDb> | undefined;
try {
  await postgres.initialise(); await postgres.start();
  const url = `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`;
  await promisify(execFile)(process.execPath, [path.resolve("node_modules/prisma/build/index.js"), "db", "push", "--config", "packages/db/prisma.config.ts"], { windowsHide: true, env: { ...process.env, DATABASE_URL: url, DATABASE_MIGRATION_URL: url }, maxBuffer: 1024 * 1024 });
  db = createDb(url, { encryptContent: false, applicationName: "synthetic-workflow-thread-regression" });
  const prisma = asSystem(db.prisma, "isolated workflow thread regression");
  const suffix = randomUUID();
  const scope = { userId: `user-${suffix}`, spaceId: `space-${suffix}` };
  await prisma.user.create({ data: { id: scope.userId, name: "Synthetic", email: `${suffix}@example.invalid` } });
  await prisma.organization.create({ data: { id: suffix, name: "Synthetic", slug: suffix, createdAt: new Date() } });
  await prisma.space.create({ data: { id: scope.spaceId, organizationId: suffix, name: "Synthetic" } });
  const bot = await prisma.bot.create({ data: { ...scope, name: "Synthetic", color: "green" } });
  const flow = await prisma.workflow.create({ data: { ...scope, id: randomUUID(), name: "Synthetic", graph: {} } });
  const execution = await prisma.workflowExecution.create({ data: { ...scope, id: randomUUID(), workflowId: flow.id, version: 1, graph: {}, triggerId: "start", clientNonce: randomUUID() } });
  const taskKey = `workflow:${execution.id}:mico`;
  const thread = await prisma.thread.create({ data: { ...scope, taskBotId: bot.id, taskKey, projectKey: `workflow:${flow.id}` } });
  const task = await prisma.task.create({ data: { ...scope, botId: bot.id, threadId: thread.id, prompt: "Synthetic", status: "running" } });
  const run = await prisma.run.create({ data: { ...scope, botId: bot.id, threadId: thread.id, taskId: task.id, status: "queued", trigger: "workflow", clientNonce: taskKey } });
  assert.equal(await isOwnedWorkflowThread(prisma, run, thread), true);
  assert.equal(await isOwnedWorkflowThread(prisma, { ...run, userId: "another-user" }, thread), false);
  assert.equal(await isOwnedWorkflowThread(prisma, { ...run, spaceId: "another-space" }, thread), false);
  assert.equal(await isOwnedWorkflowThread(prisma, run, { ...thread, id: "another-thread" }), false);
  assert.equal(await isOwnedWorkflowThread(prisma, run, { ...thread, taskBotId: "another-bot" }), false);
  assert.equal(await isOwnedWorkflowThread(prisma, run, { ...thread, taskKey: `workflow:${execution.id}:another-step` }), false);
  console.log(JSON.stringify({ passed: true, checks: 6, fullRunActor: true, existingAccounts: false, modelsCalled: false }));
} finally {
  try {
    await db?.prisma.$disconnect();
    await db?.pool.end();
  } finally {
    await postgres.stop();
  }
}
