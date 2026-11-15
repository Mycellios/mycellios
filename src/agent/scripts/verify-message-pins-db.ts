import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {randomBytes} from "node:crypto";
import {mkdtemp,readFile,writeFile} from "node:fs/promises";
import {createServer} from "node:net";
import {tmpdir} from "node:os";
import path from "node:path";
import {promisify} from "node:util";
import EmbeddedPostgres from "embedded-postgres";
process.env.RAKAZO_PROJECT_LOCAL="1";process.env.CONTENT_ENCRYPTION="off";
const {createDb,asSystem,runAsTenant,listMessagePins,setMessagePin}=await import("@rakazo/db");
const {messagePinRoutes}=await import("../apps/api/src/routes/message-pins.js");
const socket=createServer();await new Promise<void>(resolve=>socket.listen(0,"127.0.0.1",resolve));
const port=(socket.address() as {port:number}).port;await new Promise<void>(resolve=>socket.close(()=>resolve()));
const directory=await mkdtemp(path.join(tmpdir(),"mycellios-message-pins-")),password=randomBytes(24).toString("hex");
const postgres=new EmbeddedPostgres({databaseDir:path.join(directory,"pg"),port,user:"postgres",password,persistent:true,createPostgresUser:false,initdbFlags:["--encoding=UTF8","--locale=C"],onLog:()=>{},onError:()=>{}});
let db:ReturnType<typeof createDb>|undefined;
try{
  await postgres.initialise();await postgres.start();
  const url=`postgresql://postgres:${password}@127.0.0.1:${port}/postgres`;
  await promisify(execFile)(process.execPath,[path.resolve("node_modules/prisma/build/index.js"),"db","push","--config","packages/db/prisma.config.ts"],{windowsHide:true,env:{...process.env,DATABASE_URL:url,DATABASE_MIGRATION_URL:url},maxBuffer:1024*1024});
  db=createDb(url,{encryptContent:false,applicationName:"synthetic-message-pins"});
  const prisma=db.prisma,system=asSystem(prisma,"synthetic pin fixtures");
  async function actor(name:string,shared?:{spaceId:string;organizationId:string}){
    const userId=name,organizationId=shared?.organizationId??`org-${name}`,spaceId=shared?.spaceId??`space-${name}`;
    await system.user.create({data:{id:userId,name,email:`${name}@example.invalid`}});
    if(!shared){await system.organization.create({data:{id:organizationId,name,slug:organizationId,createdAt:new Date()}});await system.space.create({data:{id:spaceId,organizationId,name}});}
    await system.member.create({data:{id:`member-${name}`,organizationId,userId,role:"owner",createdAt:new Date()}});
    await system.spaceMember.create({data:{id:`space-member-${name}`,organizationId,spaceId,userId,role:"owner",createdAt:new Date()}});
    return {spaceId,userId,organizationId,email:`${name}@example.invalid`,isDeploymentOwner:false};
  }
  const owner=await actor("owner"),stranger=await actor("stranger",owner),neighbor=await actor("neighbor");
  const bot=await system.bot.create({data:{id:"mico",spaceId:owner.spaceId,userId:owner.userId,name:"Synthetic",color:"#10B981",thread:{create:{spaceId:owner.spaceId,userId:owner.userId}}},include:{thread:true}});
  const thread=await system.thread.create({data:{id:"task",spaceId:owner.spaceId,userId:owner.userId,taskBotId:bot.id,projectKey:"mico:mico",taskKey:"mico-task:mico:one"}});
  await system.message.create({data:{id:"first",threadId:thread.id,seq:0,role:"user",blocks:[{kind:"text",text:"Mensaje importante"}]}});
  await system.message.create({data:{id:"other",threadId:bot.thread!.id,seq:0,role:"bot",blocks:[{kind:"text",text:"Otro chat"}]}});
  const sql=await db.pool.connect();
  // The current baseline already has memory's independently owned thread key.
  // Remove only the pin-owned objects; preserve memory foreign-key dependencies.
  try{await sql.query('DROP TABLE message_pins; DROP INDEX IF EXISTS "threads_id_spaceId_userId_key"; DROP INDEX "messages_id_threadId_key"');await sql.query(await readFile("packages/db/prisma/migrations/20261115160000_message_pins/migration.sql","utf8"));}finally{sql.release();}
  assert.equal(await system.message.count(),2);
  const handler={handler:(fn:unknown)=>fn};
  const routes=messagePinRoutes({deps:{prisma},authed:{threads:{pinned:handler,setPin:handler}}} as never);
  const call=<T>(fn:unknown,input:unknown,identity=owner)=>runAsTenant(identity,()=>(fn as (v:unknown)=>Promise<T>)({context:{actor:identity},input}));
  const target={botId:bot.id,taskThreadId:thread.id};
  await call(routes.setPin,{...target,messageId:"first",pinned:true});await call(routes.setPin,{...target,messageId:"first",pinned:true});
  let listed=await call<{threadId:string;pins:{messageId:string;preview:string}[]}>(routes.pinned,target);
  assert.equal(listed.pins.length,1);assert.equal(listed.pins[0]!.preview,"Mensaje importante");
  assert.equal((await call<{pins:unknown[]}>(routes.pinned,{botId:bot.id})).pins.length,0);
  for(const identity of [stranger,neighbor]){
    await assert.rejects(call(routes.setPin,{...target,messageId:"first",pinned:true},identity));
    await assert.rejects(call(routes.pinned,target,identity));
    assert.equal((await runAsTenant(identity,()=>listMessagePins(prisma,identity,thread.id))).length,0);
  }
  await assert.rejects(call(routes.setPin,{...target,messageId:"other",pinned:true}));
  await assert.rejects(system.$executeRaw`INSERT INTO message_pins ("messageId","threadId","spaceId","userId") VALUES ('other',${thread.id},${owner.spaceId},${owner.userId})`);
  await assert.rejects(system.$executeRaw`INSERT INTO message_pins ("messageId","threadId","spaceId","userId") VALUES ('first',${thread.id},${owner.spaceId},${stranger.userId})`);
  const second=await system.bot.create({data:{id:"second",spaceId:owner.spaceId,userId:owner.userId,name:"Second synthetic",color:"#10B981",thread:{create:{spaceId:owner.spaceId,userId:owner.userId}}}});
  const group=await system.chatGroup.create({data:{spaceId:owner.spaceId,userId:owner.userId,name:"Synthetic group",members:{create:[{botId:bot.id},{botId:second.id}]},thread:{create:{spaceId:owner.spaceId,userId:owner.userId}}},include:{thread:true}});
  await system.message.create({data:{id:"group-message",threadId:group.thread!.id,seq:0,role:"user",blocks:[{kind:"text",text:"Mensaje de grupo"}]}});
  await call(routes.setPin,{groupId:group.id,messageId:"group-message",pinned:true});
  assert.equal((await call<{pins:{preview:string}[]}>(routes.pinned,{groupId:group.id})).pins[0]!.preview,"Mensaje de grupo");
  assert.equal((await call<{pins:unknown[]}>(routes.pinned,target)).pins.length,1);
  await call(routes.setPin,{groupId:group.id,messageId:"group-message",pinned:false});
  await system.message.createMany({data:Array.from({length:100},(_,i)=>({id:`bulk-${i}`,threadId:thread.id,seq:i+1,role:"bot",blocks:[{kind:"text",text:`Synthetic ${i}`}]}))});
  await system.$executeRaw`INSERT INTO message_pins ("messageId","threadId","spaceId","userId") SELECT id,${thread.id},${owner.spaceId},${owner.userId} FROM messages WHERE id LIKE 'bulk-%' AND seq<=98`;
  const race=await Promise.allSettled(["bulk-98","bulk-99"].map(id=>runAsTenant(owner,()=>setMessagePin(prisma,owner,thread.id,id,true))));
  assert.equal(race.filter(result=>result.status==="fulfilled").length,1);assert.equal((await runAsTenant(owner,()=>listMessagePins(prisma,owner,thread.id))).length,100);
  await call(routes.setPin,{...target,messageId:"first",pinned:false});await call(routes.setPin,{...target,messageId:"first",pinned:false});
  assert.ok(await system.message.findUnique({where:{id:"first"}}));
  await system.message.delete({where:{id:"bulk-0"}});
  assert.equal((await runAsTenant(owner,()=>listMessagePins(prisma,owner,thread.id))).length,98);
  const rls=await db.pool.connect();
  try{
    await rls.query('CREATE ROLE pin_reader NOLOGIN; GRANT SELECT ON message_pins,threads,space_members TO pin_reader; GRANT INSERT ON message_pins TO pin_reader');
    await rls.query('BEGIN');await rls.query('SET LOCAL ROLE pin_reader');
    await rls.query("SELECT set_config('app.space_id',$1,true),set_config('app.user_id',$2,true)",[owner.spaceId,owner.userId]);
    assert.equal((await rls.query('SELECT count(*)::int n FROM message_pins')).rows[0].n,98);
    await rls.query("SELECT set_config('app.user_id',$1,true)",[stranger.userId]);
    assert.equal((await rls.query('SELECT count(*)::int n FROM message_pins')).rows[0].n,0);
    await assert.rejects(rls.query('INSERT INTO message_pins ("messageId","threadId","spaceId","userId") VALUES ($1,$2,$3,$4)',["first",thread.id,owner.spaceId,owner.userId]));
    await rls.query('ROLLBACK');
  }finally{await rls.query('ROLLBACK').catch(()=>{});rls.release();}
  const result={passed:true,checks:["actual additive migration preserves messages","durable idempotent pin/list","main and task conversation separation","group pins work independently","user and Space isolation","composite FK rejects wrong message/thread/owner","concurrent cap cannot exceed 100","unpin preserves original and message deletion cleans references","PostgreSQL RLS rejects another account"],modelsCalled:0,productionAccess:false,directory};
  await writeFile(path.join(directory,"result.json"),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{if(db){await db.prisma.$disconnect();await db.pool.end();}await postgres.stop();}
