import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import EmbeddedPostgres from "embedded-postgres";

process.env.RAKAZO_PROJECT_LOCAL = "1";
process.env.CONTENT_ENCRYPTION = "off";
const { createDb, asSystem, runAsTenant, createThreadEvents, createRepos, claimMicoRun } = await import("@mycellios/db");
const { taskInboxRoutes } = await import("../apps/api/src/routes/task-inbox.js");
const { developmentRoutes } = await import("../apps/api/src/routes/development.js");
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
  const bot = await system.bot.create({ data: { ...actor, name: "Fixture Mico", color: "#10B981", agentEngine: "codex", thread: { create: actor } }, include: { thread: true } });
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
  const development = Object.fromEntries(["open", "rename", "list", "requests", "status", "projects", "saveProject", "projectTask", "primaryRun", "archive", "restore", "remove"].map(name => [name, handler]));
  const dev = developmentRoutes({ deps, authed: { development } } as never).development as unknown as Record<string, (v: unknown) => Promise<any>>;
  const tabs = await runAsTenant(actor, () => dev.list!({ context: { actor }, input: { botId: bot.id } }));
  assert.equal(tabs.length, 2);
  assert.ok(tabs.some((tab: { threadId: string }) => tab.threadId === first.threadId));
  assert.equal((await call("read", { id: first.id })).thread.threadId, first.threadId);
  assert.equal((await call("list")).length, 2);
  const opened = await runAsTenant(actor, () => dev.open!({ context: { actor }, input: { botId: bot.id, projectKey: 'mico:'+bot.id, taskKey: 'mico-task:'+bot.id+':conversation:'+randomUUID(), title: 'Migrar Kuma' } }));
  const list = await call('list');
  const imported = list.find((item:any) => item.threadId === opened.threadId);
  assert.ok(imported);
  assert.equal(imported.title, 'Migrar Kuma');
  assert.equal(imported.runId, null);
  assert.equal(imported.status, null);
  assert.equal(await system.run.count(), 2);
  assert.equal((await call('list')).length, 3);
  await call('archive', {id:imported.id,archived:true});
  assert.ok((await call('list')).find((item:any)=>item.id===imported.id).archivedAt);
  assert.ok((await system.thread.findUniqueOrThrow({where:{id:opened.threadId}})).archivedAt);
  await call('archive', {id:imported.id,archived:false});
  assert.equal((await system.thread.findUniqueOrThrow({where:{id:opened.threadId}})).archivedAt, null);
  // Archive from Tasks stops a running task first instead of refusing it.
  await call('archive', {id:first.id,archived:true});
  assert.equal(await system.run.count({ where: { threadId: first.threadId, status: { in: ['queued','leased','running','waiting_input','waiting_takeover'] } } }), 0);
  assert.ok((await call('list')).find((item:any)=>item.id===first.id).archivedAt);
  // Writing from Tasks restores it in the same transaction, keeping history.
  await call('send', {id:first.id,text:'Synthetic follow-up from Tasks',clientNonce:randomUUID()});
  assert.equal((await call('list')).find((item:any)=>item.id===first.id).archivedAt, null);
  assert.equal((await call('read',{id:imported.id})).thread.threadId,opened.threadId);
  assert.equal((await call('list',{}, {...actor,userId:'foreign'})).length,0);
  await assert.rejects(call('read',{id:imported.id},{...actor,userId:'foreign'}));
  await assert.rejects(call('archive',{id:imported.id,archived:true},{...actor,spaceId:'foreign'}));
  await system.thread.update({where:{id:opened.threadId},data:{title:'Kuma migration'}});
  assert.equal((await call('list')).find((item:any)=>item.id===imported.id).title,'Kuma migration');
  checks.push('real route discovery, empty conversation, idempotence, same-thread resume, archive/restore on the thread, archive stopping work, send restoring from Tasks, live title and owner/Space isolation without inference');
  await call('followUp',{id:imported.id,pinned:true,remindAt:new Date(Date.now()+60000).toISOString()});
  const followed=(await call('list')).find((item:any)=>item.id===imported.id);
  assert.equal(followed.pinned,true);assert.ok(followed.remindAt);
  await assert.rejects(call('followUp',{id:imported.id,pinned:false},{...actor,userId:'foreign'}));
  await assert.rejects(call('followUp',{id:imported.id,remindAt:new Date(Date.now()-1000).toISOString()}));
  await assert.rejects(call('followUp',{id:imported.id,remindAt:new Date(Date.now()+400*86400000).toISOString()}));
  await call('followUp',{id:imported.id,pinned:false});
  assert.equal((await call('list')).find((item:any)=>item.id===imported.id).remindAt,followed.remindAt);
  await call('archive',{id:imported.id,archived:true});
  const closed=(await call('list')).find((item:any)=>item.id===imported.id);
  assert.equal(closed.pinned,false);assert.equal(closed.remindAt,null);
  await assert.rejects(call('followUp',{id:imported.id,pinned:true}));
  await call('archive',{id:imported.id,archived:false});
  const {reconcileTaskReminders}=await import('../packages/adapters/src/task-reminders.js');
  await system.member.create({data:{id:randomUUID(),organizationId:id,userId:actor.userId,role:'owner',createdAt:new Date()}});
  await system.spaceMember.create({data:{id:randomUUID(),organizationId:id,spaceId:actor.spaceId,userId:actor.userId,role:'owner',createdAt:new Date()}});
  const due=new Date(Date.now()-1000);
  await system.inboxTask.update({where:{id:imported.id},data:{remindAt:due}});
  let notices=0;
  const notifications={describe:()=>({}),send:async()=>{},deliver:async(message:any)=>{notices++;assert.equal(message.taskThreadId,opened.threadId);return 'delivered' as const;}};
  await Promise.all([reconcileTaskReminders({prisma,notifications}),reconcileTaskReminders({prisma,notifications})]);
  await reconcileTaskReminders({prisma,notifications});
  assert.equal(notices,1);
  assert.ok((await system.inboxTask.findUniqueOrThrow({where:{id:imported.id}})).reminderNotifiedAt);
  await system.inboxTask.update({where:{id:imported.id},data:{remindAt:new Date(due.getTime()-1),reminderNotifiedAt:null}});
  await reconcileTaskReminders({prisma,notifications:{...notifications,deliver:async()=> 'undeliverable' as const}});
  assert.equal((await system.inboxTask.findUniqueOrThrow({where:{id:imported.id}})).reminderNotifiedAt,null);
  await reconcileTaskReminders({prisma,notifications});assert.equal(notices,2);
  await call('followUp',{id:imported.id,remindAt:null});
  await reconcileTaskReminders({prisma,notifications});assert.equal(notices,2);
  const {WebPushService}=await import('../packages/adapters/src/web-push.js');
  const sessionId=randomUUID();
  await system.session.create({data:{id:sessionId,userId:actor.userId,token:randomUUID(),expiresAt:new Date(Date.now()+3600000)}});
  let pushes=0;
  const web=new WebPushService(prisma,randomBytes(32).toString('hex'),jobs as never,{publicKey:'fixture',privateKey:'fixture',subject:'mailto:fixture@example.invalid'},async(_sub,payload)=>{pushes++;const saved=JSON.parse(payload);assert.equal(saved.taskThreadId,opened.threadId);assert.equal(saved.body.includes('Kuma'),false);});
  await web.register(actor.userId,sessionId,randomUUID(),{endpoint:'https://fcm.googleapis.com/fcm/send/isolated-fixture',keys:{p256dh:Buffer.alloc(65).toString('base64url'),auth:Buffer.alloc(16).toString('base64url')}});
  const remindAt=new Date(Date.now()-5000);
  await system.inboxTask.update({where:{id:imported.id},data:{remindAt,reminderNotifiedAt:null}});
  const reminderMessage={kind:'takeover' as const,title:'Reminder',body:'Kuma migration',botId:bot.id,threadId:opened.threadId,taskThreadId:opened.threadId,taskReminder:{id:imported.id,at:remindAt.toISOString()}};
  const reminderContext={...actor,operationId:'fixture',traceId:'fixture',signal:new AbortController().signal};
  assert.equal(await web.enqueue(reminderMessage,reminderContext),1);
  await web.enqueue(reminderMessage,reminderContext);
  const deliveries=await system.webPushDelivery.findMany();assert.equal(deliveries.length,1);
  await system.$executeRaw`UPDATE web_push_deliveries SET "dueAt"=now()-interval '1 second' WHERE id=${deliveries[0]!.id}`;
  await web.deliver(deliveries[0]!.id);
  assert.equal(pushes,1);
  const rescheduled=new Date(remindAt.getTime()-1);
  await system.inboxTask.update({where:{id:imported.id},data:{remindAt:rescheduled}});
  await web.enqueue({...reminderMessage,taskReminder:{id:imported.id,at:rescheduled.toISOString()}},reminderContext);
  await call('followUp',{id:imported.id,remindAt:null});
  const cancelled=await system.webPushDelivery.findFirstOrThrow({where:{finishedAt:null}});
  await system.$executeRaw`UPDATE web_push_deliveries SET "dueAt"=now()-interval '1 second' WHERE id=${cancelled.id}`;
  await web.deliver(cancelled.id);assert.equal(pushes,1);
  assert.equal(await web.enqueue(reminderMessage,{...reminderContext,userId:'foreign'}),0);
  checks.push('real encrypted Web Push outbox for run-free reminders, idempotence, privacy, exact-thread routing, revoked/cancelled delivery and account isolation with synthetic transport');
  checks.push('durable follow-up, owner isolation, future-date validation, pin-only preservation, archive clears reminders, concurrent at-most-one active dispatch, undeliverable retry and cancellation');
  const { threadsRoutes } = await import("../apps/api/src/routes/threads.js");
  const anyRoute = new Proxy({}, { get: () => new Proxy({}, { get: () => handler }) });
  const threads = threadsRoutes({ deps, authed: anyRoute, callsEnabled: anyRoute } as never).threads as unknown as Record<string, (v: unknown) => Promise<any>>;
  const tabSend = (scope: typeof actor, text: string) => runAsTenant(scope, () => threads.send!({ context: { actor: scope },
    input: { botId: bot.id, taskThreadId: opened.threadId, text, clientNonce: randomUUID() } }));
  await call('archive',{id:imported.id,archived:true});
  const picker = await runAsTenant(actor, () => dev.list!({ context: { actor }, input: { botId: bot.id } }));
  assert.deepEqual(picker.map((tab: any) => [tab.threadId === opened.threadId, tab.kind, tab.archived]).sort(),
    [[false, 'conversation', false], [false, 'conversation', false], [true, 'conversation', true]]);
  await assert.rejects(tabSend({ ...actor, userId: 'foreign' }, 'Synthetic foreign send'));
  await assert.rejects(tabSend({ ...actor, spaceId: 'foreign' }, 'Synthetic foreign send'));
  assert.ok((await call('list')).find((item:any)=>item.id===imported.id).archivedAt);
  const kept = await system.message.count({ where: { threadId: opened.threadId } });
  await tabSend(actor, 'Synthetic follow-up from the Mico tab');
  assert.equal((await call('list')).find((item:any)=>item.id===imported.id).archivedAt, null);
  assert.equal(await system.message.count({ where: { threadId: opened.threadId } }), kept + 1);
  assert.equal(await system.message.count({ where: { threadId: bot.thread!.id } }), 0);
  assert.equal((await runAsTenant(actor, () => dev.list!({ context: { actor }, input: { botId: bot.id } })))
    .find((tab: any) => tab.threadId === opened.threadId).archived, false);
  checks.push('real Mico tab send restores an archived conversation with its history; picker reports kind and archive; foreign owner/Space sends refused');
  const rls=database.getPgClient();await rls.connect();
  try {
    await rls.query('CREATE ROLE inbox_probe NOLOGIN');
    await rls.query('GRANT USAGE ON SCHEMA public TO inbox_probe');
    await rls.query('GRANT SELECT ON task_inbox TO inbox_probe');
    await rls.query('SET ROLE inbox_probe');
    await rls.query("SELECT set_config('app.space_id',$1,false),set_config('app.user_id',$2,false)",[actor.spaceId,actor.userId]);
    assert.equal(Number((await rls.query('SELECT count(*) AS count FROM task_inbox')).rows[0].count),3);
    await rls.query("SELECT set_config('app.user_id','foreign',false)");
    assert.equal(Number((await rls.query('SELECT count(*) AS count FROM task_inbox')).rows[0].count),0);
  } finally {await rls.end();}
  checks.push('real PostgreSQL RLS hides other members');
  const result={passed:true,checks,productionAccess:false,modelsCalled:false};
  await writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
} finally {
 if(db){await db.prisma.$disconnect();await db.pool.end();}
 await database.stop();
}
