import {readFile,appendFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
export function admittedRevision({eventName,event,ref,repository,main}){
 if(repository!=='Mycellios/mycellios')return null;
 if(eventName==='workflow_dispatch')return ref==='refs/heads/main'?main:null;
 const run=event.workflow_run;
 return eventName==='workflow_run'&&run?.conclusion==='success'&&run.head_branch==='main'&&
  run.head_repository?.full_name===repository&&run.head_sha===main?main:null;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
 git('fetch','origin','main:refs/remotes/origin/main','--no-tags');
 const main=git('rev-parse','origin/main');
 const revision=admittedRevision({eventName:process.env.GITHUB_EVENT_NAME,event:JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH,'utf8')),ref:process.env.GITHUB_REF,repository:process.env.GITHUB_REPOSITORY,main});
 let ready=false,version='';
 if(revision){
  if(git('rev-parse','HEAD')!==revision)throw Error('Release admission source changed');
  version=JSON.parse(await readFile('src/agent/apps/desktop/package.json','utf8')).version;
  if(!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))throw Error('Invalid release version');
  const r=await fetch(`https://api.github.com/repos/Mycellios/mycellios/releases/tags/desktop-v${version}-windows-preview`,{redirect:'error',signal:AbortSignal.timeout(15000),headers:{authorization:'Bearer '+process.env.GH_TOKEN,accept:'application/vnd.github+json'}});
  if(r.status===404)ready=true;
  else if(!r.ok)throw Error('Could not establish release state');
  else{const release=await r.json();if(release.draft)throw Error('Recover the existing draft without replacing its immutable version');}
 }
 await appendFile(process.env.GITHUB_OUTPUT,`ready=${ready}\nrevision=${revision??''}\nversion=${version}\n`);
 console.log(ready?'Qualified main revision admitted for all platform builders':'No unpublished current version: existing releases are preserved');
}
