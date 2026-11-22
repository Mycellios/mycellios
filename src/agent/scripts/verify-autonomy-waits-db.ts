import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import EmbeddedPostgres from 'embedded-postgres';
import { asSystem, createDb, openEventWait, reconcileWork, workStatus, controlWorkTree } from '@mycellios/db';
import { reconcileWorkStops } from '../packages/adapters/src/work-stop-reconciler.js';

// Own new loopback cluster only. No .env, users, credentials, live models or paid requests.
process.env.RAKAZO_PROJECT_LOCAL = '1';
process.env.CONTENT_ENCRYPTION = 'off';
const listener = createServer();
await new Promise<void>(resolve => listener.listen(0, '127.0.0.1', resolve));
const port = (listener.address() as { port: number }).port;
await new Promise<void>(resolve => listener.close(() => resolve()));
const directory = await mkdtemp(path.join(tmpdir(), 'mycellios-autonomy-waits-'));
// The temporary cluster's dedicated OS user must be able to traverse its parent.
if (process.platform !== 'win32' && process.getuid?.() === 0) await chmod(directory, 0o755);
const password = randomBytes(24).toString('hex');
const cluster = new EmbeddedPostgres({ databaseDir: path.join(directory, 'pg'), port, user: 'postgres',
  password, persistent: true, createPostgresUser: process.platform !== 'win32' && process.getuid?.() === 0, autoRehydrateSymlinks: true, onLog: () => {}, onError: () => {} });
