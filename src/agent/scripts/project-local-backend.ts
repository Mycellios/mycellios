import {startDevIdentityCallback} from './project-local-sso.mjs';
import {spawn} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {mkdir,readdir,readFile,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {applyProjectLocalEnvironment,localDataDir,projectRoot,localWorkerReady} from './project-local-env.mjs';

applyProjectLocalEnvironment();
await mkdir(localDataDir,{recursive:true,mode:0o700});
// Bind readiness first: a different project already owning this port is never adopted.
let callbackServer: Awaited<ReturnType<typeof startDevIdentityCallback>> | undefined;
let workerReady = false;
let workerStartedAt = 0;
const readiness = createServer(async(req,res)=>{
  if(req.method!=='GET'||req.url!=='/ready'||req.headers.host!=='127.0.0.1:3101'){
    res.writeHead(404);res.end();return;
  }
  try {
    const health=JSON.parse(await readFile(path.join(localDataDir,'worker-health.json'),'utf8'));
    workerReady=localWorkerReady(health,workerStartedAt,Boolean(worker && worker.exitCode===null));
  } catch {workerReady=false;}
  let apiReady=false;
  if(workerReady)try{apiReady=(await fetch('http://127.0.0.1:3100/ready',{signal:AbortSignal.timeout(1000)})).ok;}catch{}
  res.writeHead(apiReady?200:503,{'content-type':'application/json'});
  res.end(JSON.stringify({ok:apiReady,worker:workerReady}));
});
await new Promise<void>((resolve,reject)=>{readiness.once('error',reject);readiness.listen(3101,'127.0.0.1',resolve);});
const {startDesktopLocalServer} = await import('../apps/api/src/desktop-local-server.js');
let server: Awaited<ReturnType<typeof startDesktopLocalServer>> | undefined;
let worker: ReturnType<typeof spawn> | undefined;
let stopping=false;
async function stop(code=0){
  if(stopping)return;stopping=true;workerReady=false;
  readiness.close();
  callbackServer?.close();
  if(worker?.exitCode===null){
    worker.kill('SIGTERM');
    await Promise.race([new Promise(resolve=>worker!.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,2500))]);
  }
  await server?.close();
  process.exit(code);
}
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>void stop());
try {
  // Snapshot actual SQL, ignoring only empty uncommitted draft directories.
  // A malformed nonempty migration fails instead of silently changing the schema.
  const schema=path.join(projectRoot,'packages/db/prisma');
  const migrations: Array<{name:string;sql:string}> = [];
  for(const entry of (await readdir(path.join(schema,'migrations'),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
    if(!entry.isDirectory())continue;
    const directory=path.join(schema,'migrations',entry.name),files=await readdir(directory);
    if(!files.length)continue;
    if(!files.includes('migration.sql'))throw new Error('A nonempty migration is missing SQL');
    migrations.push({name:entry.name,sql:await readFile(path.join(directory,'migration.sql'),'utf8')});
  }
  const snapshot=path.join(localDataDir,'schema',createHash('sha256').update(JSON.stringify(migrations)).digest('hex'));
  for(const migration of migrations){
    const directory=path.join(snapshot,'migrations',migration.name);
    await mkdir(directory,{recursive:true});await writeFile(path.join(directory,'migration.sql'),migration.sql);
  }
  await writeFile(path.join(snapshot,'migrations/migration_lock.toml'),'provider = "postgresql"\n');
  const migrationConfig=path.join(snapshot,'prisma.config.mjs');
  await writeFile(migrationConfig,`export default {schema:${JSON.stringify(path.join(schema,'schema.prisma'))},migrations:{path:${JSON.stringify(path.join(snapshot,'migrations'))}},datasource:{url:process.env.DATABASE_MIGRATION_URL}};\n`);
  server=await startDesktopLocalServer({dataDir:localDataDir,webRoot:path.join(projectRoot,'apps/web/dist'),migrationsRoot:snapshot,port:3100,token:randomBytes(32).toString('hex'),build:'project-local',projectPreview:{webOrigin:'http://127.0.0.1:5192',migrationConfig,...(process.env.MYCELLIOS_LOCAL_ACCOUNT_ENABLED==='1'?{authOrigin:'http://127.0.0.1:5188'}:{})}});
  if(process.env.MYCELLIOS_LOCAL_ACCOUNT_ENABLED==='1') callbackServer=await startDevIdentityCallback();
  workerStartedAt=Date.now();
  worker=spawn(process.execPath,['--import','tsx',path.join(projectRoot,'apps/worker/src/index.ts')],{cwd:projectRoot,env:{...process.env},windowsHide:true,stdio:['ignore','pipe','pipe']});
  for(const output of [worker.stdout,worker.stderr])output?.on('data',(data:Buffer)=>{
    process.stdout.write(data);
  });
  worker.once('error',()=>void stop(1));
  worker.once('exit',()=>{if(!stopping)void stop(1);});
  console.log('Local API/database started; waiting for worker readiness. Data stays in data/project-preview.');
} catch(error){
  console.error(error instanceof Error?error.message:'Local backend startup failed');
  await stop(1);
}
