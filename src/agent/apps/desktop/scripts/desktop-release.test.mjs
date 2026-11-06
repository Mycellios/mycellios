import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {assertReleaseIdentity, releaseTag, writeWindowsRelease} from './desktop-release.mjs';

function identity() {
  const version = '0.3.17', sourceHash = 'c'.repeat(64);
  return {schema:'mycellios-desktop-build/1',version,revision:'a'.repeat(40),tree:'b'.repeat(40),
    platform:'windows-x64',automaticUpdates:false,sourceHash,
    surfaces:Object.fromEntries(['web','desktop','local-server'].map(surface=>[surface,
      {schema:'mycellios-desktop-release/1',surface,version,sourceHash,outputHash:'d'.repeat(64)}]))};
}

test('compact releases refuse missing, mismatched or slow installation evidence',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'desktop-release-compact-'));
  assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir())+path.sep+'desktop-release-compact-'));
  try{
    const build=identity();build.version='0.3.19';
    for(const surface of Object.values(build.surfaces))surface.version=build.version;
    const name=`Mycellios-Desktop-${build.version}-windows-x64-pilot.exe`,bytes=Buffer.from('candidate fixture');
    await writeFile(path.join(root,name),bytes);await writeFile(path.join(root,name+'.blockmap'),'fixture');
    const sha=createHash('sha256').update(bytes).digest('hex');
    const smoke={passed:true,version:build.version,revision:build.revision,isolatedProfile:true,installerSha256:sha};
    await assert.rejects(writeWindowsRelease(root,build,smoke),/installation timing/);
    const installation={passed:true,version:build.version,revision:build.revision,installerSha256:sha,measurements:['fresh','legacy-to-compact'].map(label=>({label,exitCode:0,elapsedMs:5000,draftsPreserved:5,taskMarkersPreserved:5}))};
    const slow=structuredClone(installation);slow.measurements[1].elapsedMs=61000;
    await assert.rejects(writeWindowsRelease(root,build,{...smoke,installation:slow}),/installation timing/);
    await assert.rejects(writeWindowsRelease(root,build,{...smoke,installation:{...installation,installerSha256:'0'.repeat(64)}}),/installation timing/);
    await writeFile(path.join(root,'desktop-build.json'),JSON.stringify(build));
    await writeFile(path.join(root,'packaged-smoke.json'),JSON.stringify({...smoke,installation}));
    await writeFile(path.join(root,'installer-qualification.json'),JSON.stringify(installation));
    const release=await writeWindowsRelease(root,build,{...smoke,installation});
    assert.equal(release.qualifiedInstallation,true);
    assert.match(await readFile(path.join(root,'SHA256SUMS.txt'),'utf8'),/installer-qualification\.json/);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('rejects mixed or stale frontend/native/backend builds and invalid candidate identity',()=>{
  const original=identity();assert.doesNotThrow(()=>assertReleaseIdentity(original,original.version));
  for(const surface of ['web','desktop','local-server']){
    const mixed=structuredClone(original);mixed.surfaces[surface].sourceHash='e'.repeat(64);
    assert.throws(()=>assertReleaseIdentity(mixed,original.version),/Mixed/);
  }
  assert.throws(()=>assertReleaseIdentity({...original,revision:'main'},original.version),/identity/);
  assert.throws(()=>assertReleaseIdentity(original,'0.3.16'),/identity/);
  assert.throws(()=>releaseTag('../main'),/version/);
});
test('creates the versioned installer feed from the exact qualified artifact and blockmap',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'desktop-release-'));
  try{
    const build=identity(),name=`Mycellios-Desktop-${build.version}-windows-x64-pilot.exe`;
    const bytes=Buffer.from('controlled executable fixture');
    await writeFile(path.join(root,name),bytes);
    const smoke={passed:true,version:build.version,revision:build.revision,isolatedProfile:true,
      installerSha256:createHash('sha256').update(bytes).digest('hex')};
    await assert.rejects(writeWindowsRelease(root,build,smoke),/ENOENT/);
    await writeFile(path.join(root,name+'.blockmap'),'controlled blockmap fixture');
    await assert.rejects(writeWindowsRelease(root,build,{...smoke,revision:'f'.repeat(40)}),/qualification/);
    const release=await writeWindowsRelease(root,build,smoke);
    assert.equal(release.tag,'desktop-v0.3.17-windows-preview');
    assert.equal(release.automaticUpdates,false);
    assert.equal(release.artifact.sha256,createHash('sha256').update(bytes).digest('hex'));
    assert.equal(release.artifact.bytes,bytes.length);
    const feed=await readFile(path.join(root,'latest.yml'),'utf8');
    assert.ok(feed.includes(createHash('sha512').update(bytes).digest('base64')));
    assert.ok(feed.includes('size: '+bytes.length));
    assert.deepEqual(JSON.parse(await readFile(path.join(root,'desktop-release.json'),'utf8')),release);
    await writeFile(path.join(root,name),'changed artifact');
    await assert.rejects(writeWindowsRelease(root,build,smoke),/changed after qualification/);
  }finally{await rm(root,{recursive:true,force:true});}
});
