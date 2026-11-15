import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {applyProjectLocalEnvironment,projectRoot} from './project-local-env.mjs';

const mode = process.argv[2];
if (!['backend', 'web'].includes(mode)) throw new Error('Use project-local.mjs backend|web');
const env = applyProjectLocalEnvironment({account: mode === 'backend'});
if (mode === 'web') {
  // Apply before the child loads Rolldown/Tailwind native libraries. Keep the
  // interactive PC responsive and return unused native pages promptly.
  Object.assign(env, {
    ROLLDOWN_WORKER_THREADS: '2',
    RAYON_NUM_THREADS: '2',
    MIMALLOC_PURGE_DELAY: '0',
    MIMALLOC_ARENA_EAGER_COMMIT: '0',
  });
}
const require = createRequire(import.meta.url);
const args = mode === 'backend'
  ? ['--import', 'tsx', fileURLToPath(new URL('./project-local-backend.ts', import.meta.url))]
  : [path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js'), '--host', '127.0.0.1', '--port', env.WEB_PORT, '--strictPort'];
const child = spawn(process.execPath, args, {cwd: mode === 'web' ? path.join(projectRoot,'apps/web') : projectRoot, env, windowsHide:true,stdio:env.MYCELLIOS_DEV_STACK&&mode==='backend'?['ignore','inherit','inherit','ipc']:['ignore','inherit','inherit']});
let stopping=false;
function stop() {
  if(stopping)return;stopping=true;
  if(child.connected)child.send({type:'mycellios-dev-stop'},()=>{});else child.kill('SIGTERM');
  if(env.MYCELLIOS_DEV_STACK)setTimeout(()=>{
    if(child.exitCode!==null||child.signalCode!==null)return;
    if(process.platform==='win32')spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
    else child.kill('SIGKILL');
  },4000).unref();
}
if(env.MYCELLIOS_DEV_STACK) {
  const parent=process.ppid;
  setInterval(()=>{try{process.kill(parent,0);}catch(error){if(error.code==='ESRCH')stop();}},2000).unref();
  process.on('message',message=>{if(message?.type==='mycellios-dev-stop')stop();});
  if(process.connected)process.once('disconnect',stop);
}
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,stop);
child.once('error',()=>{process.stderr.write('Local service could not launch\n');process.exit(1);});
child.once('exit',(code)=>process.exit(code ?? 1));
