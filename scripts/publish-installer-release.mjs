import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {validatePlatformReceipt} from './installer-release-contract.mjs';
const [input]=process.argv.slice(2);
if(!input||process.env.GITHUB_REPOSITORY!=='Mycellios/mycellios')throw Error('First-party release input required');
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
const gh=(...args)=>execFileSync('gh',args,{stdio:['ignore','pipe','pipe'],encoding:'utf8'});
const revision=git('rev-parse','HEAD'),tree=git('rev-parse','HEAD^{tree}');
const version=JSON.parse(await fs.readFile('src/agent/apps/desktop/package.json','utf8')).version;
const tag=`desktop-v${version}-windows-preview`;
if(!/^desktop-v\d+\.\d+\.\d+-windows-preview$/.test(tag))throw Error('Invalid version');
const out=path.resolve('release-publish');await fs.mkdir(out,{recursive:false});
const digest=async p=>{const h=createHash('sha256');for await(const b of createReadStream(p))h.update(b);return h.digest('hex');};
const artifacts=[];
async function stage(from,name=path.basename(from),expected){
 if(!/^[A-Za-z0-9._-]{1,220}$/.test(name)||artifacts.some(a=>a.fileName===name))throw Error('Ambiguous release file');
 const s=await fs.lstat(from),sha256=await digest(from);
 if(!s.isFile()||s.isSymbolicLink()||s.size<1||s.size>2_000_000_000||expected&&(expected.sha256!==sha256||expected.bytes!==s.size))throw Error('Artifact identity differs');
 await fs.copyFile(from,path.join(out,name));const a={fileName:name,sha256,bytes:s.size};artifacts.push(a);return a;
}
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const bound=r=>r.revision===revision&&r.tree===tree;
const windows=path.join(input,`desktop-windows-${revision}`),win=await read(path.join(windows,'desktop-release.json'));
if(!bound(win)||win.version!==version||win.tag!==tag||win.qualifiedStartup!==true||win.qualifiedInstallation!==true||win.automaticUpdates!==false)throw Error('Windows release qualification required');
if(win.artifact?.fileName!==`Mycellios-Desktop-${version}-windows-x64-pilot.exe`)throw Error('Windows artifact name differs');
const platforms=[];
const w=await stage(path.join(windows,win.artifact.fileName),undefined,win.artifact);
platforms.push({...w,id:'windows-x64',format:'EXE',version,runtimeVersion:win.runtimeVersion});
for(const name of await fs.readdir(windows))if(name.endsWith('.blockmap')||['latest.yml','desktop-release.json','desktop-build.json','packaged-smoke.json','installer-qualification.json'].includes(name))await stage(path.join(windows,name));
for(const platform of ['linux','macos-arm64','macos-x64']){
 const folder=path.join(input,`desktop-${platform}-${revision}`),receipt=await read(path.join(folder,`platform-release-${platform}.json`));
 validatePlatformReceipt(receipt,{revision,tree,version,platform});
 const ids=platform==='linux'?['linux-x64','fedora-x64']:[platform];
 if(!bound(receipt)||receipt.version!==version||receipt.platform!==platform||receipt.qualifiedStartup!==true||receipt.automaticUpdates!==false||!Array.isArray(receipt.files)||receipt.files.length!==ids.length)throw Error('Native platform qualification required');
 for(const file of receipt.files){
  if(!ids.includes(file.id)||platforms.some(p=>p.id===file.id)||file.version!==version||!file.fileName?.includes(version))throw Error('Mixed native package');
  const actual=path.join(folder,file.id==='fedora-x64'?'fedora':'',file.fileName);
  platforms.push({...await stage(actual,undefined,file),id:file.id,format:file.format,version,runtimeVersion:file.id==='macos-x64'?null:'0.2.95'});
 }
 await stage(path.join(folder,`platform-release-${platform}.json`));
}
const androidFolder=path.join(input,`desktop-android-${revision}`),android=await read(path.join(androidFolder,'android-build.json'));
if(!bound(android)||android.applicationId!=='com.mycellios.android'||!/^\d+\.\d+\.\d+$/.test(android.version)||!Number.isSafeInteger(android.versionCode)||android.versionCode<1||android.minSdk!==26||!Object.keys(android.sharedWebFiles??{}).length)throw Error('Android shared source qualification required');
const badging=await fs.readFile(path.join(androidFolder,'apk-badging.txt'),'utf8');
if(!badging.includes("name='com.mycellios.android'")||!badging.includes(`versionCode='${android.versionCode}'`)||!badging.includes(`versionName='${android.version}'`))throw Error('APK metadata differs');
const apk=await stage(path.join(androidFolder,'android-build-input.apk'));
await stage(path.join(androidFolder,'android-build.json'));await stage(path.join(androidFolder,'apk-badging.txt'));
const sourceName=`Mycellios-Desktop-${version}-source-${revision.slice(0,8)}.tar.gz`;
git('archive','--format=tar.gz','--prefix=mycellios/',`--output=${path.join(out,sourceName)}`,'HEAD');
const sourceStat=await fs.stat(path.join(out,sourceName)),source={fileName:sourceName,sha256:await digest(path.join(out,sourceName)),bytes:sourceStat.size};artifacts.push(source);
const manifest={schema:'mycellios-installer-release/1',version,revision,tree,workflowRun:Number(process.env.GITHUB_RUN_ID),automaticUpdates:false,platforms,source,android:{version:android.version,versionCode:android.versionCode,applicationId:android.applicationId,minSdk:26,input:apk,signing:'original-host-required',signerSha256:'55121c1851944597566e2ccd0f87590cf2fa7e36acded7c8003627edcb39016c'},artifacts:[...artifacts]};
await fs.writeFile(path.join(out,'installer-release.json'),JSON.stringify(manifest,null,2));
const m=path.join(out,'installer-release.json');artifacts.push({fileName:'installer-release.json',sha256:await digest(m),bytes:(await fs.stat(m)).size});
await fs.writeFile(path.join(out,'SHA256SUMS-all.txt'),artifacts.map(a=>`${a.sha256}  ${a.fileName}`).join('\n')+'\n');
// Never publish an earlier checkout over concurrent main changes.
git('fetch','origin','main:refs/remotes/origin/main','--no-tags');if(git('rev-parse','origin/main')!==revision)throw Error('Main advanced during native qualification');
const api=async resource=>{const r=await fetch('https://api.github.com/repos/Mycellios/mycellios/'+resource,{redirect:'error',signal:AbortSignal.timeout(15000),headers:{authorization:'Bearer '+process.env.GH_TOKEN,accept:'application/vnd.github+json'}});if(r.status===404)return null;if(!r.ok)throw Error('Release API unavailable');return r.json();};
if(await api('releases/tags/'+tag))throw Error('Release already exists; never replace installers');
if(await api('git/ref/tags/'+tag))throw Error('Tag already exists; preserve its original identity');
gh('api','repos/Mycellios/mycellios/git/refs','-f','ref=refs/tags/'+tag,'-f','sha='+revision);
await fs.writeFile(path.join(out,'notes.md'),`One qualified source revision for Windows, Linux, Fedora and both Mac architectures: ${revision}.\n\nAndroid build input is signed automatically on the original signing host before it is linked by Mycellios. The download page never links an unsigned APK. Platform runner checks passed; physical device installs are separate. Updates remain owner-approved.\n`);
gh('release','create',tag,'--verify-tag','--target',revision,'--draft','--prerelease','--latest=false','--title',`Mycellios Desktop ${version}`,'--notes-file',path.join(out,'notes.md'));
gh('release','upload',tag,...artifacts.map(a=>path.join(out,a.fileName)),path.join(out,'SHA256SUMS-all.txt'));
gh('release','edit',tag,'--draft=false','--prerelease','--latest=false');
console.log(JSON.stringify({published:true,tag,revision,platforms:platforms.map(p=>p.id),androidSigning:'original-host-required'}));
