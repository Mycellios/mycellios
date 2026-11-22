import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import EmbeddedPostgres from "embedded-postgres";

// Conversations a Mico opens itself (start_task / message_task / close_task) and their
// reports, against a fresh disposable loopback PostgreSQL cluster. Synthetic rows only:
// no production data, accounts, credentials or models; never point it at another database.
process.env.NODE_ENV = "test";
process.env.CONTENT_ENCRYPTION = "off";
const {
  createDb, asSystem, startAgentTask, messageAgentTask, stopAgentTaskRuns, queueTaskReportInTransaction,
  pendingTeammateRequest, agentTasksStartedByRun, finalizeRun, archiveSideThreadInTransaction, readHistoryPage,
  isOwnedAgentTask, expireStuckRun, AgentTaskError, countUnfinishedAgentTasks,
} = await import("@mycellios/db");
const { taskThreadKind, AGENT_TASK_UNFINISHED_LIMIT, TASK_REPORT_CUT_MARKER } = await import("@mycellios/core");
const { stopThreadRuns } = await import("../apps/api/src/thread-target.js");

const socket = createServer();
await new Promise<void>((resolve) => socket.listen(0, "127.0.0.1", resolve));
const port = (socket.address() as { port: number }).port;
await new Promise<void>((resolve) => socket.close(() => resolve()));
const directory = await mkdtemp(path.join(tmpdir(), "mycellios-agent-tasks-"));
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
  db = createDb(url, { encryptContent: false, applicationName: "synthetic-agent-tasks" });
  const prisma = asSystem(db.prisma, "isolated synthetic agent task acceptance");
  const scope = { spaceId: "space", userId: "owner" };
  await prisma.user.create({ data: { id: scope.userId, name: "Synthetic owner", email: "owner@example.invalid" } });
  await prisma.organization.create({ data: { id: "org", name: "Synthetic", slug: "agent-tasks", createdAt: new Date() } });
  await prisma.space.create({ data: { id: scope.spaceId, organizationId: "org", name: "Synthetic" } });
  const mico = await prisma.bot.create({ data: { ...scope, id: "mico", name: "Mico", color: "green", thread: { create: { ...scope } } }, include: { thread: true } });
  const scout = await prisma.bot.create({ data: { ...scope, id: "scout", name: "Scout", color: "blue", thread: { create: { ...scope } } }, include: { thread: true } });
  const other = await prisma.bot.create({ data: { ...scope, id: "other", name: "Other", color: "red", thread: { create: { ...scope } } }, include: { thread: true } });
  const main = mico.thread!.id;
  const lease = { leaseOwner: "synthetic-worker", leaseFence: 1 };
  const running = async (threadId: string, botId: string, trigger: string, sourceMessageId?: string) => {
    const task = await prisma.task.create({ data: { ...scope, botId, threadId, prompt: "Synthetic", status: "running" } });
    return prisma.run.create({ data: { ...scope, botId, threadId, taskId: task.id, status: "running", trigger, ...lease,
      leaseExpiresAt: new Date(Date.now() + 60_000), startedAt: new Date(), sourceMessageId } });
  };
  const sourceOf = (run: { id: string; threadId: string; botId: string }) => ({ ...scope, ...lease, id: run.id, botId: run.botId, threadId: run.threadId });
  const firstRun = async (threadId: string) => prisma.run.findFirstOrThrow({ where: { threadId, trigger: "agent_task" }, orderBy: { createdAt: "asc" } });
  // A queued task turn as a worker would claim it, then end it through the real finalizeRun.
  const claim = async (run: { id: string }) => {
    await prisma.run.update({ where: { id: run.id }, data: { status: "running", ...lease, leaseExpiresAt: new Date(Date.now() + 60_000), startedAt: new Date() } });
    return prisma.attempt.create({ data: { runId: run.id, fence: 1, status: "running" } });
  };
  const end = async (run: { id: string; threadId: string; taskId: string; botId: string }, outcome:
    { outcome: "completed"; blocks: unknown[] } | { outcome: "failed"; error: string }) => {
    const attempt = await prisma.attempt.findFirst({ where: { runId: run.id, status: "running" } }) ?? await claim(run);
    return finalizeRun(prisma, { ...scope, threadId: run.threadId, botId: run.botId, runId: run.id, taskId: run.taskId,
      attemptId: attempt.id, ...lease, ...outcome } as Parameters<typeof finalizeRun>[1]);
  };
  const reports = (threadId: string) => prisma.message.findMany({ where: { threadId: main, clientNonce: { startsWith: `task-report:${threadId}:` } } });

  // 1. start_task: one conversation per tool call, even when the call is replayed concurrently.
  const mainRun = await running(main, mico.id, "user");
  const source = sourceOf(mainRun);
  const [first, again] = await Promise.all([
    startAgentTask(prisma, source, { key: "call-1", title: "Forum thread", brief: "Draft the forum thread", botName: "Mico" }),
    startAgentTask(prisma, source, { key: "call-1", title: "Forum thread", brief: "Draft the forum thread", botName: "Mico" }),
  ]);
  assert.equal(first.taskId, again.taskId);
  assert.equal([first, again].filter((result) => result.replayed).length, 1);
  const taskA = await prisma.thread.findUniqueOrThrow({ where: { id: first.taskId } });
  assert.deepEqual([taskA.startedBy, taskA.titleSource, taskA.taskBotId, taskA.startedByRunId, taskA.title],
    ["agent", "agent", mico.id, mainRun.id, "Forum thread"]);
  assert.equal(taskThreadKind(taskA), "conversation");
  const brief = await prisma.message.findFirstOrThrow({ where: { threadId: taskA.id } });
  assert.equal(brief.role, "user");
  assert.equal((brief.blocks as Array<{ kind: string }>)[0]?.kind, "task_brief");
  const runA = await firstRun(taskA.id);
  assert.deepEqual([runA.status, runA.trigger, runA.sourceMessageId], ["queued", "agent_task", brief.id]);
  checks.push("start_task opens one agent-started conversation per tool call with the brief first and a queued agent_task turn");

  // 2. At most eight unfinished tasks; a ninth fails at once, also under concurrent calls.
  const tasks = [taskA.id];
  for (let index = 2; index <= AGENT_TASK_UNFINISHED_LIMIT; index++)
    tasks.push((await startAgentTask(prisma, source, { key: `call-${index}`, title: `Task ${index}`, brief: `Work ${index}`, botName: "Mico" })).taskId);
  assert.equal(await countUnfinishedAgentTasks(prisma, { ...scope, botId: mico.id }), 8);
  const ninth = await Promise.allSettled([9, 10].map((index) =>
    startAgentTask(prisma, source, { key: `call-${index}`, title: `Task ${index}`, brief: "More", botName: "Mico" })));
  for (const result of ninth) {
    assert.equal(result.status, "rejected");
    assert.ok((result as PromiseRejectedResult).reason instanceof AgentTaskError);
    assert.equal(((result as PromiseRejectedResult).reason as InstanceType<typeof AgentTaskError>).code, "limit");
  }
  assert.equal(await prisma.thread.count({ where: { taskBotId: mico.id, startedBy: "agent" } }), 8);
  checks.push("a ninth unfinished task is refused immediately, without queueing or archiving anything");

  // 3. A finished turn reports once into the main chat: cut text, copied chart, its own main-chat turn.
  const chart = { kind: "chart", name: "Replies", spec: { marks: [] }, data: [{ day: 1, replies: 3 }] };
  const finished = await end(runA, { outcome: "completed", blocks: [{ kind: "text", text: "r".repeat(7_000) }, chart] });
  assert.ok(finished?.taskReport);
  const [reportA] = await reports(taskA.id);
  assert.ok(reportA);
  const [reportBlock, copied] = reportA.blocks as Array<Record<string, unknown>>;
  assert.equal(reportBlock?.kind, "task_report");
  assert.equal(reportBlock?.taskId, taskA.id);
  assert.equal(reportBlock?.truncated, true);
  assert.equal(Array.from(String(reportBlock?.text)).length, 6_000);
  assert.ok(String(reportBlock?.text).endsWith(TASK_REPORT_CUT_MARKER));
  assert.equal(copied?.kind, "chart");
  const reportRun = await prisma.run.findUniqueOrThrow({ where: { id: finished.taskReport.runId }, include: { task: true } });
  assert.deepEqual([reportRun.threadId, reportRun.trigger, reportRun.status, reportRun.clientNonce, reportRun.sourceMessageId],
    [main, "task_report", "queued", `task-report:${taskA.id}:${runA.id}`, reportA.id]);
  assert.match(reportRun.task.prompt, /Still running: .*\(taskId /);
  assert.match(reportRun.task.prompt, /read_history with taskId/);
  assert.equal(await prisma.$transaction((tx) => queueTaskReportInTransaction(tx, { threadId: taskA.id, runIds: [runA.id], outcome: "completed" })), null);
  assert.equal((await reports(taskA.id)).length, 1);
  checks.push("a finished task turn reports once in the same commit: cut to 6,000 characters with the marker, charts copied, a queued task_report turn");

  // 4. No report for a silent turn, a turn the person started there, or a turn parked on delegated work.
  const [, taskB, taskC, taskD, taskE, taskF, taskG, taskH] = tasks as [string, string, string, string, string, string, string, string];
  await end(await firstRun(taskB), { outcome: "completed", blocks: [] });
  assert.equal((await reports(taskB)).length, 0);
  await end(await firstRun(taskC), { outcome: "completed", blocks: [{ kind: "text", text: "Done C" }] });
  const personTurn = await running(taskC, mico.id, "follow_up");
  await end(personTurn, { outcome: "completed", blocks: [{ kind: "text", text: "Answering the person" }] });
  assert.equal((await reports(taskC)).length, 1);
  const parked = await firstRun(taskD);
  await prisma.task.update({ where: { id: parked.taskId }, data: { delegationState: "waiting" } });
  await end(parked, { outcome: "completed", blocks: [{ kind: "text", text: "Delegated, waiting" }] });
  assert.equal((await reports(taskD)).length, 0);
  await end(await firstRun(taskE), { outcome: "failed", error: "e".repeat(800) });
  const [failure] = await reports(taskE);
  assert.ok(failure);
  const failureBlock = (failure.blocks as Array<Record<string, unknown>>)[0];
  assert.deepEqual([failureBlock?.outcome, Array.from(String(failureBlock?.text)).length], ["failed", 500]);
  checks.push("silent turns, turns the person started in the task and turns parked on delegated work send no report; a failure reports its bounded error");

  // 5. A stop by the person reports, and the Mico is told not to start it again.
  const stopTarget = { kind: "bot" as const, botId: mico.id, threadId: taskF, bot: {} as never };
  const enqueued: string[] = [];
  await stopThreadRuns({ prisma, sandbox: {} as never, events: { notify: async () => undefined } as never,
    jobs: { enqueue: async (job: { payload?: unknown }) => { enqueued.push(JSON.stringify(job.payload)); } } },
  { ...scope, email: "owner@example.invalid", isDeploymentOwner: false }, stopTarget);
  const [stopped] = await reports(taskF);
  assert.ok(stopped);
  const stoppedBlock = (stopped.blocks as Array<Record<string, unknown>>)[0];
  assert.deepEqual([stoppedBlock?.outcome, stoppedBlock?.text], ["stopped", "Task 6"]);
  const stoppedRun = await prisma.run.findFirstOrThrow({ where: { sourceMessageId: stopped.id }, include: { task: true } });
  assert.match(stoppedRun.task.prompt, /the person stopped it\. Do not start it again unless they ask you to\./);
  assert.ok(enqueued.some((payload) => payload.includes(stoppedRun.id)));
  checks.push("a stop by the person reports the title as stopped and starts the report turn");

  // 6. message_task: queued after the current turn, sent at once when idle, reopening an archive.
  const queuedMessage = await messageAgentTask(prisma, source, { key: "msg-1", taskId: taskG, text: "Also follow the replies", botName: "Mico" });
  const replay = await messageAgentTask(prisma, source, { key: "msg-1", taskId: taskG, text: "Also follow the replies", botName: "Mico" });
  assert.deepEqual([queuedMessage.state, queuedMessage.runId, replay.replayed], ["queued after the current turn", null, true]);
  assert.equal(await prisma.steeringMessage.count({ where: { originTrigger: "agent_task", message: { threadId: taskG } } }), 1);
  const turnG = await firstRun(taskG);
  const endedG = await end(turnG, { outcome: "completed", blocks: [{ kind: "text", text: "Draft G" }] });
  assert.ok(endedG?.continuationRunId);
  const continuation = await prisma.run.findUniqueOrThrow({ where: { id: endedG.continuationRunId }, include: { task: true } });
  assert.equal(continuation.trigger, "agent_task");
  assert.match(continuation.task.prompt, /<task_message>\nAlso follow the replies\n<\/task_message>/);
  await prisma.$transaction((tx) => archiveSideThreadInTransaction(tx, scope, { botId: mico.id, threadId: taskA.id }));
  const sent = await messageAgentTask(prisma, source, { key: "msg-2", taskId: taskA.id, text: "Shorten it", botName: "Mico" });
  assert.equal(sent.state, "sent");
  assert.ok(sent.runId);
  assert.equal((await prisma.thread.findUniqueOrThrow({ where: { id: taskA.id } })).archivedAt, null);
  const userThread = await prisma.thread.create({ data: { ...scope, taskBotId: mico.id, projectKey: `mico:${mico.id}`, taskKey: `mico-task:${mico.id}:person`, startedBy: "user" } });
  const othersTask = await startAgentTask(prisma, sourceOf(await running(other.thread!.id, other.id, "user")),
    { key: "other-call", title: "Other's task", brief: "x", botName: "Other" });
  for (const taskId of [userThread.id, othersTask.taskId])
    await assert.rejects(messageAgentTask(prisma, source, { key: `nope-${taskId}`, taskId, text: "hi", botName: "Mico" }),
      (error: unknown) => error instanceof AgentTaskError && error.code === "not_available");
  checks.push("message_task queues after the current turn as its own agent_task continuation, sends at once to an idle task, reopens an archive and refuses other conversations");

  // 7. An idle task cannot be woken while eight others are unfinished.
  const unfinished = await countUnfinishedAgentTasks(prisma, { ...scope, botId: mico.id });
  for (let index = unfinished; index < AGENT_TASK_UNFINISHED_LIMIT; index++)
    await startAgentTask(prisma, source, { key: `fill-${index}`, title: `Fill ${index}`, brief: "x", botName: "Mico" });
  await assert.rejects(messageAgentTask(prisma, source, { key: "msg-3", taskId: taskB, text: "wake", botName: "Mico" }),
    (error: unknown) => error instanceof AgentTaskError && error.code === "limit");
  checks.push("message_task refuses to wake an idle task while eight are unfinished");

  // 8. close_task's stop half: queue dropped, runs cancelled with a durable teardown receipt, no report.
  await messageAgentTask(prisma, source, { key: "msg-h", taskId: taskH, text: "queued", botName: "Mico" });
  const closed = await stopAgentTaskRuns(prisma, { ...scope, botId: mico.id }, taskH);
  assert.equal(closed.runIds.length, 1);
  assert.equal(closed.startedByRunId, mainRun.id);
  assert.equal(await prisma.steeringMessage.count({ where: { message: { threadId: taskH } } }), 0);
  assert.equal((await prisma.run.findUniqueOrThrow({ where: { id: closed.runIds[0]! } })).status, "cancelled");
  assert.equal((await prisma.task.findUniqueOrThrow({ where: { id: closed.teardownTaskIds[0]! } })).workStopPending, true);
  assert.equal((await prisma.thread.findUniqueOrThrow({ where: { id: taskH } })).outcome, "interrupted");
  await prisma.$transaction((tx) => archiveSideThreadInTransaction(tx, scope, { botId: mico.id, threadId: taskH }));
  assert.equal((await reports(taskH)).length, 0);
  await assert.rejects(stopAgentTaskRuns(prisma, { ...scope, botId: mico.id }, userThread.id),
    (error: unknown) => error instanceof AgentTaskError && error.code === "not_available");
  checks.push("close_task drops the queue, cancels runs with a durable teardown receipt and archives without a report; other threads are not available");

  // 9. A teammate's request: the task reports even a turn the person started, and names the teammate.
  const request = await prisma.message.create({ data: { threadId: main, seq: 900, role: "user",
    blocks: [{ kind: "bot_message_received", fromBotId: scout.id, fromBotName: "Scout", text: "Research this", intent: "request", hop: 1 }] } });
  await prisma.thread.update({ where: { id: main }, data: { nextMessageSeq: 901 } });
  const teammateRun = await running(main, mico.id, "bot_message", request.id);
  const closedForRoom = await prisma.thread.findMany({ where: { taskBotId: mico.id, startedBy: "agent", archivedAt: null, id: { notIn: [taskA.id] } }, select: { id: true } });
  for (const thread of closedForRoom) {
    await stopAgentTaskRuns(prisma, { ...scope, botId: mico.id }, thread.id);
  }
  const teammateTask = await startAgentTask(prisma, sourceOf(teammateRun), { key: "team-call", title: "Research", brief: "Research this", botName: "Mico" });
  await prisma.externalEffect.create({ data: { spaceId: scope.spaceId, runId: teammateRun.id, kind: "start_task", idempotencyKey: "team-call",
    status: "completed", request: {}, result: { taskId: teammateTask.taskId } } });
  assert.deepEqual(await pendingTeammateRequest(prisma, teammateRun.id), { fromBotId: scout.id, fromBotName: "Scout" });
  assert.deepEqual(await agentTasksStartedByRun(prisma, teammateRun.id), [teammateTask.taskId]);
  await end(await firstRun(teammateTask.taskId), { outcome: "completed", blocks: [{ kind: "text", text: "Findings" }] });
  const personTeam = await running(teammateTask.taskId, mico.id, "follow_up");
  await end(personTeam, { outcome: "completed", blocks: [{ kind: "text", text: "More findings" }] });
  const teamReports = await reports(teammateTask.taskId);
  assert.equal(teamReports.length, 2);
  const teamReportRun = await prisma.run.findFirstOrThrow({ where: { sourceMessageId: teamReports[1]!.id }, include: { task: true } });
  assert.match(teamReportRun.task.prompt, /part of a request from Scout/);
  checks.push("a task opened for a teammate's request reports every turn while the request waits and names the teammate");

  // 10. History by taskId stays inside the owner, Space and Mico fence.
  const history = await readHistoryPage(db.prisma, { ...scope, threadId: taskA.id, botId: mico.id }, { limit: 20 });
  assert.equal(history.untrusted, true);
  assert.ok(history.messages.some((message) => message.text.includes("Draft the forum thread")));
  const firstPage = await readHistoryPage(db.prisma, { ...scope, threadId: taskA.id, botId: mico.id }, { limit: 1 });
  assert.equal(firstPage.messages.length, 1);
  assert.ok(firstPage.nextCursor !== null);
  const older = await readHistoryPage(db.prisma, { ...scope, threadId: taskA.id, botId: mico.id }, { limit: 1, before: firstPage.nextCursor! });
  assert.ok(older.messages[0]!.seq < firstPage.messages[0]!.seq);
  assert.equal((await readHistoryPage(db.prisma, { ...scope, threadId: taskA.id, botId: other.id }, {})).messages.length, 0);
  assert.equal((await readHistoryPage(db.prisma, { ...scope, userId: "someone-else", threadId: taskA.id, botId: mico.id }, {})).messages.length, 0);
  assert.equal(await isOwnedAgentTask(prisma, { ...scope, botId: mico.id }, taskA.id), true);
  assert.equal(await isOwnedAgentTask(prisma, { ...scope, botId: other.id }, taskA.id), false);
  assert.equal(await isOwnedAgentTask(prisma, { ...scope, botId: mico.id }, userThread.id), false);
  checks.push("read_history by taskId pages a Mico's own task conversation and nothing outside its owner/Space/Mico fence");

  // 11. Work lost to a stuck wait still reports, as interrupted.
  const stuck = await prisma.run.findFirstOrThrow({ where: { threadId: teammateTask.taskId, status: { in: ["queued"] } } }).catch(async () => {
    const queued = await messageAgentTask(prisma, sourceOf(teammateRun), { key: "team-msg", taskId: teammateTask.taskId, text: "Continue", botName: "Mico" }).catch(() => null);
    return prisma.run.findFirstOrThrow({ where: { id: queued?.runId ?? "missing" } });
  });
  const expired = await prisma.$transaction((tx) => expireStuckRun(tx, { runId: stuck.id, threadId: stuck.threadId, status: "queued", updatedAt: stuck.updatedAt, now: new Date() }));
  assert.ok(expired?.taskReport);
  const lost = await prisma.message.findUniqueOrThrow({ where: { threadId_clientNonce: { threadId: main, clientNonce: `task-report:${stuck.threadId}:${stuck.id}` } } });
  assert.equal((lost.blocks as Array<Record<string, unknown>>)[0]?.outcome, "interrupted");
  checks.push("a turn the stuck-work reconciler expires reports as interrupted");

  const result = { passed: true, checks, productionAccess: false };
  await writeFile(path.join(directory, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, receipt: path.join(directory, "result.json") }, null, 2));
} finally {
  await db?.prisma.$disconnect().catch(() => undefined);
  await db?.pool.end().catch(() => undefined);
  await postgres.stop().catch(() => undefined);
}
