import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,link,copyFile,access,rm,readdir,unlink,cp,utimes} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const source=process.env.MYCELLIOS_TEST_INSTALLED_EXE;
const windows=process.platform==='win32'&&!!source;
const helper=fileURLToPath(new URL('./fast-install.ps1',import.meta.url));
const ps=path.join(process.env.SystemRoot??'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe');

// WDAC and AppLocker run unsigned scripts in ConstrainedLanguage, as on managed work PCs.
// Every case runs in both modes; this wrapper switches the session before calling the helper.
const LANGUAGE_MODES=['FullLanguage','ConstrainedLanguage'];
const wrapperDir=mkdtempSync(path.join(tmpdir(),'mycellios-fast-install-clm-'));
const constrained=path.join(wrapperDir,'constrained.ps1');
writeFileSync(constrained,[
  '$helper=$args[0];$named=@{}',
  'for($i=1;$i -lt $args.Count;$i+=2){$named[$args[$i].TrimStart([char]45)]=$args[$i+1]}',
  "$ExecutionContext.SessionState.LanguageMode='ConstrainedLanguage'",
  '& $helper @named',
  'exit $LASTEXITCODE',
].join('\r\n'));
process.on('exit',()=>rmSync(wrapperDir,{recursive:true,force:true}));
const runHelper=mode=>mode==='FullLanguage'?['-File',helper]:['-File',constrained,helper];

for(const mode of LANGUAGE_MODES){

test(`Windows snapshot/rollback preserves installation registration, drafts and task fixtures (${mode})`,{skip:!windows,timeout:60000},async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'mycellios-fast-install-'));
  assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir())+path.sep+'mycellios-fast-install-'));
  const installation=path.join(root,'mycellios-desktop'),profile=path.join(root,'user-profile');
  const journal=path.join(root,'journal.json'),guid=randomUUID();
  const keys=['Software\\'+guid,'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\'+guid];
  const reg=(...args)=>execFileSync('reg.exe',args,{windowsHide:true,stdio:'pipe'}).toString();
  const invoke=(operation,extra=[],receipt=journal)=>execFileSync(ps,['-NoProfile','-NonInteractive',...runHelper(mode),'-Operation',operation,'-Installation',installation,'-Journal',receipt,...extra],{windowsHide:true,stdio:'pipe'});
  try {
    for(const key of keys){assert.throws(()=>reg('query','HKCU\\'+key));reg('add','HKCU\\'+key,'/v','InstallLocation','/t','REG_SZ','/d',installation,'/f');}
    reg('add','HKCU\\'+keys[1],'/v','DisplayVersion','/t','REG_SZ','/d','0.3.18','/f');
    await mkdir(path.join(installation,'resources'),{recursive:true});await mkdir(profile);
    const target=path.join(installation,'Mycellios Desktop.exe');await link(source,target).catch(()=>copyFile(source,target));
    await writeFile(path.join(installation,'Uninstall Mycellios Desktop.exe'),'Uninstaller fixture; never executed');
    await writeFile(path.join(installation,'resources/desktop-build.json'),JSON.stringify({schema:'mycellios-desktop-build/1',platform:'windows-x64',version:'0.3.18'}));
    const drafts=JSON.stringify(Array.from({length:5},(_,i)=>({thread:'fixture-'+i,text:'Borrador conservado '+i})));
    const tasks=JSON.stringify(Array.from({length:5},(_,i)=>({id:'fixture-'+i,status:'queued',assignmentVersion:1})));
    await writeFile(path.join(profile,'drafts.json'),drafts);await writeFile(path.join(profile,'tasks.json'),tasks);
    invoke('prepare',['-Uninstaller','Uninstall Mycellios Desktop.exe','-InstallRegistryKey',keys[0],'-UninstallRegistryKey',keys[1],'-TargetVersion','99.0.0']);
    const state=JSON.parse((await readFile(journal,'utf8')).replace(/^\uFEFF/,''));
    assert.equal(state.phase,'prepared');assert.ok(state.backup.startsWith(path.join(root,'mycellios-desktop-upgrade-backups')+path.sep));
    await access(path.join(state.backup,'Mycellios Desktop.exe'));await assert.rejects(access(target));
    assert.deepEqual(await readdir(installation),['Uninstall Mycellios Desktop.exe']);
    // Simulate a failed extraction/registration after the old uninstaller ran.
    await writeFile(path.join(installation,'partial-new-version'),'partial');
    reg('add','HKCU\\'+keys[1],'/v','DisplayVersion','/t','REG_SZ','/d','broken','/f');
    assert.throws(()=>invoke('commit'));
    invoke('rollback');
    await access(target);await assert.rejects(access(path.join(installation,'partial-new-version')));
    assert.match(reg('query','HKCU\\'+keys[1],'/v','DisplayVersion'),/0\.3\.18/);
    assert.equal(await readFile(path.join(profile,'drafts.json'),'utf8'),drafts);
    assert.equal(await readFile(path.join(profile,'tasks.json'),'utf8'),tasks);
    const restored=JSON.parse((await readFile(journal,'utf8')).replace(/^\uFEFF/,''));assert.equal(restored.phase,'restored');
    const interruptedJournal=path.join(root,'interrupted.json'), retryJournal=path.join(root,'retry.json');
    const args=['-Uninstaller','Uninstall Mycellios Desktop.exe','-InstallRegistryKey',keys[0],'-UninstallRegistryKey',keys[1]];
    invoke('prepare',[...args,'-TargetVersion','99.0.1'],interruptedJournal);
    const interrupted=JSON.parse((await readFile(interruptedJournal,'utf8')).replace(/^\uFEFF/,''));
    // Extraction was interrupted after writing the binary, before its resources, manifest and uninstaller.
    await unlink(path.join(installation,'Uninstall Mycellios Desktop.exe'));
    await copyFile(source,target);
    await writeFile(path.join(installation,'partial-new-version'),'partial');
    // A second prepared receipt for the same installation makes recovery ambiguous: nothing moves.
    const duplicate=path.join(path.dirname(interrupted.backup),'..',randomUUID());
    await cp(path.dirname(interrupted.backup),duplicate,{recursive:true});
    await writeFile(path.join(duplicate,'receipt.json'),JSON.stringify({...interrupted,backup:path.join(duplicate,'installation')}));
    // Windows PowerShell wraps Write-Error text at the console width, so allow line breaks.
    assert.throws(()=>invoke('prepare',[...args,'-TargetVersion','99.0.2'],retryJournal),/Interrupted\s+installation\s+recovery\s+is\s+ambiguous/);
    await access(path.join(installation,'partial-new-version'));await access(path.join(interrupted.backup,'Mycellios Desktop.exe'));
    await assert.rejects(access(retryJournal));
    await rm(duplicate,{recursive:true,force:true});
    // Retrying for a different version than the interrupted one recovers the single receipt.
    invoke('prepare',[...args,'-TargetVersion','99.0.2'],retryJournal);
    const recovered=JSON.parse((await readFile(path.join(path.dirname(interrupted.backup),'receipt.json'),'utf8')).replace(/^\uFEFF/,''));
    const retry=JSON.parse((await readFile(retryJournal,'utf8')).replace(/^\uFEFF/,''));
    assert.equal(recovered.phase,'restored');
    assert.ok((await readdir(path.dirname(interrupted.backup))).some(name=>name.startsWith('failed-')));
    assert.equal(retry.phase,'prepared');
    assert.notEqual(retry.backup,interrupted.backup);
    invoke('rollback',[],retryJournal);
    await access(target);
    assert.equal(await readFile(path.join(profile,'drafts.json'),'utf8'),drafts);
    assert.equal(await readFile(path.join(profile,'tasks.json'),'utf8'),tasks);
  } finally {
    for(const key of keys){try{reg('delete','HKCU\\'+key,'/f')}catch{}}
    assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir())+path.sep+'mycellios-fast-install-'));
    await rm(root,{recursive:true,force:true});
  }
});

