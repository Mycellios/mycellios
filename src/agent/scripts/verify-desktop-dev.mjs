// Offline-account qualification: real local DB/API/worker/Vite; no model requests.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile,unlink,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {developmentIdentity} from './desktop-dev-state.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const home=await mkdtemp(path.join(os.tmpdir(),'mycellios-dev-qualification-'));
const identity=await developmentIdentity(root);
const profile=path.join(home,identity.id);
const probe=path.join(root,'apps/web/src',`development-probe-${process.pid}.ts`);
const child=spawn(process.execPath,['scripts/desktop-dev.mjs',...(process.argv.includes('--window')?[]:['--headless'])],{cwd:root,env:{...process.env,MYCELLIOS_DEV_HOME:home},stdio:['ignore','pipe','pipe']});
let output='';child.stderr.on('data',data=>process.stderr.write(data));
child.stdout.on('data',data=>{output=(output+data).slice(-64000);process.stdout.write(data);});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try {
  const until=Date.now()+600000;
  while(!output.includes('MYCELLIOS_DEV_READY ') && child.exitCode===null && Date.now()<until)await wait(250);
  assert.equal(child.exitCode,null,'Dev exited during startup');
  const match=output.match(/MYCELLIOS_DEV_READY (\{[^\n]+\})/);assert.ok(match,'Dev did not become ready');
  const ready=JSON.parse(match[1]);assert.equal(ready.id,identity.id);
  const record=JSON.parse(await readFile(path.join(profile,'stack.json'),'utf8'));
  const account=JSON.parse(await readFile(path.join(profile,'account.json'),'utf8'));
  const login=await fetch(`${ready.url}/api/auth/sign-in/email`,{method:'POST',headers:{'content-type':'application/json',origin:ready.url},body:JSON.stringify(account)});
  assert.equal(login.ok,true,'Isolated account can sign in');
  const cookie=login.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
  assert.ok(cookie,'Sign-in supplies its own session cookie');
  const session=await fetch(`${ready.url}/api/auth/get-session`,{headers:{cookie}});
  assert.equal((await session.json()).user.email,'developer@mycellios.invalid');
  const anonymous=await fetch(`${ready.url}/api/auth/get-session`);assert.equal(await anonymous.json(),null);
  const client=await (await fetch(`${ready.url}/@vite/client`)).text();
  assert.ok(client.includes('WebSocket'),'Real Vite HMR client served');
  const {WebSocket}=await import('ws');
  const token=client.match(/(?:const|let) wsToken = ["']([^"']+)["']/)?.[1];assert.ok(token,'Vite websocket token found');
  const socket=new WebSocket(`${ready.url.replace('http:','ws:')}/?token=${encodeURIComponent(token)}`,'vite-hmr',{headers:{Origin:ready.url}});
  await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);setTimeout(()=>reject(Error('HMR socket timeout')),5000).unref();});
  try {
    await writeFile(probe,'export const developmentProbe = 1;\n');
    assert.equal((await fetch(`${ready.url}/src/${path.basename(probe)}`)).ok,true);
    const update=new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('No HMR update received')),8000);socket.on('message',data=>{const text=String(data);if(text.includes(path.basename(probe))||text.includes('full-reload')){clearTimeout(timeout);resolve();}});});
    await wait(300);await writeFile(probe,'export const developmentProbe = 2;\n');await update;
    const changed=await (await fetch(`${ready.url}/src/${path.basename(probe)}?t=${Date.now()}`)).text();assert.ok(changed.includes('developmentProbe = 2'));
  } finally {socket.close();}
  console.log('VERIFIED: isolated real account, anonymous-session isolation, API/worker readiness, Vite and live source update. No paid model requests.');
  // Unit/type checks run separately through check-desktop-dev.mjs; do not keep
  // the database and browser toolchain alive while checking unrelated modules.
  const stopped=await fetch(`http://127.0.0.1:${record.control}/stop`,{method:'POST',headers:{authorization:`Bearer ${record.token}`}});assert.equal(stopped.ok,true);
  await Promise.race([new Promise(resolve=>child.once('exit',resolve)),wait(15000)]);
  assert.equal(child.exitCode,0,'Owned stack stops cleanly');
  await assert.rejects(fetch(`${ready.url}/@vite/client`,{signal:AbortSignal.timeout(1000)}));
  console.log('VERIFIED: owned services stop and the UI endpoint is gone.');
} finally {
  try {
    const record=JSON.parse(await readFile(path.join(profile,'stack.json'),'utf8'));
    await fetch(`http://127.0.0.1:${record.control}/stop`,{method:'POST',headers:{authorization:`Bearer ${record.token}`},signal:AbortSignal.timeout(1000)});
  }catch{}
  if(child.exitCode===null) {child.kill('SIGTERM');await Promise.race([new Promise(resolve=>child.once('exit',resolve)),wait(10000)]);}
  await unlink(probe).catch(()=>{});
  if(child.exitCode!==null)await rm(home,{recursive:true,force:true});
}
