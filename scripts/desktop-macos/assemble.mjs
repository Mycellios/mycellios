import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

// Assemble from the hash-pinned, already published native baseline. Never import
// unrelated files from a developer checkout into a release.
const here=path.dirname(fileURLToPath(import.meta.url));
const repository=path.resolve(here,'../..');
const input=path.resolve(process.argv[2]);
const output=path.resolve(process.argv[3]);
const source=path.join(input,'Mycellios-Desktop-0.3.9-source');
const agent=path.join(output,'src/agent');
const desktop=path.join(agent,'apps/desktop');
const digest=b=>createHash('sha256').update(b).digest('hex');
const provenance=JSON.parse(await fs.readFile(path.join(input,'provenance.json')));
const baseline=await fs.readFile(path.join(input,'native-base/dist/main.js'));
const published=await fs.readFile(path.join(source,'windows-caption-backport/main.js'));
if(digest(baseline)!==provenance.nativeMainSha256 || !baseline.equals(published)) throw Error('Published native baseline mismatch');
await fs.mkdir(desktop,{recursive:true});
await fs.cp(path.join(input,'native-base/dist'),path.join(desktop,'dist'),{recursive:true});
await fs.cp(path.join(source,'agent/apps/desktop/assets'),path.join(desktop,'assets'),{recursive:true});
await fs.cp(path.join(input,'native-base/web'),path.join(agent,'apps/web/dist'),{recursive:true});
await fs.cp(path.join(input,'native-base/stack'),path.join(agent,'infra/compose'),{recursive:true});
for(const name of ['package.json','package-lock.json']) await fs.copyFile(path.join(source,'agent',name),path.join(desktop,name));
await fs.copyFile(path.join(source,'Agent-upstream-LICENSE'),path.join(agent,'LICENSE'));
await fs.copyFile(path.join(source,'Mycellios-LICENSE'),path.join(output,'LICENSE'));
await fs.copyFile(path.join(source,'THIRD_PARTY.md'),path.join(output,'THIRD_PARTY.md'));
await fs.mkdir(path.join(desktop,'scripts'),{recursive:true});
for(const name of ['macos-installer.mjs','package-macos.mjs','install-runtime-macos.sh','describe-runtime-macos.sh','runtime-public-status.cjs']) await fs.copyFile(path.join(here,name),path.join(desktop,'scripts',name));
await build({entryPoints:[path.join(here,'source/contribution-runtime.ts')],outfile:path.join(desktop,'dist/mac-contribution-runtime.js'),bundle:true,format:'esm',platform:'node',target:'node22',sourcemap:false,plugins:[{name:'pinned-native-source',setup(b){
 b.onResolve({filter:/contracts\/node-control\.js$/},()=>({path:path.join(repository,'src/contracts/node-control.ts')}));
 b.onResolve({filter:/^\.\/setup-store\.js$/},()=>({path:path.join(source,'agent/apps/desktop/src/setup-store.ts')}));
 b.onResolve({filter:/^zod$/},()=>({path:path.join(here,'node_modules/zod/index.js')}));
}}]});
const needle='new ContributionRuntime(';
if(baseline.toString().split(needle).length!==2) throw Error('Native patch anchor is not unique');
await fs.writeFile(path.join(desktop,'dist/main.js'),'import {ContributionRuntime as MacContributionRuntime} from "./mac-contribution-runtime.js";\n'+baseline.toString().replace(needle,'new MacContributionRuntime('));
await fs.writeFile(path.join(output,'build-inputs.json'),JSON.stringify({...provenance,macSourceSha256:digest(await fs.readFile(path.join(here,'source/contribution-runtime.ts'))),nativeOutputSha256:digest(await fs.readFile(path.join(desktop,'dist/main.js'))),runtimeSha256:'66d48aaee92bd50233d37c901fbcfee92228d9cdeb0981bf2483ca68cc28f608',physicalMacTest:false},null,2));
console.log(JSON.stringify({desktopRoot:desktop,nativeBaselineSha256:digest(baseline)}));
