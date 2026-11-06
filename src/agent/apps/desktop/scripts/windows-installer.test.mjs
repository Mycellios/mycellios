import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { prepareWindowsInstaller,writeStandaloneWindowsConfig } from './windows-installer.mjs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);

test('bundles the verified runtime without accounts or shared-node uninstall actions', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mycellios-installer-'));
  try {
    const runtimeMsi = path.join(root, 'runtime.msi'); const bytes = Buffer.from('fixture');
    await writeFile(runtimeMsi, bytes);
    const runtimeSha256 = createHash('sha256').update(bytes).digest('hex');
    const config = await prepareWindowsInstaller({ desktopRoot: root, runtimeMsi, runtimeSha256, output: path.join(root, 'out'), version: '0.3.5', development: {source: path.join(root,'source'),npm: path.join(root,'npm')} });
    assert.equal(config.appId, 'com.mycellios.agent.desktop');
    assert.equal(config.nsis.deleteAppDataOnUninstall, false);
    assert.equal(config.nsis.useZip, false);
    assert.deepEqual(config.extraResources.find(x=>x.to==='koffi/win32_x64/koffi.node'), {
      from: path.resolve(root,'../../node_modules/@koromix/koffi-win32-x64/win32_x64/koffi.node'),
      to: 'koffi/win32_x64/koffi.node',
    });
    assert.equal(config.beforePack, path.join(root,'scripts/verify-release.cjs'));
    assert.equal(config.extraResources.some(x=>x.to==='local-server'),true);
    assert.deepEqual(config.publish, [{provider:'generic',url:'https://www.mycellios.com/downloads/desktop/updates/windows'}]);
    assert.equal(config.extraResources.some(r=>r.to==='development-source'),true);
    assert.equal(config.extraResources.some(r=>r.to==='development-tools/npm'),true);
    assert.equal(config.win.verifyUpdateCodeSignature, true);
    assert.equal(config.extraResources.some(x => x.to === 'contribution/mycellios-runtime.msi'), true);
    const compact = await prepareWindowsInstaller({desktopRoot:root,runtimeMsi,runtimeSha256,output:path.join(root,'compact-out'),version:'0.3.19',compact:{server:path.join(root,'compact-server'),source:path.join(root,'source.asar'),npm:path.join(root,'npm.asar')}});
    assert.equal(compact.extraResources.find(x=>x.to==='local-server/node_modules').from,path.join(root,'compact-server/node_modules'));
    await mkdir(path.join(root,'compact-server/node_modules/native-shim'),{recursive:true});
    await writeFile(path.join(root,'compact-server/runtime.asar'),'Archive fixture');
    await writeFile(path.join(root,'compact-server/node_modules/native-shim/binding.node'),'Native fixture');
    const {getFileMatchers,copyFiles}=require('app-builder-lib/out/fileMatcher.js');
    const destination=path.join(root,'copied-resources');
    const matchers=getFileMatchers({extraResources:compact.extraResources.filter(x=>x.to.startsWith('local-server'))},'extraResources',destination,{defaultSrc:root,globalOutDir:path.join(root,'out'),macroExpander:x=>x,customBuildOptions:{}});
    await copyFiles(matchers);
    assert.equal(await readFile(path.join(destination,'local-server/runtime.asar'),'utf8'),'Archive fixture');
    assert.equal(await readFile(path.join(destination,'local-server/node_modules/native-shim/binding.node'),'utf8'),'Native fixture');
    assert.equal(compact.extraResources.some(x=>x.to==='development-source.asar'),true);
    assert.equal(compact.nsis.include,path.join(root,'assets/fast-install.nsh'));
    assert.equal(JSON.parse(await readFile(path.join(root, 'out/runtime.json'))).sha256, runtimeSha256);
    const text = JSON.stringify(config);
    assert.equal(/enrollmentToken|apiKey|password|\.env/.test(text), false);
    await assert.rejects(prepareWindowsInstaller({ desktopRoot: root, runtimeMsi, runtimeSha256: '0'.repeat(64), output: path.join(root, 'out'), version: '0.3.5' }), /hash mismatch/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('actual builder config keeps voice settings without merging the legacy resource arrays',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'mycellios-builder-config-'));
  try{
    const legacy={from:'legacy-server',to:'local-server'};
    const compact={from:'compact-server',to:'local-server'};
    const voice=['**/node_modules/sherpa-onnx*/**','dist/voice-node*'];
    await writeFile(path.join(root,'package.json'),JSON.stringify({name:'fixture',version:'0.3.19',build:{extraResources:[legacy],asarUnpack:voice,win:{verifyUpdateCodeSignature:true}}}));
    const file=await writeStandaloneWindowsConfig(root,{extraResources:[compact],win:{target:'nsis'}},root);
    const {getConfig}=require('app-builder-lib/out/util/config/config.js');
    const effective=await getConfig(root,file,null);
    assert.deepEqual(effective.extraResources,[compact]);
    assert.deepEqual(effective.asarUnpack,voice);
    assert.equal(effective.win.verifyUpdateCodeSignature,true);
    assert.equal(effective.win.target,'nsis');
  }finally{await rm(root,{recursive:true,force:true});}
});