test(`refuses paths outside the named installation without moving data (${mode})`,{skip:!windows},async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'mycellios-fast-install-scope-'));
  try{
    const target=path.join(root,'other-product');await mkdir(target);await writeFile(path.join(target,'keep'),'preserved');
    assert.throws(()=>execFileSync(ps,['-NoProfile','-NonInteractive',...runHelper(mode),'-Operation','prepare','-Installation',target,'-Journal',path.join(root,'journal.json'),'-TargetVersion','99.0.0'],{windowsHide:true,stdio:'pipe'}));
    assert.equal(await readFile(path.join(target,'keep'),'utf8'),'preserved');
  }finally{
    assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir())+path.sep+'mycellios-fast-install-scope-'));
    await rm(root,{recursive:true,force:true});
  }
});

test(`prepare reports an open app with its own exit code and moves nothing (${mode})`,{skip:process.platform!=='win32',timeout:60000},async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'mycellios-fast-install-open-'));
  const installation=path.join(root,'mycellios-desktop'),journal=path.join(root,'journal.json');
  // Any long-running executable under the product name stands in for the open app.
  const running=path.join(installation,'Mycellios Desktop.exe');
  let child;
  try{
    await mkdir(installation);await copyFile(path.join(process.env.SystemRoot??'C:/Windows','System32/PING.EXE'),running);
    const {spawn}=await import('node:child_process');
    child=spawn(running,['-n','60','127.0.0.1'],{windowsHide:true,stdio:'ignore'});
    await new Promise(resolve=>child.once('spawn',resolve));
    let status;
    try{execFileSync(ps,['-NoProfile','-NonInteractive',...runHelper(mode),'-Operation','prepare','-Installation',installation,'-Journal',journal,'-Uninstaller','Uninstall Mycellios Desktop.exe','-TargetVersion','99.0.0'],{windowsHide:true,stdio:'pipe'});status=0}
    catch(error){status=error.status}
    assert.equal(status,3);
    await access(running);await assert.rejects(access(journal));
    await assert.rejects(access(path.join(root,'mycellios-desktop-upgrade-backups')));
  }finally{
    child?.kill();if(child&&child.exitCode===null)await new Promise(resolve=>child.once('exit',resolve));
    assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir())+path.sep+'mycellios-fast-install-open-'));
    await rm(root,{recursive:true,force:true});
  }
});

