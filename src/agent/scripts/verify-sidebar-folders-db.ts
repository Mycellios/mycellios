import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import EmbeddedPostgres from "embedded-postgres";

process.env.RAKAZO_PROJECT_LOCAL = "1";
process.env.CONTENT_ENCRYPTION = "off";
const { createDb, asSystem, runAsTenant, createRepos } = await import("@rakazo/db");
const server = createServer();
await new Promise<void>(resolve => server.listen(0,"127.0.0.1",resolve));
const port=(server.address() as {port:number}).port;
await new Promise<void>(resolve => server.close(()=>resolve()));
const directory=await mkdtemp(path.join(tmpdir(),"mycellios-sidebar-folders-"));
const password=randomBytes(24).toString("hex");
const postgres=new EmbeddedPostgres({databaseDir:path.join(directory,"pg"),port,user:"postgres",password,persistent:true,
  createPostgresUser:false,initdbFlags:["--encoding=UTF8","--locale=C"],autoRehydrateSymlinks:true,onLog:()=>{},onError:()=>{}});
let db: ReturnType<typeof createDb> | undefined;
const checks: string[]=[];
try {
  await postgres.initialise(); await postgres.start();
  const url=`postgresql://postgres:${password}@127.0.0.1:${port}/postgres`;
  await promisify(execFile)(process.execPath,[path.resolve("node_modules/prisma/build/index.js"),"db","push","--config","packages/db/prisma.config.ts"],
    {windowsHide:true,env:{...process.env,DATABASE_URL:url,DATABASE_MIGRATION_URL:url},maxBuffer:1024*1024});
  db=createDb(url,{encryptContent:false,applicationName:"synthetic-sidebar-folders"});
  const prisma=db.prisma,system=asSystem(prisma,"synthetic folder fixtures"),repos=createRepos(prisma);
  const fixtureId=randomUUID();
  async function actor(name:string,shared?:{spaceId:string;organizationId:string}) {
    const userId=`${name}-${fixtureId}`,organizationId=shared?.organizationId??`org-${userId}`,spaceId=shared?.spaceId??`space-${userId}`;
    await system.user.create({data:{id:userId,name,email:`${userId}@example.invalid`}});
    if(!shared){await system.organization.create({data:{id:organizationId,name,slug:organizationId,createdAt:new Date()}});
      await system.space.create({data:{id:spaceId,organizationId,name}});}
    await system.member.create({data:{id:`member-${userId}`,userId,organizationId,role:"owner",createdAt:new Date()}});
    await system.spaceMember.create({data:{id:`membership-${userId}`,userId,organizationId,spaceId,role:"owner",createdAt:new Date()}});
    return {userId,spaceId,organizationId,email:`${userId}@example.invalid`,isDeploymentOwner:false};
  }
  const owner=await actor("owner"),stranger=await actor("stranger"),neighbor=await actor("neighbor",owner);
  const call=<T>(action:()=>Promise<T>)=>runAsTenant(owner,action);
  const legacy=await system.botSection.create({data:{spaceId:owner.spaceId,userId:owner.userId,name:"Legacy",position:0}});
  const bot=await system.bot.create({data:{spaceId:owner.spaceId,userId:owner.userId,name:"Synthetic Mico",color:"#10B981",agentEngine:"codex",sectionId:legacy.id,thread:{create:{spaceId:owner.spaceId,userId:owner.userId}}},include:{thread:true}});
  const group=await system.chatGroup.create({data:{spaceId:owner.spaceId,userId:owner.userId,name:"Synthetic group",sectionId:legacy.id}});
  const sql=postgres.getPgClient();await sql.connect();
  try {
    // Simulate the exact pre-upgrade table, retaining an existing folder and chats.
    await sql.query('ALTER TABLE bot_sections DROP COLUMN "parentId" CASCADE');
    await sql.query('DROP INDEX "bot_sections_id_spaceId_userId_key"');
    await sql.query(await readFile("packages/db/prisma/migrations/20261115130000_sidebar_folders/migration.sql","utf8"));
  } finally {await sql.end();}
  assert.equal((await system.botSection.findUniqueOrThrow({where:{id:legacy.id}})).parentId,null);
  assert.equal((await system.bot.findUniqueOrThrow({where:{id:bot.id}})).sectionId,legacy.id);
  checks.push("real additive migration retains existing flat folders and Micos");
  const a=await call(()=>repos.createBotSection(owner,{name:"Finanzas"}));
  const b=await call(()=>repos.createBotSection(owner,{name:"Contabilidad",parentId:a.id}));
  const c=await call(()=>repos.createBotSection(owner,{name:"2026",parentId:b.id}));
  await assert.rejects(call(()=>repos.createBotSection(owner,{name:"Too deep",parentId:c.id})),/three levels/);
  assert.equal(await system.botSection.count({where:{name:"Too deep"}}),0);
  checks.push("standalone creation supports three levels and atomically rejects the fourth");
  for(const forbidden of [a.id,b.id,c.id]) await assert.rejects(call(()=>repos.updateBotSection(owner,{sectionId:a.id,parentId:forbidden})),/itself|subfolders/);
  const d=await call(()=>repos.createBotSection(owner,{name:"Marketing"}));
  await assert.rejects(call(()=>repos.updateBotSection(owner,{sectionId:a.id,parentId:d.id})),/three levels/);
  await call(()=>repos.updateBotSection(owner,{sectionId:b.id,name:"Administración"}));
  assert.equal((await system.botSection.findUniqueOrThrow({where:{id:b.id}})).parentId,a.id);
  checks.push("cycles, self moves and overflowing subtrees are rejected; rename preserves parent");
  for(const other of [stranger,neighbor]) {
    await assert.rejects(runAsTenant(other,()=>repos.createBotSection(other,{name:"Foreign",parentId:a.id})),/not found/i);
    await assert.rejects(runAsTenant(other,()=>repos.updateBotSection(other,{sectionId:a.id,parentId:null})),/not found/i);
    await assert.rejects(runAsTenant(other,()=>repos.deleteBotSection(other,{sectionId:a.id})),/not found/i);
  }
  await assert.rejects(system.botSection.create({data:{spaceId:owner.spaceId,userId:neighbor.userId,name:"FK probe",parentId:a.id}}));
  checks.push("API repositories and composite PostgreSQL FK reject foreign-user and foreign-Space parents");
  await call(()=>repos.createBotSection(owner,{name:"Administración",parentId:a.id,botId:bot.id}));
  await call(()=>repos.createBotSection(owner,{name:"Administración",parentId:a.id,groupId:group.id}));
  const threadId=bot.thread!.id;
  const removed=await call(()=>repos.deleteBotSection(owner,{sectionId:b.id}));
  assert.equal(removed.releasedBots,1);assert.equal(removed.releasedGroups,1);
  assert.equal((await system.botSection.findUniqueOrThrow({where:{id:c.id}})).parentId,a.id);
  assert.equal((await system.bot.findUniqueOrThrow({where:{id:bot.id}})).sectionId,a.id);
  assert.equal((await system.chatGroup.findUniqueOrThrow({where:{id:group.id}})).sectionId,a.id);
  assert.ok(await system.thread.findUnique({where:{id:threadId}}));
  await call(()=>repos.deleteBotSection(owner,{sectionId:a.id}));
  assert.equal((await system.botSection.findUniqueOrThrow({where:{id:c.id}})).parentId,null);
  assert.equal((await system.bot.findUniqueOrThrow({where:{id:bot.id}})).sectionId,null);
  assert.equal((await system.chatGroup.findUniqueOrThrow({where:{id:group.id}})).sectionId,null);
  checks.push("deleting child/root promotes subfolders, Micos and groups without deleting their thread");
  const x=await call(()=>repos.createBotSection(owner,{name:"X"})),y=await call(()=>repos.createBotSection(owner,{name:"Y"}));
  const race=await Promise.allSettled([call(()=>repos.updateBotSection(owner,{sectionId:x.id,parentId:y.id})),call(()=>repos.updateBotSection(owner,{sectionId:y.id,parentId:x.id}))]);
  assert.equal(race.filter(r=>r.status==="fulfilled").length,1);assert.equal(race.filter(r=>r.status==="rejected").length,1);
  checks.push("concurrent reciprocal moves serialize and cannot create a cycle");
  const result={passed:true,checks,productionAccess:false,modelsCalled:false,directory};
  await writeFile(path.join(directory,"result.json"),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
} finally {
  if(db){await db.prisma.$disconnect();await db.pool.end();}
  await postgres.stop();
}
