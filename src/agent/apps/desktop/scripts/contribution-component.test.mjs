import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {prepareMacInstaller} from './macos-installer.mjs';
import {prepareWindowsInstaller} from './windows-installer.mjs';
import {prepareLinuxInstaller} from './linux-installer.mjs';
for(const [extension,prepare,key] of [['pkg',prepareMacInstaller,'runtimePkg'],['msi',prepareWindowsInstaller,'runtimeMsi'],['deb',prepareLinuxInstaller,'runtimeDeb']]){
 test(`optional ${extension} keeps verified component bytes outside the application resources`,async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'optional-runtime-'));
  try{
   await mkdir(path.join(root,'scripts'));for(const f of ['install-runtime.sh','describe-runtime.sh'])await writeFile(path.join(root,'scripts',f),'fixture');
   const file=path.join(root,`runtime.${extension}`),bytes=Buffer.from('fixture component');await writeFile(file,bytes);
   const sha256=createHash('sha256').update(bytes).digest('hex'),output=path.join(root,'out');
   const config=await prepare({desktopRoot:root,[key]:file,runtimeSha256:sha256,output,version:'0.3.55',separateRuntime:true});
   assert.equal(config.extraResources.some(r=>r.to===`contribution/mycellios-runtime.${extension}`),false);
   assert.equal(config.extraResources.some(r=>r.to==='contribution/runtime.json'),true);
   assert.equal(config.extraResources.some(r=>r.to.startsWith('contribution/install-runtime')),true);
   const c=JSON.parse(await readFile(path.join(output,'runtime.json'),'utf8'));
   assert.equal(c.schema,'mycellios-desktop-runtime/2');assert.equal(c.sha256,sha256);assert.equal(c.bytes,bytes.length);
   assert.match(c.url,new RegExp(`desktop-runtime-${sha256}/mycellios-runtime`));
   assert.deepEqual(await readFile(path.join(output,'runtime-component',c.file)),bytes);
   await assert.rejects(prepare({desktopRoot:root,[key]:file,runtimeSha256:'0'.repeat(64),output,version:'0.3.55',separateRuntime:true}),/hash mismatch/);
  }finally{await rm(root,{recursive:true,force:true});}
 });
}
