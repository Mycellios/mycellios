import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,writeFile,readFile,rm}from'node:fs/promises';import {tmpdir}from'node:os';import path from'node:path';import {createHash}from'node:crypto';
import {prepareMacInstaller}from'./macos-installer.mjs';
test('Apple Silicon packaging pins the PKG, preserves identity and keeps unsigned updates disabled',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'mycellios-mac-test-'));
 try{
  const runtimePkg=path.join(root,'runtime.pkg');const bytes=Buffer.from('synthetic PKG fixture');await writeFile(runtimePkg,bytes);const runtimeSha256=createHash('sha256').update(bytes).digest('hex');
  const options={desktopRoot:root,runtimePkg,runtimeSha256,output:path.join(root,'out'),version:'0.3.9'};
  const config=await prepareMacInstaller(options);
  assert.equal(config.appId,'com.mycellios.agent.desktop');assert.deepEqual(config.mac.target,[{target:'dmg',arch:['arm64']},{target:'zip',arch:['arm64']}]);
  assert.equal(config.mac.notarize,false);assert.equal(config.mac.identity,'-');assert.deepEqual(config.publish,[]);
  assert.equal(config.extraResources.some(r=>r.to==='contribution/mycellios-runtime.pkg'),true);assert.equal(config.extraResources.filter(r=>r.to.startsWith('licenses/')).length,3);
  assert.equal(JSON.parse(await readFile(path.join(root,'out/runtime.json'))).sha256,runtimeSha256);
  await assert.rejects(prepareMacInstaller({...options,runtimeSha256:'0'.repeat(64)}),/hash mismatch/);
  await assert.rejects(prepareMacInstaller({...options,version:'../wrong'}),/version/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('Intel packages the current local server and excludes the incompatible ARM runtime',async()=>{
 const config=await prepareMacInstaller({desktopRoot:'/fixture/desktop',arch:'x64',output:'/fixture/output',version:'0.3.48',development:{source:'/fixture/source',npm:'/fixture/npm'}});
 assert.equal(config.mac.identity,'-');assert.equal(config.mac.minimumSystemVersion,'13.0');
 assert.deepEqual(config.mac.target,[{target:'dmg',arch:['x64']},{target:'zip',arch:['x64']}]);
 assert.equal(config.extraResources.some(r=>r.to.startsWith('contribution/')),false);
 assert.equal(config.extraResources.some(r=>r.to==='local-server'),true);
 assert.equal(config.extraResources.some(r=>r.to==='development-source'),true);
 assert.equal(config.extraResources.some(r=>r.to==='development-tools/npm'),true);
 assert.ok(config.beforePack.endsWith('verify-release.cjs'));
 await assert.rejects(prepareMacInstaller({desktopRoot:'/fixture',arch:'x64',version:'0.3.48',runtimePkg:'arm.pkg'}),/ARM/);
});

test('compact Mac resources retain development and server payloads without duplicate loose trees',async()=>{
 const config=await prepareMacInstaller({desktopRoot:'/fixture/desktop',arch:'x64',output:'/fixture/output',version:'0.3.49',development:{source:'/fixture/source',npm:'/fixture/npm'},compact:{server:'/compact/server',source:'/compact/source.asar',npm:'/compact/npm.asar'}});
 for(const [to,from] of [['local-server','/compact/server'],['development-source.asar','/compact/source.asar'],['development-tools/npm.asar','/compact/npm.asar']])assert.deepEqual(config.extraResources.filter(r=>r.to===to),[{to,from}]);
 assert.equal(config.extraResources.some(r=>['local-server/node_modules','development-source','development-tools/npm'].includes(r.to)),false);
 assert.equal(config.mac.identity,'-');assert.equal(config.mac.notarize,false);
});
