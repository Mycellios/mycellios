#!/usr/bin/env node
// An isolated, source-owned development stack. No .env or production identity.
import {spawn, execFileSync} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {createServer} from 'node:http';
import {lstat,mkdir, readFile, rm, writeFile, unlink} from 'node:fs/promises';
import {createRequire} from 'node:module';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {authorizedControl, developmentIdentity, freeDevelopmentPorts, installedDevelopmentDependencies, preparationFingerprint} from './desktop-dev-state.mjs';
import {projectLocalEnvironment} from './project-local-env.mjs';
import {seedDevelopmentPreview} from './desktop-dev-preview.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const identity = await developmentIdentity(root);
const profileBase = process.env.MYCELLIOS_DEV_HOME || path.join(os.homedir(), '.mycellios', 'development');
const profile = path.join(profileBase, identity.id);
const lockFile = path.join(profile, 'stack.json');
await mkdir(profile, {recursive:true, mode:0o700});
const action = process.argv[2] ?? 'open';
if (!['open', 'prepare', 'status', 'stop', 'reset', '--headless'].includes(action)) throw Error('Use desktop-dev.mjs [open|prepare|status|stop|reset|--headless]');
const preparedOnly=process.argv.includes('--prepared');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function control(record, command) {
  if (record.id !== identity.id || !Number.isInteger(record.control) || record.control < 1024 || record.control > 65535 || !/^[a-f0-9]{64}$/.test(record.token)) return false;
  try {
    const response = await fetch(`http://127.0.0.1:${record.control}/${command}`, {
      method:'POST', headers:{authorization:`Bearer ${record.token}`}, redirect:'error', signal:AbortSignal.timeout(1500),
    });
    return response.ok && (await response.json()).id === identity.id;
  } catch {return false;}
}
let previous;
try {previous=JSON.parse(await readFile(lockFile,'utf8'));} catch (error) {if (error.code !== 'ENOENT') throw Error('Invalid Dev registry; its contents have been preserved.');}
if (previous && await control(previous, action === 'stop' ? 'stop' : action === 'status' || action === 'reset' ? 'status' : 'focus')) {
  if (action === 'reset') throw Error('Mycellios Dev is running. Run npm run dev:stop before resetting it.');
  console.log(action === 'stop' ? 'Mycellios Dev stopping.' : 'Mycellios Dev already running.');
  process.exit(0);
}
if (action === 'status' || action === 'stop') {console.log('Mycellios Dev is not running.'); process.exit(action === 'status' ? 1 : 0);}
if (action === 'reset') {
  // Deletes only this checkout's profile, and never while one of its processes may still own it.
  const alive=pid=>{if(!Number.isInteger(pid)||pid<=0)return false;try{process.kill(pid,0);return true;}catch(error){return error.code!=='ESRCH';}};
  const serverPid=Number(await readFile(path.join(profile,'data','server.lock'),'utf8').catch(()=>'0'));
  if ((previous && alive(previous.pid)) || alive(serverPid)) throw Error('A Mycellios Dev process still owns this profile. Stop it first; nothing was deleted.');
  if (path.dirname(profile)!==path.resolve(profileBase) || !path.basename(profile).startsWith('wt-')) throw Error('Unexpected development profile path; nothing was deleted.');
  console.log(`Deleting the Mycellios Dev profile: ${profile}`);
  await rm(profile,{recursive:true,force:true});
  console.log('Done. The next npm run dev:desktop creates and seeds a new profile.');
  process.exit(0);
}
if (previous) {
  // Never kill a stale PID, or steal a lock while its owner may still be preparing.
  let alive=true;
  if (!Number.isInteger(previous.pid) || previous.pid <= 0) throw Error('Invalid Dev registry; preserved.');
  try {process.kill(previous.pid,0);} catch (error) {if(error.code==='ESRCH')alive=false;}
  if (alive) throw Error('Mycellios Dev is starting or unavailable. Its processes have been preserved.');
  const current=JSON.parse(await readFile(lockFile,'utf8'));
  if(current.token!==previous.token)throw Error('The Dev registry changed. Try opening it again.');
  await unlink(lockFile);
}
const token = randomBytes(32).toString('hex');
const record = {id:identity.id,pid:process.pid,token,control:0};
await writeFile(lockFile,JSON.stringify(record),{flag:'wx',mode:0o600});
let stopping=false, appChild, phase='preparing';
const children=new Set();
const controlServer=createServer((req,res)=>{
  if(!authorizedControl(req,record.control,token)||!['/focus','/status','/stop'].includes(req.url)) {res.writeHead(403);res.end();return;}
  if(req.url==='/focus' && phase!=='ready'){res.writeHead(503);res.end();return;}
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({id:identity.id,phase,...(record.web?{web:record.web}:{})}));
  if(req.url==='/stop')void stop(0);
  else if(req.url==='/focus'&&appChild?.connected)appChild.send({type:'mycellios-dev-focus'},()=>{});
});
async function terminate(child) {
  if(child.exitCode!==null||child.signalCode!==null||!child.pid)return;
  if(child.connected) {
    child.send({type:'mycellios-dev-stop'},()=>{});
    await Promise.race([new Promise(resolve=>child.once('exit',resolve)),wait(5000)]);
    if(child.exitCode!==null||child.signalCode!==null)return;
  }
  if(process.platform==='win32') {
    // Only a still-owned ChildProcess tree; never a registry PID or a port owner.
    await new Promise(resolve=>{const killer=spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});killer.once('error',resolve);killer.once('exit',resolve);});
  } else {
    try {process.kill(-child.pid,'SIGTERM');} catch {}
    await Promise.race([new Promise(resolve=>child.once('exit',resolve)),wait(3000)]);
    try {process.kill(-child.pid,'SIGKILL');} catch {}
  }
}
async function stop(code) {
  if(stopping)return;stopping=true;
  await Promise.all([...children].map(terminate));
  controlServer.close();
  try {if(JSON.parse(await readFile(lockFile,'utf8')).token===token)await unlink(lockFile);}catch{}
  process.exit(code);
}
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void stop(0));
process.on('message',message=>{if(message?.type==='mycellios-dev-stop')void stop(0);});
if(process.connected)process.once('disconnect',()=>void stop(0));
process.once('uncaughtException',error=>{console.error(error.message);void stop(1);});
process.once('unhandledRejection',error=>{console.error(error instanceof Error?error.message:'Development startup failed');void stop(1);});
await new Promise((resolve,reject)=>{controlServer.once('error',reject);controlServer.listen(0,'127.0.0.1',resolve);});
record.control=controlServer.address().port;
await writeFile(lockFile,JSON.stringify(record),{mode:0o600});
const parent=Number(process.env.MYCELLIOS_DEV_PARENT_PID);
if(Number.isInteger(parent)&&parent>0)setInterval(()=>{try{process.kill(parent,0);}catch(error){if(error.code==='ESRCH')void stop(0);}},2000).unref();
const ports=await freeDevelopmentPorts();
const descriptor=JSON.stringify({...ports,data:path.join(profile,'data')});
const env=projectLocalEnvironment({...process.env,MYCELLIOS_DEV_STACK:descriptor});
// The launcher owns these paths. User model/SSO/database settings stay excluded.
const require=createRequire(import.meta.url);
function launch(command,args,options={}) {
  const child=spawn(command,args,{cwd:root,env,windowsHide:true,detached:process.platform!=='win32',stdio:['ignore','inherit','inherit'],...options});
  children.add(child);child.once('exit',()=>children.delete(child));
  return child;
}
async function run(command,args,options) {
  const child=launch(command,args,options);
  await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error(`Development preparation failed (exit ${code})`)));});
}
async function ready(url,child) {
  const until=Date.now()+180000;
  while(Date.now()<until&&!stopping) {
    if(child.exitCode!==null||child.signalCode!==null)throw Error('A development service stopped before it became ready.');
    try {if((await fetch(url,{redirect:'error',signal:AbortSignal.timeout(1500)})).ok)return;}catch{}
    await wait(300);
  }
  throw Error('Development startup timed out. See the Dev log.');
}
try {
  const npm=process.env.MYCELLIOS_DEV_NPM_CLI||process.env.npm_execpath||path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
  if(!npm.endsWith('npm-cli.js'))throw Error('A bundled npm CLI is required.');
  // Installations belong to the source, not to a temporary app/profile. A new
  // qualification profile must not reinstall the identical locked dependencies.
  const preparation=path.join(root,'data/development-preparation');await mkdir(preparation,{recursive:true,mode:0o700});
  async function prepare(folder,name,generate=false) {
    const fingerprint=await preparationFingerprint(folder),stamp=path.join(preparation,`${name}.json`);
    let previous;try{previous=JSON.parse(await readFile(stamp,'utf8'));}catch{}
    if(previous?.fingerprint===fingerprint && previous?.node===process.versions.node && await installedDevelopmentDependencies(folder))return;
    if(preparedOnly)throw Error('Development inputs changed. Run npm run dev:desktop -- prepare first.');
    if(previous || !await installedDevelopmentDependencies(folder)) {
      if(await lstat(path.join(folder,'node_modules')).then(info=>info.isSymbolicLink(),()=>false))
        throw Error('The reused dependency cache differs. It has been preserved; use an owned installation.');
      await run(process.execPath,[npm,'ci','--include=dev','--no-audit','--no-fund'],{cwd:folder});
    }
    if(generate)await run(process.execPath,[npm,'run','db:generate']);
    await writeFile(stamp,JSON.stringify({fingerprint,node:process.versions.node}),{mode:0o600});
  }
  await prepare(root,'agent',true);
  const nativeRoot=path.resolve(root,'../..');
  let nativePackage;try{nativePackage=JSON.parse(await readFile(path.join(nativeRoot,'package.json'),'utf8'));}catch{}
  if(nativePackage?.name==='mycellios')await prepare(nativeRoot,'network');
  const desktopStamp=path.join(preparation,'desktop.json');
  const {releaseInputs}=await import('../apps/desktop/scripts/release-continuity.mjs');
  const desktopEntry=path.join(root,'apps/desktop/dist/main.js');
  async function prepareDesktop() {
    const current=await releaseInputs(root);
    let cached=false;
    try {
      const stamp=JSON.parse(await readFile(desktopStamp,'utf8'));
      cached=stamp.sourceHash===current.sourceHash && stamp.version===current.version &&
        stamp.entryHash===createHash('sha256').update(await readFile(desktopEntry)).digest('hex');
    }catch{}
    if(!cached) {
      if(preparedOnly)throw Error('Development sources changed. Run npm run dev:desktop -- prepare first.');
      await run(process.execPath,['scripts/build.mjs'],{cwd:path.join(root,'apps/desktop')});
      const inputs=await releaseInputs(root);
      await writeFile(desktopStamp,JSON.stringify({...inputs,entryHash:createHash('sha256').update(await readFile(desktopEntry)).digest('hex')}),{mode:0o600});
    }
    try{require('electron');}catch{
      if(preparedOnly)throw Error('The Electron runtime is missing. Prepare development first.');
      await run(process.execPath,[require.resolve('electron/install.js')]);
    }
  }
  if(action==='prepare') {
    await prepareDesktop();console.log('MYCELLIOS_DEV_PREPARED');await stop(0);
  }
  const backend=launch(process.execPath,['scripts/project-local.mjs','backend'],{stdio:['ignore','inherit','inherit','ipc']});
  const web=launch(process.execPath,['scripts/project-local.mjs','web'],{stdio:['ignore','inherit','inherit','ipc']});
  for(const [role,child] of [['backend',backend],['web',web]]) {
    child.once('error',error=>{console.error(`Dev ${role} launch failed: ${error.message}`);void stop(1);});
    child.once('exit',(code,signal)=>{if(!stopping){console.error(`Dev ${role} stopped before shutdown (exit ${code}, signal ${signal??'none'}).`);void stop(1);}});
  }
  await Promise.all([ready(`http://127.0.0.1:${ports.ready}/ready`,backend),ready(`http://127.0.0.1:${ports.web}/@vite/client`,web)]);
  const url=`http://127.0.0.1:${ports.web}`;
  // dev:seed finds this stack through the registry and confirms it on the control port.
  record.web=url;await writeFile(lockFile,JSON.stringify(record),{mode:0o600});
  // This throwaway identity is local to this profile and has no real model keys.
  const accountFile=path.join(profile,'account.json');
  let account;
  try {account=JSON.parse(await readFile(accountFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;account={email:'developer@mycellios.invalid',password:randomBytes(32).toString('hex')};}
  const auth=async action=>fetch(`${url}/api/auth/${action}/email`,{method:'POST',redirect:'error',headers:{'content-type':'application/json',origin:url},body:JSON.stringify({...account,name:'Developer'}),signal:AbortSignal.timeout(10000)});
  let authentication=await auth('sign-in'),createdAccount=false;
  if(!authentication.ok) {
    authentication=await auth('sign-up');
    if(!authentication.ok)throw Error('Could not prepare the isolated development account.');
    await writeFile(accountFile,JSON.stringify(account),{flag:'wx',mode:0o600});
    createdAccount=true;
  }
  const user=(await authentication.json()).user;
  const cookie=authentication.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
  await seedDevelopmentPreview({url,profile,user,cookie});
  // A profile this launch created starts with realistic data, as npm run dev:seed writes it.
  if(createdAccount)await run(process.execPath,['--import','tsx','scripts/desktop-dev-seed.ts','--if-missing'],{env:{...env,MYCELLIOS_DEV_HOME:profileBase}});
  let branch='local';
  try{branch=execFileSync('git',['branch','--show-current'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim()||'detached';}catch{}
  if(action!=='--headless') {
    await prepareDesktop();
    const electron=require('electron');
    appChild=launch(electron,[path.join(root,'apps/desktop')],{windowsHide:false,env:{...env,RAKAZO_WEB_URL:url,RAKAZO_LOCAL_WEB_URL:url,RAKAZO_PERFORMANCE_USER_DATA:path.join(profile,'app'),MYCELLIOS_DEV_ACCOUNT:accountFile,MYCELLIOS_DEV_BRANCH:branch,MYCELLIOS_DEV_HUE:String(identity.hue)},stdio:['ignore','inherit','inherit','ipc']});
    appChild.once('error',()=>void stop(1));appChild.once('exit',()=>void stop(0));
    await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(Error('The Mycellios Dev window did not become ready.')),180000);
      const finish=error=>{clearTimeout(timeout);appChild.off('message',message);appChild.off('exit',exited);error?reject(error):resolve();};
      const message=value=>{if(value?.type==='mycellios-dev-window-ready')finish();};
      const exited=()=>finish(Error('The Mycellios Dev window stopped during startup.'));
      appChild.on('message',message);appChild.once('exit',exited);
    });
  }
  phase='ready';
  console.log('MYCELLIOS_DEV_READY '+JSON.stringify({id:identity.id,url,branch,hue:identity.hue}));
} catch(error) {console.error(error instanceof Error?error.message:'Development startup failed');await stop(1);}
