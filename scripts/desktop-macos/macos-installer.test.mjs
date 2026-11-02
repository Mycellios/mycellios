import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,writeFile,readFile,rm}from'node:fs/promises';import {tmpdir}from'node:os';import path from'node:path';import {createHash}from'node:crypto';
import {prepareMacInstaller}from'./macos-installer.mjs';
test('Apple Silicon packaging pins the PKG, preserves identity and keeps unsigned updates disabled',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'mycellios-mac-test-'));
 try{
  const runtimePkg=path.join(root,'runtime.pkg');const bytes=Buffer.from('synthetic PKG fixture');await writeFile(runtimePkg,bytes);const runtimeSha256=createHash('sha256').update(bytes).digest('hex');
  const options={desktopRoot:root,runtimePkg,runtimeSha256,output:path.join(root,'out'),version:'0.3.9'};
  const config=await prepareMacInstaller(options);
  assert.equal(config.appId,'com.mycellios.agent.desktop');assert.deepEqual(config.mac.target,[{target:'dmg',arch:['arm64']},{target:'zip',arch:['arm64']}]);
  assert.equal(config.mac.notarize,false);assert.equal(config.mac.identity,'-');assert.equal(config.mac.strictVerify,true);assert.equal(config.mac.hardenedRuntime,false);assert.deepEqual(config.publish,[]);
  assert.equal(config.extraResources.some(r=>r.to==='contribution/mycellios-runtime.pkg'),true);assert.equal(config.extraResources.filter(r=>r.to.startsWith('licenses/')).length,3);
  assert.equal(JSON.parse(await readFile(path.join(root,'out/runtime.json'))).sha256,runtimeSha256);
  await assert.rejects(prepareMacInstaller({...options,runtimeSha256:'0'.repeat(64)}),/hash mismatch/);
  await assert.rejects(prepareMacInstaller({...options,version:'../wrong'}),/version/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('Intel Desktop targets x64 and cannot accidentally bundle the ARM runtime',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'mycellios-intel-test-'));
 try{
  const options={desktopRoot:root,output:path.join(root,'out'),version:'0.3.9',arch:'x64'};
  const config=await prepareMacInstaller(options);
  assert.deepEqual(config.mac.target,[{target:'dmg',arch:['x64']},{target:'zip',arch:['x64']}]);assert.equal(config.mac.minimumSystemVersion,'13.0');
  assert.equal(config.extraResources.some(r=>r.to.startsWith('contribution/')),false);assert(config.artifactName.includes('macos-x64'));
  await assert.rejects(prepareMacInstaller({...options,runtimePkg:'incompatible-arm.pkg',runtimeSha256:'a'.repeat(64)}),/must not bundle/);
  await assert.rejects(prepareMacInstaller({...options,arch:'ia32'}),/Unsupported/);
 }finally{await rm(root,{recursive:true,force:true});}
});
