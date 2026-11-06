import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {electronGuiEnvironment} from './electron-environment.mjs';
const require=createRequire(import.meta.url);
test('real Electron preserves isolated drafts with an inherited empty Node-mode variable',{skip:process.platform!=='win32',timeout:40000},async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'mycellios-install-fixture-'));
 try{
  const profile=path.join(root,'profile');
  const fixture=fileURLToPath(new URL('./fixtures/install-preservation.cjs',import.meta.url));
  const env=electronGuiEnvironment({...process.env,ELECTRON_RUN_AS_NODE:''});
  for(const mode of ['seed','verify']){
   const result=path.join(root,mode+'.json');
   execFileSync(require('electron'),[fixture,mode,profile,'',result],{env,windowsHide:true,stdio:'pipe',timeout:15000});
   const proof=JSON.parse(await readFile(result,'utf8'));
   assert.equal(proof.passed,true);assert.equal(proof.drafts,5);
  }
 }finally{assert.ok(root.startsWith(path.join(tmpdir(),'mycellios-install-fixture-')));await rm(root,{recursive:true,force:true});}
});
