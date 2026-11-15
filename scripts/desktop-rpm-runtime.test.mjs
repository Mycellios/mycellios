import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {verifyRpmRuntime} from './build-desktop-rpm.mjs';
test('RPM retains strict verification for bundled and optional contribution runtimes',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'rpm-runtime-'));
 try{
  const dir=path.join(root,'contribution');await mkdir(dir);
  const payload=Buffer.from('fixture DEB'),file='mycellios-runtime.deb',sha256=createHash('sha256').update(payload).digest('hex');
  const manifest=path.join(dir,'runtime.json');
  await writeFile(path.join(dir,file),payload);
  await writeFile(manifest,JSON.stringify({schema:'mycellios-desktop-runtime/1',file,sha256}));
  assert.equal((await verifyRpmRuntime(root)).sha256,sha256);
  await writeFile(path.join(dir,file),'corrupt');await assert.rejects(verifyRpmRuntime(root),/hash_mismatch/);
  await rm(path.join(dir,file));
  const c={schema:'mycellios-desktop-runtime/2',file,sha256,bytes:payload.length,url:`https://github.com/Mycellios/mycellios/releases/download/desktop-runtime-${sha256}/${file}`};
  await writeFile(manifest,JSON.stringify(c));assert.deepEqual(await verifyRpmRuntime(root),c);
  for(const patch of [{url:c.url+'?other=1'},{file:'mycellios-runtime.msi'},{sha256:'invalid'},{bytes:0},{schema:'unknown'}]){
   await writeFile(manifest,JSON.stringify({...c,...patch}));await assert.rejects(verifyRpmRuntime(root));
  }
  await writeFile(manifest,JSON.stringify(c));await writeFile(path.join(dir,file),payload);
  await assert.rejects(verifyRpmRuntime(root),/unexpected_bundled_component/);
 }finally{await rm(root,{recursive:true,force:true});}
});
