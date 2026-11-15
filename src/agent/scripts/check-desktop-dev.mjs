import {spawn} from 'node:child_process';
import path from 'node:path';
const npm=process.env.npm_execpath||path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
async function run(command,args,env=process.env) {
  const child=spawn(command,args,{stdio:'inherit',windowsHide:true,env});
  await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error(`Check failed (${code})`)));});
}
await run(process.execPath,['--test','scripts/desktop-dev-state.test.mjs','scripts/project-local-env.test.mjs','scripts/desktop-dev-preview.test.mjs']);
await run(process.execPath,[npm,'exec','--','vitest','run','apps/desktop/src/development-launcher.test.ts','apps/desktop/src/development-launcher-lifecycle.test.ts','apps/desktop/src/development-copy.test.ts','apps/desktop/src/preload.test.ts','apps/web/src/components/OpenMycelliosDev.test.tsx','apps/web/src/components/LanguageEntry.test.tsx']);
await run(process.execPath,[npm,'run','check','--workspace','@rakazo/desktop']);
// TypeScript 7's Go compiler otherwise fans out across every CPU and can exceed
// the local validation job's memory budget on this large shared renderer graph.
await run(process.execPath,[npm,'exec','--','tsc','--noEmit','--incremental','--tsBuildInfoFile','data/development-preparation/web.tsbuildinfo','-p','apps/web/tsconfig.json'],{...process.env,GOMAXPROCS:'2',GOMEMLIMIT:'1024MiB'});
