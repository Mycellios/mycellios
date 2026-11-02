import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {applyProjectLocalEnvironment,projectRoot} from './project-local-env.mjs';

const mode = process.argv[2];
if (!['backend', 'web'].includes(mode)) throw new Error('Use project-local.mjs backend|web');
const env = applyProjectLocalEnvironment();
const require = createRequire(import.meta.url);
const args = mode === 'backend'
  ? ['--import', 'tsx', fileURLToPath(new URL('./project-local-backend.ts', import.meta.url))]
  : [path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js'), '--host', '127.0.0.1', '--port', '5192', '--strictPort'];
const child = spawn(process.execPath, args, {cwd: mode === 'web' ? path.join(projectRoot,'apps/web') : projectRoot, env, windowsHide:true,stdio:['ignore','inherit','inherit']});
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>child.kill(signal));
child.once('error',()=>{process.stderr.write('Local service could not launch\n');process.exit(1);});
child.once('exit',(code)=>process.exit(code ?? 1));