let database: ReturnType<typeof createDb> | undefined;
const checks: string[] = [];
try {
  await cluster.initialise(); await cluster.start();
  const url = `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`;
  await promisify(execFile)(process.execPath, [path.resolve('node_modules/prisma/build/index.js'), 'db', 'push', '--config', 'packages/db/prisma.config.ts'], {
    cwd: process.cwd(), windowsHide: true, env: { ...process.env, DATABASE_URL: url, DATABASE_MIGRATION_URL: url }, maxBuffer: 1024 * 1024,
  });
  database = createDb(url, { encryptContent: false, applicationName: 'synthetic-autonomy-waits' });
  // Prisma db push omits SQL CHECK constraints. Install the actual deployed
  // predecessor before qualifying this upgrade, rather than testing a weaker DB.
  const previousMigration = await readFile('packages/db/prisma/migrations/20261104180000_durable_work_delegation/migration.sql', 'utf8');
  const previousCheck = previousMigration.match(/ALTER TABLE tasks ADD CONSTRAINT tasks_delegation_state_check CHECK[\s\S]*?;/)?.[0];
  assert.ok(previousCheck, 'canonical predecessor CHECK must exist');
  await database.pool.query(previousCheck);
  const prisma = asSystem(database.prisma, 'isolated synthetic autonomy acceptance');
  const suffix = randomUUID();
  const scope = { spaceId: `space-${suffix}`, userId: `user-${suffix}` };
  await prisma.user.create({ data: { id: scope.userId, name: 'Synthetic owner', email: `${suffix}@example.invalid` } });
  await prisma.organization.create({ data: { id: `org-${suffix}`, name: 'Synthetic', slug: suffix, createdAt: new Date() } });
  await prisma.space.create({ data: { id: scope.spaceId, organizationId: `org-${suffix}`, name: 'Synthetic autonomy' } });
  const bot = await prisma.bot.create({ data: { ...scope, name: 'Synthetic Mico', color: 'green', thread: { create: { ...scope } } }, include: { thread: true } });
  const other = await prisma.bot.create({ data: { ...scope, name: 'Other synthetic Mico', color: 'blue', thread: { create: { ...scope } } }, include: { thread: true } });
  const originalStates = [null, 'queued', 'running', 'waiting', 'completed', 'failed', 'paused', 'cancelled'] as const;
  const originalTasks = await Promise.all(originalStates.map(delegationState => prisma.task.create({ data: {
    ...scope, botId: bot.id, threadId: bot.thread!.id, prompt: 'Synthetic existing delegation state', status: 'completed', delegationState,
  } })));
  const invalidState = (delegationState: string) => prisma.task.create({ data: {
    ...scope, botId: bot.id, threadId: bot.thread!.id, prompt: 'Synthetic CHECK rejection', status: 'completed', delegationState,
  } });
  await assert.rejects(invalidState('waiting_event'), /tasks_delegation_state_check/,
    'the real deployed predecessor rejects event waits before the migration');
  const migration = await readFile('packages/db/prisma/migrations/20261116150000_event_wait_delegation_state/migration.sql', 'utf8');
  await database.pool.query(migration);
  for (const task of originalTasks) assert.deepEqual(await prisma.task.findUniqueOrThrow({ where: { id: task.id } }), task,
    'migration preserves each preexisting Task row and delegation state');
  await assert.rejects(invalidState('unknown_state'), /tasks_delegation_state_check/,
    'the expanded constraint still rejects unknown states');
  const eventState = await invalidState('waiting_event');
  assert.equal(eventState.delegationState, 'waiting_event');
  await prisma.task.deleteMany({ where: { id: { in: [...originalTasks.map(task => task.id), eventState.id] } } });
  checks.push('real predecessor CHECK rejects waits; actual additive migration preserves all existing states and rejects unknown states');
  const workPlan = { version: 1, steps: [{ id: 'verify', title: 'Verify the observed result', status: 'pending' }], count: 2, nextCount: 0, repairs: 0 };
  async function source(name: string) {
    const task = await prisma.task.create({ data: { ...scope, botId: bot.id, threadId: bot.thread!.id,
      prompt: name, status: 'running', workPlan } });
    const run = await prisma.run.create({ data: { ...scope, botId: bot.id, threadId: task.threadId, taskId: task.id,
      status: 'running', trigger: 'user', leaseOwner: 'synthetic-worker', leaseFence: 1, leaseExpiresAt: new Date(Date.now() + 300_000) } });
    return { ...scope, id: run.id, taskId: task.id, botId: bot.id, threadId: task.threadId, leaseOwner: 'synthetic-worker', leaseFence: 1 };
  }
  async function finish(runId: string, status = 'completed') {
    await prisma.run.update({ where: { id: runId }, data: { status, completedAt: new Date(), leaseOwner: null, leaseExpiresAt: null } });
  }
  async function returned(taskId: string) {
    return prisma.run.count({ where: { taskId, trigger: 'task_return' } });
  }
  async function settleParent(runId: string, taskId: string) {
    await finish(runId);
    await Promise.all([reconcileWork(prisma), reconcileWork(prisma)]);
    await reconcileWork(prisma);
    assert.equal(await returned(taskId), 1, 'exactly one automatic parent continuation');
    const parent = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    assert.deepEqual(parent.workPlan, workPlan, 'continuation budget and pending plan survive event return');
    return parent;
  }

  const timer = await source('Wait for synthetic future time');
  const past = new Date(Date.now() - 5_000);
  const due = new Date(Date.now() - 1_000).toISOString();
  const [first, replay] = await Promise.all([
    openEventWait(prisma, timer, { key: 'timer', note: 'Check the result after the timer', resumeAt: due }, past),
    openEventWait(prisma, timer, { key: 'timer', note: 'Check the result after the timer', resumeAt: due }, past),
  ]);
  assert.equal(first.waitId, replay.waitId);
  assert.equal(await prisma.task.count({ where: { parentTaskId: timer.taskId } }), 1);
  await reconcileWork(prisma);
  assert.equal(await returned(timer.taskId), 0, 'never resume while original run remains active');
  const timerParent = await settleParent(timer.id, timer.taskId);
  assert.match(timerParent.prompt, /wait=ready/);
  const timerStatus = await workStatus(prisma, { ...scope, taskId: timer.taskId });
  assert.equal(timerStatus.find(task => task.id === first.waitId)?.delegationState, 'completed');
  checks.push('timer settles once, waits for original execution, preserves plan and continuation budget');

  const restarted = createDb(url, { encryptContent: false, applicationName: 'synthetic-restarted-worker' });
  try { await reconcileWork(asSystem(restarted.prisma, 'synthetic restarted worker')); }
  finally { await restarted.prisma.$disconnect(); await restarted.pool.end(); }
  assert.equal(await returned(timer.taskId), 1);
  checks.push('fresh worker database client recovers durable state without another parent execution');
  await prisma.run.update({ where: { id: timerParent.returnRunId! }, data: { status: 'running', leaseOwner: 'synthetic-worker', leaseFence: 2, leaseExpiresAt: new Date(Date.now() + 60_000) } });
  const settledReplay = await openEventWait(prisma, { ...timer, id: timerParent.returnRunId!, leaseFence: 2 },
    { key: 'timer', note: 'Check the result after the timer', resumeAt: due }, past);
  assert.equal(settledReplay.waitId, first.waitId); assert.equal(settledReplay.waitingForTasks, false);
  assert.match(settledReplay.outcome ?? '', /wait=ready/);
  await finish(timerParent.returnRunId!);
  checks.push('replaying an already settled wait returns its receipt instead of parking the task again');

  for (const status of ['completed', 'failed'] as const) {
    const owner = await source(`Wait for routine ${status}`);
    const routine = await prisma.routine.create({ data: { ...scope, botId: bot.id, name: `Synthetic ${status}`, prompt: 'Synthetic observation only', crons: [], webhookEnabled: true } });
    const wait = await openEventWait(prisma, owner, { key: status, note: 'Verify the actual routine outcome', routineId: routine.id }, new Date(Date.now() - 500));
    const eventTask = await prisma.task.create({ data: { ...scope, botId: bot.id, threadId: owner.threadId, prompt: 'Synthetic event', status } });
    const event = await prisma.run.create({ data: { ...scope, botId: bot.id, threadId: owner.threadId, taskId: eventTask.id,
      routineId: routine.id, trigger: 'routine', status, completedAt: new Date() } });
    const parent = await settleParent(owner.id, owner.taskId);
    const expected = status === 'completed' ? 'ready' : 'failed';
    assert.match(parent.prompt, new RegExp(`wait=${expected}; eventRun=${event.id}`));
    assert.equal((await prisma.task.findUniqueOrThrow({ where: { id: wait.waitId } })).delegationState, status === 'completed' ? 'completed' : 'failed');
    checks.push(`routine ${status} resumes parent once with an honest ${expected} outcome`);
  }

  const expires = await source('Expire an unattended wait');
  const watched = await prisma.routine.create({ data: { ...scope, botId: bot.id, name: 'Never fired', prompt: 'Synthetic', crons: [] } });
  const expired = await openEventWait(prisma, expires, { key: 'expired', note: 'Report the expired wait', routineId: watched.id, timeoutMinutes: 1 }, new Date(Date.now() - 120_000));
  const expiredParent = await settleParent(expires.id, expires.taskId);
  assert.match(expiredParent.prompt, /wait=expired/);
  assert.equal((await prisma.task.findUniqueOrThrow({ where: { id: expired.waitId } })).delegationState, 'failed');
  checks.push('deadline expires durably and wakes parent without claiming success');

  const lateOwner = await source('Reject an event completed after its wait deadline');
  const lateTarget = await source('Synthetic late result');
  await openEventWait(prisma, lateOwner, { key: 'late-result', note: 'Report timeout without accepting late result', runId: lateTarget.id, timeoutMinutes: 1 }, new Date(Date.now() - 120_000));
  await finish(lateTarget.id);
  const lateParent = await settleParent(lateOwner.id, lateOwner.taskId);
  assert.match(lateParent.prompt, /wait=expired/);
  checks.push('late completion beyond the deadline is an expired wait, not a false on-time result');

  const foreign = await source('Try foreign event scopes');
  const foreignRoutine = await prisma.routine.create({ data: { ...scope, botId: other.id, name: 'Foreign Mico routine', prompt: 'Synthetic', crons: [] } });
  await assert.rejects(openEventWait(prisma, foreign, { key: 'foreign-mico', note: 'Must refuse', routineId: foreignRoutine.id }));
  await assert.rejects(openEventWait(prisma, { ...foreign, spaceId: 'foreign-space' }, { key: 'foreign-space', note: 'Must refuse', resumeAt: new Date(Date.now() + 60_000).toISOString() }));
  await assert.rejects(openEventWait(prisma, { ...foreign, userId: 'foreign-user' }, { key: 'foreign-user', note: 'Must refuse', resumeAt: new Date(Date.now() + 60_000).toISOString() }));
  await assert.rejects(openEventWait(prisma, { ...foreign, leaseFence: 99 }, { key: 'stale-lease', note: 'Must refuse', resumeAt: new Date(Date.now() + 60_000).toISOString() }));
  checks.push('foreign Mico, Space, user and stale execution lease cannot register waits');
  await finish(foreign.id);

  const executionOwner = await source('Wait for owned execution lease release');
  const observed = await source('Synthetic observed job');
  const executionWait = await openEventWait(prisma, executionOwner, { key: 'owned-execution', note: 'Verify released execution', runId: observed.id });
  await prisma.run.update({ where: { id: observed.id }, data: { status: 'completed', completedAt: new Date() } });
  await finish(executionOwner.id); await reconcileWork(prisma);
  assert.equal(await returned(executionOwner.taskId), 0, 'a terminal status with a live lease is not settled');
  await finish(observed.id); await reconcileWork(prisma); await reconcileWork(prisma);
  assert.equal(await returned(executionOwner.taskId), 1);
  assert.equal((await prisma.task.findUniqueOrThrow({ where: { id: executionWait.waitId } })).delegationState, 'completed');
  checks.push('owned execution result waits for lease release before waking the parent');

  for (const cancelTaskRow of [false, true]) {
    const owner = await source(cancelTaskRow ? 'Direct cancellation updates task' : 'Chat Stop cancels original run only');
    const routine = await prisma.routine.create({ data: { ...scope, botId: bot.id, name: 'Late event after direct Stop', prompt: 'Synthetic', crons: [] } });
    await openEventWait(prisma, owner, { key: 'direct-stop', note: 'Must never resurrect after Stop', routineId: routine.id });
    // Match the two existing cancellation paths: chat Stop ends the run; the
    // shared cancellation helper also ends the Task row. Neither uses tree controls.
    await prisma.$transaction(async tx => {
      await tx.run.update({ where: { id: owner.id }, data: { status: 'cancelled', completedAt: new Date(), leaseOwner: null, leaseExpiresAt: null } });
      if (cancelTaskRow) await tx.task.update({ where: { id: owner.taskId }, data: { status: 'cancelled' } });
    });
    const eventTask = await prisma.task.create({ data: { ...scope, botId: bot.id, threadId: owner.threadId, prompt: 'Late event', status: 'completed' } });
    await prisma.run.create({ data: { ...scope, botId: bot.id, threadId: owner.threadId, taskId: eventTask.id,
      routineId: routine.id, trigger: 'routine', status: 'completed', completedAt: new Date() } });
    await reconcileWork(prisma); await reconcileWork(prisma);
    assert.equal(await returned(owner.taskId), 0, 'direct Stop is final even when the awaited event later arrives');
    assert.equal((await prisma.task.findUniqueOrThrow({ where: { id: owner.taskId } })).delegationState, 'cancelled');
    checks.push(cancelTaskRow ? 'direct run/task cancellation cannot be resurrected by late event' : 'chat Stop ending only the original run cannot be resurrected by late event');
  }

  for (const action of ['cancel', 'pause'] as const) {
    const owner = await source(`${action} an event wait`);
    const wait = await openEventWait(prisma, owner, { key: action, note: 'Synthetic resumable wait', resumeAt: due }, past);
    await finish(owner.id);
    let parent = await prisma.task.findUniqueOrThrow({ where: { id: owner.taskId } });
    await controlWorkTree(prisma, scope, { taskId: owner.taskId, expectedRevision: parent.delegationRevision, action });
    await reconcileWork(prisma);
    assert.equal(await returned(owner.taskId), 0, 'paused/cancelled work cannot auto-wake');
    await reconcileWorkStops({ prisma, sandbox: {} as never, jobs: { cancel: async () => {} } as never }, scope);
    if (action === 'pause') {
      parent = await prisma.task.findUniqueOrThrow({ where: { id: owner.taskId } });
      await controlWorkTree(prisma, scope, { taskId: owner.taskId, expectedRevision: parent.delegationRevision, action: 'resume' });
      assert.equal((await prisma.task.findUniqueOrThrow({ where: { id: wait.waitId } })).delegationState, 'waiting_event');
      await reconcileWork(prisma); await reconcileWork(prisma);
      assert.equal(await returned(owner.taskId), 1);
    } else {
      await reconcileWork(prisma);
      assert.equal(await returned(owner.taskId), 0);
      assert.equal((await prisma.task.findUniqueOrThrow({ where: { id: wait.waitId } })).delegationState, 'cancelled');
    }
    checks.push(action === 'pause' ? 'pause suppresses automatic wake; explicit resume restores the same durable wait' : 'Stop cancels wait and late timer cannot reactivate it');
  }
  const result = { ok: true, isolatedPostgres: true, paidModelCalls: 0, productionAccess: false,
    verification: 'Real PostgreSQL scheduling and recovery; synthetic execution receipts, not live model inference', checks };
  const receipt = path.join(directory, 'result.json');
  await writeFile(receipt, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, receipt }, null, 2));
} finally {
  if (database) { await database.prisma.$disconnect(); await database.pool.end(); }
  await cluster.stop();
}
