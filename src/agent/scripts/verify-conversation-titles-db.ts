import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import EmbeddedPostgres from "embedded-postgres";

process.env.RAKAZO_PROJECT_LOCAL = "1";
process.env.CONTENT_ENCRYPTION = "off";
const { createDb, asSystem, runAsTenant, createThreadMessageInTransaction } = await import("@mycellios/db");
const { developmentRoutes } = await import("../apps/api/src/routes/development.js");
const socket = createServer();
await new Promise<void>(resolve => socket.listen(0, "127.0.0.1", resolve));
const port = (socket.address() as {port:number}).port;
await new Promise<void>(resolve => socket.close(() => resolve()));
const directory = await mkdtemp(path.join(tmpdir(), "mycellios-conversation-titles-"));
const password = randomBytes(24).toString("hex");
const postgres = new EmbeddedPostgres({ databaseDir: path.join(directory,"pg"), port, user:"postgres", password,
  persistent:true, createPostgresUser:false, autoRehydrateSymlinks:true, initdbFlags:["--encoding=UTF8","--locale=C"], onLog:()=>{}, onError:()=>{} });
let db: ReturnType<typeof createDb> | undefined;
try {
  await postgres.initialise(); await postgres.start();
  const url = `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`;
  await promisify(execFile)(process.execPath,[path.resolve("node_modules/prisma/build/index.js"),"db","push","--config","packages/db/prisma.config.ts"],
    {windowsHide:true,env:{...process.env,DATABASE_URL:url,DATABASE_MIGRATION_URL:url},maxBuffer:1024*1024});
  db = createDb(url,{encryptContent:false,applicationName:"synthetic-conversation-titles"});
  const prisma=db.prisma, system=asSystem(prisma,"synthetic conversation title proof");
  const actor={userId:"owner",spaceId:"space",organizationId:"org",email:"owner@example.invalid",isDeploymentOwner:false};
  await system.user.create({data:{id:actor.userId,name:"Synthetic owner",email:actor.email}});
  await system.organization.create({data:{id:"org",name:"Synthetic",slug:"title-proof",createdAt:new Date()}});
  await system.space.create({data:{id:"space",organizationId:"org",name:"Synthetic"}});
  await system.member.create({data:{id:"member",userId:"owner",organizationId:"org",role:"owner",createdAt:new Date()}});
  await system.spaceMember.create({data:{id:"space-member",userId:"owner",organizationId:"org",spaceId:"space",role:"owner",createdAt:new Date()}});
  await system.bot.create({data:{id:"mico",spaceId:"space",userId:"owner",name:"Synthetic Mico",color:"#10B981",thread:{create:{spaceId:"space",userId:"owner"}}}});
  const handler={handler:(fn:unknown)=>fn};
  const authed={development:Object.fromEntries(["open","rename","list","status","projects","saveProject","projectTask","primaryRun","archive","restore","remove"].map(key=>[key,handler]))};
  const routes=developmentRoutes({deps:{prisma},authed} as never).development;
  const invoke=<T>(fn:unknown,input:unknown,identity=actor) => runAsTenant(identity,()=> (fn as (value:unknown)=>Promise<T>)({context:{actor:identity},input}));
  const opened=await invoke<{threadId:string}>(routes.open,{botId:"mico",projectKey:"mico:mico",taskKey:"mico-task:mico:proof"});
  assert.equal((await system.thread.findUniqueOrThrow({where:{id:opened.threadId}})).title,null);
  assert.deepEqual(await invoke(routes.open,{botId:"mico",projectKey:"mico:mico",taskKey:"mico-task:mico:proof"}),opened);
  const send=(text:string,nonce:string) => runAsTenant(actor,()=>prisma.$transaction(tx=>createThreadMessageInTransaction(tx,{threadId:opened.threadId,role:"user",blocks:[{kind:"text",text}],clientNonce:nonce})));
  await send("\n  Preparar   mi presupuesto  \n con detalle","first");
  const titled=await system.thread.findUniqueOrThrow({where:{id:opened.threadId}});
  assert.deepEqual([titled.title,titled.titleSource],["Preparar mi presupuesto","auto"]);
  await send("Otro tema","second");
  assert.equal((await system.thread.findUniqueOrThrow({where:{id:opened.threadId}})).title,"Preparar mi presupuesto");
  for(const title of ["","Dos\nlíneas","x".repeat(121)])
    await assert.rejects(invoke(routes.rename,{botId:"mico",taskThreadId:opened.threadId,title}),/1 to 120 characters/);
  await invoke(routes.rename,{botId:"mico",taskThreadId:opened.threadId,title:"Presupuesto 2027"});
  await send("Tercero","third");
  const renamed=await system.thread.findUniqueOrThrow({where:{id:opened.threadId}});
  assert.deepEqual([renamed.title,renamed.titleSource],["Presupuesto 2027","user"]);
  const long=await invoke<{threadId:string}>(routes.open,{botId:"mico",projectKey:"mico:mico",taskKey:"mico-task:mico:long"});
  await runAsTenant(actor,()=>prisma.$transaction(tx=>createThreadMessageInTransaction(tx,{threadId:long.threadId,role:"user",blocks:[{kind:"text",text:"🍄".repeat(130)}]})));
  const longTitle=(await system.thread.findUniqueOrThrow({where:{id:long.threadId}})).title!;
  assert.equal(Array.from(longTitle).length,120); assert.ok(longTitle.endsWith("…"));
  for(const identity of [{...actor,userId:"foreign"},{...actor,spaceId:"foreign-space"}]) {
    await assert.rejects(invoke(routes.rename,{botId:"mico",taskThreadId:opened.threadId,title:"Forbidden"},identity));
  }
  const blank=await invoke<{threadId:string}>(routes.open,{botId:"mico",projectKey:"mico:mico",taskKey:"mico-task:mico:race"});
  await runAsTenant(actor,()=>Promise.all(["Uno","Dos"].map(text=>prisma.$transaction(tx=>createThreadMessageInTransaction(tx,{threadId:blank.threadId,role:"user",blocks:[{kind:"text",text}]})))));
  const first=await system.message.findFirstOrThrow({where:{threadId:blank.threadId},orderBy:{seq:"asc"}});
  assert.equal((await system.thread.findUniqueOrThrow({where:{id:blank.threadId}})).title,(first.blocks as {text:string}[])[0]!.text);
  const rollback=await invoke<{threadId:string}>(routes.open,{botId:"mico",projectKey:"mico:mico",taskKey:"mico-task:mico:rollback"});
  await assert.rejects(runAsTenant(actor,()=>prisma.$transaction(async tx=>{
    await createThreadMessageInTransaction(tx,{threadId:rollback.threadId,role:"user",blocks:[{kind:"text",text:"Never committed"}]}); throw Error("Synthetic rollback");
  })));
  assert.equal((await system.thread.findUniqueOrThrow({where:{id:rollback.threadId}})).title,null);
  assert.equal(await system.message.count({where:{threadId:rollback.threadId}}),0);
  const result={passed:true,checks:["untitled and idempotent creation","first non-empty line names conversation (auto)","later messages preserve title","rename validated to 1-120 characters on one line","manual rename persists as the person's title","long titles end at 120 characters with an ellipsis","owner and Space isolation","concurrent first messages serialize","title and message roll back together"],productionAccess:false,modelsCalled:false,directory};
  await writeFile(path.join(directory,"result.json"),JSON.stringify(result,null,2)); console.log(JSON.stringify(result,null,2));
} finally {
  if(db){await db.prisma.$disconnect();await db.pool.end();}
  await postgres.stop();
}
