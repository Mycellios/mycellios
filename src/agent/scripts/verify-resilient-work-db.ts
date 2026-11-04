import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import EmbeddedPostgres from "embedded-postgres";
import { createDb, asSystem, delegateWork, reconcileWork, saveWorkState, workStatus, controlWorkTree, settleObservedShell } from "@rakazo/db";
import { reconcileWorkStops } from "../packages/adapters/src/work-stop-reconciler.js";

// Synthetic loopback cluster only. Do not load .env, credentials, existing users or models.
process.env.RAKAZO_PROJECT_LOCAL = "1";
process.env.CONTENT_ENCRYPTION = "off";
const server = createServer(); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const port = (server.address() as {port:number}).port; await new Promise<void>(resolve => server.close(()=>resolve()));
const directory = await mkdtemp(path.join(tmpdir(), "mycellios-work-db-"));
const password = randomBytes(24).toString("hex");
const database = new EmbeddedPostgres({ databaseDir: path.join(directory, "pg"), port, user: "postgres",
  password, persistent: true, autoRehydrateSymlinks: true, onLog: ()=>{}, onError: ()=>{} });
let db: ReturnType<typeof createDb> | undefined;
const checks: string[] = [];
try {
  await database.initialise(); await database.start();
  const url = `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`;
  await promisify(execFile)(process.execPath, [path.resolve("node_modules/prisma/build/index.js"), "db", "push", "--config", "packages/db/prisma.config.ts"],
    { cwd: process.cwd(), windowsHide: true, env: {...process.env, DATABASE_URL:url, DATABASE_MIGRATION_URL:url}, maxBuffer: 1024*1024 });
  // Exercise the actual additive migration on this brand-new, empty loopback schema.
  const migrationClient = database.getPgClient(); await migrationClient.connect();
  try {
    const columns = ["workPlan","parentTaskId","delegationRootId","delegationKey","delegationState","delegationRevision","delegatedRunId","expectedResult","resources","dependencies","returnRunId","returnedToParentAt","delegationCheckedAt","workStopPending","workStopTargets"];
    await migrationClient.query("ALTER TABLE tasks " + columns.map(name => `DROP COLUMN "${name}" CASCADE`).join(", "));
    await migrationClient.query(await readFile("packages/db/prisma/migrations/20261104180000_durable_work_delegation/migration.sql","utf8"));
    checks.push("actual additive migration applies to the isolated loopback schema");
  } finally { await migrationClient.end(); }
  db = createDb(url, { encryptContent: false, applicationName: "synthetic-work-acceptance" });
  const prisma = asSystem(db.prisma, "isolated synthetic durable work acceptance");
  const suffix = randomUUID(); const scope={ spaceId:`space-${suffix}`, userId:`user-${suffix}` };
  await prisma.user.create({ data:{id:scope.userId,name:"Synthetic owner",email:`${suffix}@example.invalid`} });
  await prisma.organization.create({data:{id:`org-${suffix}`,name:"Synthetic",slug:suffix,createdAt:new Date()}});
  await prisma.space.create({data:{id:scope.spaceId,organizationId:`org-${suffix}`,name:"Synthetic"}});
  const bots=[];
  for(let index=0;index<4;index++) bots.push(await prisma.bot.create({data:{...scope,name:`Synthetic Mico ${index}`,color:"green",thread:{create:{...scope}}},include:{thread:true}}));
  const parent=await prisma.task.create({data:{...scope,botId:bots[0]!.id,threadId:bots[0]!.thread!.id,prompt:"Prepare and verify synthetic files only",status:"running"}});
  const run=await prisma.run.create({data:{...scope,botId:parent.botId,threadId:parent.threadId,taskId:parent.id,status:"running",trigger:"user",leaseOwner:"synthetic-worker",leaseFence:1,leaseExpiresAt:new Date(Date.now()+60000)}});
  const source={...scope,id:run.id,taskId:parent.id,botId:parent.botId,threadId:parent.threadId,leaseOwner:"synthetic-worker",leaseFence:1};
  const input={key:`delegate-${suffix}`,botId:bots[1]!.id,instruction:"Produce synthetic A",expectedResult:"A exists and was checked",resources:["workspace:C:/Synthetic/App"]};
  const shellKey=`pending-shell-${suffix}`;
  await prisma.externalEffect.create({data:{spaceId:scope.spaceId,runId:run.id,kind:'shell',idempotencyKey:shellKey,status:'completed',request:{command:'synthetic command receipt only'},result:{running:true}}});
  await assert.rejects(delegateWork(prisma,source,input));
  await settleObservedShell(prisma,source,{commandId:`${run.id}:${shellKey}`,runId:run.id,code:7,stdout:'',stderr:'synthetic known failure'});
  checks.push("pending commands block overlapping delegation until their real observed result is settled");
  const [one,replayed]=await Promise.all([delegateWork(prisma,source,input),delegateWork(prisma,source,input)]);
  assert.equal(one.taskId,replayed.taskId);assert.equal(await prisma.task.count({where:{parentTaskId:parent.id}}),1);
  checks.push("concurrent duplicate delegation creates one child");
  await assert.rejects(delegateWork(prisma,{...source,spaceId:"foreign-space"},{...input,key:`foreign-${suffix}`}));
  await assert.rejects(delegateWork(prisma,source,{...input,key:`cycle-${suffix}`,dependencies:[parent.id]}));
  checks.push("cross-Space access and parent dependency cycles are refused");
  const two=await delegateWork(prisma,source,{...input,key:`second-${suffix}`,botId:bots[2]!.id,instruction:"Produce synthetic B",dependencies:[one.taskId]});
  const three=await delegateWork(prisma,source,{...input,key:`third-${suffix}`,botId:bots[3]!.id,instruction:"Produce synthetic C",resources:['workspace:c:/synthetic/app/src']});
  const isolated=await prisma.task.findUniqueOrThrow({where:{id:one.taskId},include:{thread:true}});
  assert.equal(isolated.thread.taskBotId,bots[1]!.id);assert.notEqual(isolated.threadId,bots[1]!.thread!.id);
  await assert.rejects(delegateWork(prisma,source,{...input,key:`unchanged-${suffix}`}));
  checks.push("delegated tasks have independent Mico conversations and repeated unchanged assignments are refused");
  await prisma.run.update({where:{id:run.id},data:{status:"completed",leaseOwner:null,leaseExpiresAt:null}});
  await Promise.all([reconcileWork(prisma),reconcileWork(prisma)]);
  const first=await prisma.task.findUniqueOrThrow({where:{id:one.taskId}});
  assert.ok(first.delegatedRunId);assert.equal(await prisma.run.count({where:{taskId:one.taskId}}),1);
  assert.equal((await prisma.task.findUniqueOrThrow({where:{id:two.taskId}})).delegatedRunId,null);
  assert.equal((await prisma.task.findUniqueOrThrow({where:{id:three.taskId}})).delegatedRunId,null);
  checks.push("two reconcilers dispatch once; dependent work waits");
  const durableRun=first.delegatedRunId;
  // New DB client represents a restarted worker; the queued run is the durable outbox.
  const restarted=createDb(url,{encryptContent:false});
  try {await reconcileWork(asSystem(restarted.prisma,"synthetic restart"));}
  finally {await restarted.prisma.$disconnect();await restarted.pool.end();}
  assert.equal((await prisma.task.findUniqueOrThrow({where:{id:one.taskId}})).delegatedRunId,durableRun);
  checks.push("restart and missed publication do not create another child execution");
  await prisma.run.update({where:{id:durableRun!},data:{status:"completed"}});
  await reconcileWork(prisma);
  const second=await prisma.task.findUniqueOrThrow({where:{id:two.taskId}});assert.ok(second.delegatedRunId);
  await prisma.run.update({where:{id:second.delegatedRunId!},data:{status:"failed",error:"synthetic expected failure"}});
  await reconcileWork(prisma);
  const third=await prisma.task.findUniqueOrThrow({where:{id:three.taskId}});assert.ok(third.delegatedRunId);
  await prisma.run.update({where:{id:third.delegatedRunId!},data:{status:'completed'}});
  checks.push("Windows ancestor resource reservations serialize independent children until ownership is released");
  await reconcileWork(prisma);await reconcileWork(prisma);
  const resumed=await prisma.task.findUniqueOrThrow({where:{id:parent.id}});assert.ok(resumed.returnRunId);
  assert.equal(await prisma.run.count({where:{taskId:parent.id,trigger:"task_return"}}),1);
  assert.equal((await workStatus(prisma,{...scope,taskId:parent.id})).find(task=>task.id===two.taskId)?.delegationState,"failed");
  checks.push("failure returns durably to the parent once, without claiming success");
  const fresh=await prisma.run.update({where:{id:resumed.returnRunId!},data:{status:"running",leaseOwner:"new-worker",leaseFence:2}});
  const owner={...source,id:fresh.id,leaseOwner:"new-worker",leaseFence:2};
  await saveWorkState(prisma,owner,{version:1,steps:[{id:"verify",title:"Verify synthetic output",status:"running"}],count:1,nextCount:0,repairs:0});
  await prisma.run.update({where:{id:fresh.id},data:{leaseFence:3}});
  await assert.rejects(saveWorkState(prisma,owner,{version:1,steps:[]}));
  assert.equal(((await prisma.task.findUniqueOrThrow({where:{id:parent.id}})).workPlan as {version:number}).version,1);
  checks.push("work checkpoints survive restart and reject an obsolete lease fence");
  const current=await prisma.task.findUniqueOrThrow({where:{id:parent.id}});
  const paused=await controlWorkTree(prisma,scope,{taskId:parent.id,expectedRevision:current.delegationRevision,action:'pause'});
  assert.equal(paused.paused,true);
  assert.equal((await prisma.run.findUniqueOrThrow({where:{id:fresh.id}})).status,'cancelled');
  await assert.rejects(controlWorkTree(prisma,scope,{taskId:parent.id,expectedRevision:paused.revision,action:'resume'}));
  const cancelledJobs:string[]=[];
  await reconcileWorkStops({prisma,sandbox:{} as never,jobs:{cancel:async(key:string)=>{cancelledJobs.push(key);}} as never},scope);
  assert.equal((await prisma.task.findUniqueOrThrow({where:{id:parent.id}})).workStopPending,false);
  const reassigned=await controlWorkTree(prisma,scope,{taskId:parent.id,expectedRevision:paused.revision,action:'reassign',botId:bots[3]!.id});
  assert.equal(reassigned.paused,false);
  const newOwner=await prisma.task.findUniqueOrThrow({where:{id:parent.id}});
  assert.equal(newOwner.botId,bots[3]!.id);assert.notEqual(newOwner.threadId,bots[3]!.thread!.id);
  const transferredThread=await prisma.thread.findUniqueOrThrow({where:{id:newOwner.threadId}});
  assert.equal(transferredThread.taskBotId,bots[3]!.id);
  assert.equal((await prisma.run.findUniqueOrThrow({where:{id:fresh.id}})).threadId,parent.threadId);
  assert.ok(newOwner.prompt.includes('inspect command_status'));
  await assert.rejects(controlWorkTree(prisma,scope,{taskId:parent.id,expectedRevision:paused.revision,action:'pause'}));
  checks.push("pause persists teardown; reassignment waits, preserves independent chats and prior run history, and rejects stale controls");
  await writeFile(path.join(directory,"result.json"),JSON.stringify({passed:true,checks,productionAccess:false},null,2));
  console.log(JSON.stringify({passed:true,checks,receipt:path.join(directory,"result.json"),productionAccess:false},null,2));
} finally {
  if(db){await db.prisma.$disconnect();await db.pool.end();}
  await database.stop();
}