test(`Windows commit keeps the two newest settled recovery copies and every unsettled one (${mode})`,{skip:!windows,timeout:60000},async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'mycellios-fast-install-retention-'));
  const installation=path.join(root,'mycellios-desktop'),journal=path.join(root,'journal.json'),guid=randomUUID();
  const backups=path.join(root,'mycellios-desktop-upgrade-backups');
  const keys=['Software\\'+guid,'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\'+guid];
  const reg=(...args)=>execFileSync('reg.exe',args,{windowsHide:true,stdio:'pipe'}).toString();
  const invoke=(operation,extra=[])=>execFileSync(ps,['-NoProfile','-NonInteractive',...runHelper(mode),'-Operation',operation,'-Installation',installation,'-Journal',journal,...extra],{windowsHide:true,stdio:'pipe'});
  const version=execFileSync(ps,['-NoProfile','-NonInteractive','-Command',"(Get-Item -LiteralPath '"+source.replaceAll("'","''")+"').VersionInfo.ProductVersion"]).toString().trim().split('.').slice(0,3).join('.');
  const writeApp=async()=>{
    const target=path.join(installation,'Mycellios Desktop.exe');await link(source,target).catch(()=>copyFile(source,target));
    await mkdir(path.join(installation,'resources'),{recursive:true});
    await writeFile(path.join(installation,'resources/desktop-build.json'),JSON.stringify({schema:'mycellios-desktop-build/1',platform:'windows-x64',version}));
  };
  // A recovery folder as an earlier update left it, dated `daysAgo` by its receipt.
  const seed=async(phase,daysAgo,{scope=installation,receipt=true}={})=>{
    const folder=path.join(backups,randomUUID());await mkdir(path.join(folder,'installation'),{recursive:true});
    await writeFile(path.join(folder,'installation','Mycellios Desktop.exe'),'previous version');
    if(receipt){
      const file=path.join(folder,'receipt.json');
      await writeFile(file,JSON.stringify({schema:'mycellios-fast-install/1',installation:scope,backup:path.join(folder,'installation'),target:'0.0.1',phase,registry:[],shortcuts:[]}));
      const at=new Date(Date.now()-daysAgo*86_400_000);await utimes(file,at,at);
    }
    return path.basename(folder);
  };
  try {
    for(const key of keys){reg('add','HKCU\\'+key,'/v','InstallLocation','/t','REG_SZ','/d',installation,'/f');}
    await mkdir(installation,{recursive:true});await writeApp();
    await writeFile(path.join(installation,'Uninstall Mycellios Desktop.exe'),'Uninstaller fixture; never executed');
    const oldest=await seed('committed',3),older=await seed('committed',2),newest=await seed('restored',1);
    const interrupted=await seed('prepared',5),foreign=await seed('committed',4,{scope:path.join(root,'other','mycellios-desktop')});
    const unlabeled=await seed('committed',6,{receipt:false});
    invoke('prepare',['-Uninstaller','Uninstall Mycellios Desktop.exe','-InstallRegistryKey',keys[0],'-UninstallRegistryKey',keys[1],'-TargetVersion',version]);
    const current=path.basename(path.dirname(JSON.parse((await readFile(journal,'utf8')).replace(/^\uFEFF/,'')).backup));
    // The installer extracts the new version next to the preserved uninstaller.
    await writeApp();
    invoke('commit');
    const left=new Set(await readdir(backups));
    assert.deepEqual([...left].sort(),[current,newest,interrupted,foreign,unlabeled].sort());
    assert.ok(!left.has(oldest)&&!left.has(older));
    await access(path.join(backups,current,'installation','Mycellios Desktop.exe'));
    const committed=JSON.parse((await readFile(path.join(backups,current,'receipt.json'),'utf8')).replace(/^\uFEFF/,''));
    assert.equal(committed.phase,'committed');
  } finally {
    for(const key of keys){try{reg('delete','HKCU\\'+key,'/f')}catch{}}
    assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir())+path.sep+'mycellios-fast-install-retention-'));
    await rm(root,{recursive:true,force:true});
  }
});
}
