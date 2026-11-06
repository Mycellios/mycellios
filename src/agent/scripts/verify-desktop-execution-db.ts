import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmod, mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import EmbeddedPostgres from "embedded-postgres";

process.env.RAKAZO_PROJECT_LOCAL = "1";
const socket=createServer();await new Promise<void>(resolve=>socket.listen(0,"127.0.0.1",resolve));
const port=(socket.address() as {port:number}).port;await new Promise<void>(resolve=>socket.close(()=>resolve()));
const directory=await mkdtemp(path.join(tmpdir(),"mycellios-desktop-execution-db-"));
const password=randomBytes(24).toString("hex");
const isolatedRoot=process.getuid?.()===0&&process.env.NC_LOCAL_OFFLOAD==="1";
if(isolatedRoot)await chmod(directory,0o755);
const database=new EmbeddedPostgres({databaseDir:path.join(directory,"pg"),port,user:"postgres",password,persistent:true,createPostgresUser:isolatedRoot,initdbFlags:["--encoding=UTF8","--locale=C"],autoRehydrateSymlinks:true,onLog:()=>{},onError:()=>{}});
try{
 await database.initialise();await database.start();
 const url=`postgresql://postgres:${password}@127.0.0.1:${port}/postgres`;
 await promisify(execFile)(process.execPath,[path.resolve("node_modules/prisma/build/index.js"),"db","push","--config","packages/db/prisma.config.ts"],{env:{...process.env,DATABASE_URL:url,DATABASE_MIGRATION_URL:url},maxBuffer:1024*1024});
 const sql=database.getPgClient();await sql.connect();
 try{
  await sql.query('DROP TABLE "desktop_execution_preferences"');
  await sql.query(await readFile("packages/db/prisma/migrations/20261106220000_desktop_execution/migration.sql","utf8"));
  const {createDb,asSystem}=await import("@rakazo/db");const db=createDb(url,{encryptContent:false});
  try{
   const system=asSystem(db.prisma),now=new Date();
   for(const id of ["owner","other"])await system.user.create({data:{id,name:id,email:`${id}@example.invalid`,createdAt:now,updatedAt:now}});
   await system.organization.create({data:{id:"org",name:"fixture",slug:"fixture",createdAt:now}});
   for(const userId of ["owner","other"])await system.member.create({data:{id:`member-${userId}`,organizationId:"org",userId,role:"owner",createdAt:now}});
   for(const id of ["one","two"])await system.space.create({data:{id,organizationId:"org",name:id,createdAt:now}});
   for(const [spaceId,userId] of [["one","owner"],["one","other"],["two","owner"]])await system.spaceMember.create({data:{id:`${spaceId}-${userId}`,spaceId:spaceId!,userId:userId!,organizationId:"org",role:"owner",createdAt:now}});
   for(const [spaceId,userId] of [["one","owner"],["one","other"],["two","owner"]])await system.desktopExecutionPreference.create({data:{spaceId:spaceId!,userId:userId!,enabled:true}});
  }finally{await db.prisma.$disconnect();await db.pool.end();}
  await sql.query("CREATE ROLE desktop_execution_probe NOLOGIN");await sql.query("GRANT USAGE ON SCHEMA public TO desktop_execution_probe");await sql.query("GRANT SELECT,INSERT,UPDATE ON desktop_execution_preferences TO desktop_execution_probe");
  await sql.query("SET ROLE desktop_execution_probe");
  await sql.query("SELECT set_config('app.space_id','one',false),set_config('app.user_id','owner',false)");
  assert.equal((await sql.query('SELECT * FROM desktop_execution_preferences')).rowCount,1);
  await assert.rejects(sql.query('INSERT INTO desktop_execution_preferences("spaceId","userId","enabled") VALUES($1,$2,true)',["two","other"]));
  await sql.query("SELECT set_config('app.user_id','foreign',false)");assert.equal((await sql.query('SELECT * FROM desktop_execution_preferences')).rowCount,0);
  await sql.query("RESET ROLE");
  await sql.query('DELETE FROM space_members WHERE "spaceId"=$1 AND "userId"=$2',["one","owner"]);
  assert.equal((await sql.query('SELECT * FROM desktop_execution_preferences WHERE "spaceId"=$1 AND "userId"=$2',["one","owner"])).rowCount,0);
  assert.equal((await sql.query('SELECT * FROM "user"')).rowCount,2);
  assert.equal((await sql.query('SELECT * FROM spaces')).rowCount,2);
  console.log("Desktop execution additive migration, Prisma access, real RLS, cross-owner rejection and membership revocation passed on isolated PostgreSQL");
 }finally{await sql.end();}
}finally{await database.stop();}
