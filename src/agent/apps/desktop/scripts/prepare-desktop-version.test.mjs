import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {prepareDesktopVersion} from './prepare-desktop-version.mjs';
test('prepares a distinct version while preserving dependencies and other workspace versions',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'desktop-version-'));
 try{
  await mkdir(path.join(root,'apps/desktop'),{recursive:true});
  const pkg=path.join(root,'apps/desktop/package.json'),lock=path.join(root,'package-lock.json');
  await writeFile(pkg,JSON.stringify({version:'0.3.16',dependencies:{preserve:'1.2.3'}}));
  await writeFile(lock,JSON.stringify({packages:{'apps/desktop':{version:'0.3.16'},'apps/web':{version:'0.1.0'}}}));
  assert.deepEqual(await prepareDesktopVersion(root,'patch'),{oldVersion:'0.3.16',version:'0.3.17',tag:'desktop-v0.3.17-windows-preview'});
  assert.deepEqual(JSON.parse(await readFile(pkg,'utf8')),{version:'0.3.17',dependencies:{preserve:'1.2.3'}});
  assert.equal(JSON.parse(await readFile(lock,'utf8')).packages['apps/web'].version,'0.1.0');
  await writeFile(lock,JSON.stringify({packages:{'apps/desktop':{version:'0.3.16'}}}));
  await assert.rejects(prepareDesktopVersion(root,'patch'),/must agree/);
  assert.equal(JSON.parse(await readFile(pkg,'utf8')).version,'0.3.17');
 }finally{await rm(root,{recursive:true,force:true});}
});
