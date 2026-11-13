import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {writeStandaloneInstallerConfig} from './standalone-installer-config.mjs';
test('standalone Mac config replaces legacy arrays and preserves voice and platform defaults',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'mycellios-standalone-config-'));
 try{
  const voice=['dist/voice-node*'];
  await writeFile(path.join(root,'package.json'),JSON.stringify({build:{extraResources:[{from:'legacy',to:'local-server'}],files:['old'],asarUnpack:voice,mac:{entitlements:'owned.plist',notarize:true}}}));
  const resources=[{from:'compact',to:'local-server'}];
  const config=JSON.parse(await readFile(await writeStandaloneInstallerConfig(root,{extraResources:resources,files:['dist/**/*'],mac:{identity:'-',notarize:false}},root,'macos-installer-config.json')));
  assert.deepEqual(config.extraResources,resources);assert.deepEqual(config.files,['dist/**/*']);assert.deepEqual(config.asarUnpack,voice);
  assert.equal(config.mac.entitlements,'owned.plist');assert.equal(config.mac.identity,'-');assert.equal(config.mac.notarize,false);assert.equal(config.extends,null);
 }finally{await rm(root,{recursive:true,force:true});}
});
