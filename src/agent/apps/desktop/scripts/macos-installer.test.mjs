import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,writeFile,readFile,rm}from'node:fs/promises';import {tmpdir}from'node:os';import path from'node:path';import {createHash}from'node:crypto';
import {prepareMacInstaller}from'./macos-installer.mjs';
test('Apple Silicon packaging pins the PKG, preserves identity and keeps unsigned updates disabled',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'mycellios-mac-test-'));
 try{
  const runtimePkg=path.join(root,'runtime.pkg');const bytes=Buffer.from('synthetic PKG fixture');await writeFile(runtimePkg,bytes);const runtimeSha256=createHash('sha256').update(bytes).digest('hex');
  const options={desktopRoot:root,runtimePkg,runtimeSha256,output:path.join(root,'out'),version:'0.3.9'};
  const config=await prepareMacInstaller(options);
  assert.equal(config.appId,'com.mycellios.agent.desktop');assert.deepEqual(config.mac.target,[{target:'dmg',arch:['arm64']},{target:'zip',arch:['arm64']}]);
  assert.equal(config.mac.notarize,false);assert.equal(config.mac.identity,null);assert.deepEqual(config.publish,[]);
  assert.equal(config.extraResources.some(r=>r.to==='contribution/mycellios-runtime.pkg'),true);assert.equal(config.extraResources.filter(r=>r.to.startsWith('licenses/')).length,3);
  assert.equal(JSON.parse(await readFile(path.join(root,'out/runtime.json'))).sha256,runtimeSha256);
  await assert.rejects(prepareMacInstaller({...options,runtimeSha256:'0'.repeat(64)}),/hash mismatch/);
  await assert.rejects(prepareMacInstaller({...options,version:'../wrong'}),/version/);
 }finally{await rm(root,{recursive:true,force:true});}
});
