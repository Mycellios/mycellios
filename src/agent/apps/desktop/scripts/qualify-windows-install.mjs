import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {hashes} from './desktop-release.mjs';
import {electronGuiEnvironment} from './electron-environment.mjs';
const require=createRequire(import.meta.url),desktop=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(process.platform!=='win32'||process.env.GITHUB_ACTIONS!=='true'||!process.argv[2])throw Error('Use an isolated hosted Windows runner');
const output=path.resolve(process.argv[2]),identity=JSON.parse(await fs.readFile(path.join(output,'desktop-build.json'),'utf8'));
const candidate=path.join(output,`Mycellios-Desktop-${identity.version}-windows-x64-pilot.exe`);
const digest=await hashes(candidate),root=await fs.mkdtemp(path.join(process.env.RUNNER_TEMP,'mycellios-install-qualification-'));
const {UUID}=require('builder-util-runtime');
const guid=UUID.v5('com.mycellios.agent.desktop',UUID.parse('50e065bc-3134-11e6-9bab-38c9862bdaf3'));
const keys=['Software\\'+guid,'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\'+guid];
const reg=(...args)=>execFileSync('reg.exe',args,{encoding:'utf8',stdio:'pipe'});
for(const key of keys)assert.throws(()=>reg('query','HKCU\\'+key),'Runner already has a Mycellios registration');
const profile=path.join(process.env.APPDATA,'Mycellios Agent');
assert.equal(await fs.access(profile).then(()=>true,()=>false),false,'Runner profile is not fresh');
const ps=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
const zip='C:/Program Files/7-Zip/7z.exe';
const fixture=path.join(desktop,'scripts/fixtures/install-preservation.cjs');
const electron=require('electron');
const json=async file=>JSON.parse((await fs.readFile(file,'utf8')).replace(/^\uFEFF/,''));
const proofs=[];
let ownsRegistration=false;
async function preservation(mode,resources,label){
 const result=path.join(root,label+'.json');
 execFileSync(electron,[fixture,mode,mode==='archives'?path.join(root,'archive-profile'):profile,resources,result],{windowsHide:true,env:electronGuiEnvironment(),timeout:60000,stdio:'pipe'});
 const proof=await json(result);assert.equal(proof.passed,true);return proof;
}
async function measure(installation,label){
 const journal=path.join(root,label+'-journal.json');
 try{
  execFileSync(ps,['-NoProfile','-NonInteractive','-File',path.join(desktop,'scripts/fast-install.ps1'),'-Operation','check','-Installation',installation,'-Journal',journal,'-Uninstaller','Uninstall Mycellios Desktop.exe','-InstallRegistryKey',keys[0],'-UninstallRegistryKey',keys[1],'-TargetVersion',identity.version],{windowsHide:true,stdio:'pipe'});
 }catch(error){
  const detail=String(error?.stderr??'').trim()||String(error?.stdout??'').trim()||String(error?.message??error);
  throw new Error(`fast-install check failed before the installer: ${detail}`);
 }
 const result=path.join(root,label+'-timing.json');
 let executionError;
 try{
  execFileSync(ps,['-NoProfile','-NonInteractive','-File',path.join(desktop,'scripts/measure-windows-installer.ps1'),'-Candidate',candidate,'-Installation',installation,'-Result',result],{windowsHide:true,timeout:240000,stdio:'pipe'});
 }catch(error){executionError=error;}
 let timing;
 try{timing=await json(result);}catch{throw executionError??new Error('Installer qualification produced no result');}
 if(timing.exitCode!==0)throw new Error(`Installer failed (${timing.exitCode}): ${timing.installerError??'no error detail'}`);
 assert.equal(timing.exitCode,0);
 const manifest=await json(path.join(installation,'resources/desktop-build.json'));
 assert.equal(manifest.version,identity.version);assert.equal(manifest.revision,identity.revision);
 await preservation('verify',path.join(installation,'resources'),label+'-drafts');
 assert.equal(await fs.readFile(path.join(profile,'fixture-tasks.json'),'utf8'),JSON.stringify(Array.from({length:5},(_,i)=>({id:'fixture-'+i,status:'queued',assignmentVersion:1}))));
 proofs.push({label,...timing,draftsPreserved:5,taskMarkersPreserved:5});
}
try{
 await preservation('seed','', 'before');
 await fs.writeFile(path.join(profile,'fixture-tasks.json'),JSON.stringify(Array.from({length:5},(_,i)=>({id:'fixture-'+i,status:'queued',assignmentVersion:1}))));
 const legacy=path.join(root,'legacy.exe');
 execFileSync('curl.exe',['--fail','--location','--retry','2','--output',legacy,'https://www.mycellios.com/downloads/desktop/releases/0.3.18/Mycellios-Desktop-0.3.18-windows-x64-pilot.exe'],{stdio:'pipe'});
 assert.equal((await hashes(legacy)).sha256,'7fef0fcca53bcb24e883058826d9aff95b31450ecfd21a7a0aeb9fa88e432797');
 const extracted=path.join(root,'legacy-payload'),installation=path.join(root,'legacy/mycellios-desktop');
 execFileSync(zip,['e','-y','-o'+extracted,legacy,'$PLUGINSDIR/app-64.7z','$R0/Uninstall Mycellios Desktop.exe'],{stdio:'pipe'});
 execFileSync(zip,['x','-y','-o'+installation,path.join(extracted,'app-64.7z')],{stdio:'pipe'});
 await fs.copyFile(path.join(extracted,'Uninstall Mycellios Desktop.exe'),path.join(installation,'Uninstall Mycellios Desktop.exe'));
 // Free the download and the extracted payload before the upgrade copies the
 // installation for rollback; the hosted runner otherwise runs out of disk.
 await fs.rm(legacy,{force:true});
 await fs.rm(extracted,{recursive:true,force:true});
 // Exercise the real NSIS error path, without starting an old application.
 const refused=path.join(root,'refused/mycellios-desktop');
 await fs.mkdir(path.join(refused,'resources'),{recursive:true});
 await fs.copyFile(path.join(installation,'Mycellios Desktop.exe'),path.join(refused,'Mycellios Desktop.exe'));
 await fs.copyFile(path.join(installation,'resources/desktop-build.json'),path.join(refused,'resources/desktop-build.json'));
 const invalid='Isolated non-executable uninstaller fixture; never production.';
 await fs.writeFile(path.join(refused,'Uninstall Mycellios Desktop.exe'),invalid);
 for(const key of keys){reg('add','HKCU\\'+key,'/v','InstallLocation','/t','REG_SZ','/d',refused,'/f');ownsRegistration=true;}
 reg('add','HKCU\\'+keys[1],'/v','UninstallString','/t','REG_SZ','/d','"'+path.join(refused,'Uninstall Mycellios Desktop.exe')+'" /currentuser','/f');
 const failureResult=path.join(root,'refused-timing.json');
 assert.throws(()=>execFileSync(ps,['-NoProfile','-NonInteractive','-File',path.join(desktop,'scripts/measure-windows-installer.ps1'),'-Candidate',candidate,'-Installation',refused,'-Result',failureResult],{windowsHide:true,timeout:60000,stdio:'pipe'}));
 assert.equal((await json(failureResult)).exitCode,2);
 assert.equal((await json(path.join(refused,'resources/desktop-build.json'))).version,'0.3.18');
 assert.equal(await fs.readFile(path.join(refused,'Uninstall Mycellios Desktop.exe'),'utf8'),invalid);
 assert.ok(reg('query','HKCU\\'+keys[0],'/v','InstallLocation').includes(refused));
 const refusedBackups=path.join(path.dirname(refused),'mycellios-desktop-upgrade-backups');
 const refusedFolder=(await fs.readdir(refusedBackups))[0];
 assert.equal((await json(path.join(refusedBackups,refusedFolder,'receipt.json'))).phase,'restored');
 await preservation('verify',path.join(refused,'resources'),'refused-drafts');
 for(const key of keys){reg('add','HKCU\\'+key,'/v','InstallLocation','/t','REG_SZ','/d',installation,'/f');ownsRegistration=true;}
 reg('add','HKCU\\'+keys[0],'/v','KeepShortcuts','/t','REG_SZ','/d','true','/f');
 reg('add','HKCU\\'+keys[1],'/v','UninstallString','/t','REG_SZ','/d','"'+path.join(installation,'Uninstall Mycellios Desktop.exe')+'" /currentuser','/f');
 reg('add','HKCU\\'+keys[1],'/v','DisplayVersion','/t','REG_SZ','/d','0.3.18','/f');
 await measure(installation,'legacy-to-compact');
 const snapshots=await fs.readdir(path.join(path.dirname(installation),'mycellios-desktop-upgrade-backups'));
 assert.equal(snapshots.length,1);
 const backup=path.join(path.dirname(installation),'mycellios-desktop-upgrade-backups',snapshots[0],'installation');
 assert.equal((await json(path.join(backup,'resources/desktop-build.json'))).version,'0.3.18');
 await fs.rm(legacy,{force:true});
 await fs.rm(extracted,{recursive:true,force:true});
 await fs.rm(path.join(path.dirname(installation),'mycellios-desktop-upgrade-backups'),{recursive:true,force:true});
 for(const key of keys)reg('delete','HKCU\\'+key,'/f');
 await measure(path.join(root,'fresh/mycellios-desktop'),'fresh');
 const archives=await preservation('archives',path.join(installation,'resources'),'archive-tools');
 const proof={passed:proofs.every(p=>p.elapsedMs<60000),version:identity.version,revision:identity.revision,installerSha256:digest.sha256,measurements:proofs,legacyUninstallFailureRestored:true,archives,scope:'hosted-windows-runner',physicalOwnerPc:false};
 await fs.writeFile(path.join(output,'installer-qualification.json'),JSON.stringify(proof,null,2));
 console.log(JSON.stringify(proof));
 assert.equal(proof.passed,true,'Actual installer exceeded the 60 second target');
}finally{
 if(ownsRegistration)for(const key of keys){try{reg('delete','HKCU\\'+key,'/f')}catch{}}
 assert.ok(path.resolve(root).startsWith(path.resolve(process.env.RUNNER_TEMP)+path.sep+'mycellios-install-qualification-'));
 // The hosted runner owns this entire temporary tree; retain it on failure for logs.
}
