import {spawnSync} from 'node:child_process';
import path from 'node:path';
if(process.platform==='win32')throw Error('Remote-only validation; preserve the running Windows checkout and dependencies.');
const root=process.cwd(), agent=path.join(root,'src/agent');
function run(program,args,cwd){const r=spawnSync(program,args,{cwd,stdio:'inherit',env:process.env});if(r.status!==0)process.exit(r.status??1);}
run('npm',['ci','--ignore-scripts','--no-audit','--no-fund'],agent);
run('npx',['vitest','run','apps/web/src/components/BrowserContributionControl.test.tsx','apps/web/src/components/SidebarContribution.test.tsx','apps/web/src/components/MycelliosCredits.test.tsx','apps/web/src/lib/update-mycelium.test.ts'],agent);
run('npx',['tsc','--noEmit','-p','apps/web/tsconfig.json'],agent);
run('npx',['vitest','run','tests/mobile-backend-state.test.ts','tests/mobile-compute-hub.test.ts'],root);
run('npm',['run','build','--workspace','@rakazo/web'],agent);
