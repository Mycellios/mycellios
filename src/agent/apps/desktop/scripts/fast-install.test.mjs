import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,link,copyFile,access,rm,readdir,unlink} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const source=process.env.MYCELLIOS_TEST_INSTALLED_EXE;
const windows=process.platform==='win32'&&!!source;
const helper=fileURLToPath(new URL('./fast-install.ps1',import.meta.url));
const ps=path.join(process.env.SystemRoot??'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe');

test('Windows snapshot/rollback preserves installation registration, drafts and task fixtures',{skip:!windows,timeout:60000},async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'mycellios-fast-install-'));
  assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir())+path.sep+'mycellios-fast-install-'));
  const installation=path.join(root,'mycellios-desktop'),profile=path.join(root,'user-profile');
  const journal=path.join(root,'journal.json'),guid=randomUUID();
  const keys=['Software\\'+guid,'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\'+guid];
  const reg=(...args)=>execFileSync('reg.exe',args,{windowsHide:true,stdio:'pipe'}).toString();
  const invoke=(operation,extra=[],receipt=journal)=>execFileSync(ps,['-NoProfile','-NonInteractive','-File',helper,'-Operation',operation,'-Installation',installation,'-Journal',receipt,...extra],{windowsHide:true,stdio:'pipe'});
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
    // Extraction was interrupted after writing the binary and manifest but before registering the uninstaller.
    await unlink(path.join(installation,'Uninstall Mycellios Desktop.exe'));
    await copyFile(source,target);
    await mkdir(path.join(installation,'resources'));
    await writeFile(path.join(installation,'resources/desktop-build.json'),JSON.stringify({schema:'mycellios-desktop-build/1',platform:'windows-x64',version:'99.0.1'}));
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

test('refuses paths outside the named installation without moving data',{skip:!windows},async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'mycellios-fast-install-scope-'));
  try{
    const target=path.join(root,'other-product');await mkdir(target);await writeFile(path.join(target,'keep'),'preserved');
    assert.throws(()=>execFileSync(ps,['-NoProfile','-NonInteractive','-File',helper,'-Operation','prepare','-Installation',target,'-Journal',path.join(root,'journal.json'),'-TargetVersion','99.0.0'],{windowsHide:true,stdio:'pipe'}));
    assert.equal(await readFile(path.join(target,'keep'),'utf8'),'preserved');
  }finally{
    assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir())+path.sep+'mycellios-fast-install-scope-'));
    await rm(root,{recursive:true,force:true});
  }
});
