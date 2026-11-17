import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {latestDownloadsServer} from '../deploy/installers/latest-downloads.mjs';

const github=(release,fileName)=>`https://github.com/Mycellios/mycellios/releases/download/desktop-v${release}-windows-preview/${fileName}`;

test('permanent downloads resolve all architectures from the current verified catalog without caching',async t=>{
 const root=await mkdtemp(path.join(tmpdir(),'mycellios-latest-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const server=latestDownloadsServer(root,{origin:'local'});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const cdn=latestDownloadsServer(root);await new Promise(r=>cdn.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>cdn.close(r)));
 const base='http://127.0.0.1:'+server.address().port, cdnBase='http://127.0.0.1:'+cdn.address().port;
 const cdnLocation=async id=>(await fetch(cdnBase+'/downloads/desktop/latest/'+id,{redirect:'manual'})).headers.get('location');
 const catalog={schema:'mycellios-desktop-downloads/1',version:'0.3.48',runtimeVersion:'0.2.95',channel:'preview',automaticUpdates:false,source:{path:'/downloads/desktop/releases/0.3.48/source.tar.gz',sha256:'a'.repeat(64)},packages:[['windows-x64','EXE'],['linux-x64','DEB'],['macos-arm64','DMG'],['macos-x64','DMG']].map(([id,format])=>({id,format,fileName:id+'.'+format.toLowerCase(),path:'/downloads/desktop/releases/0.3.48/'+id+'.'+format.toLowerCase(),sha256:'b'.repeat(64),bytes:1}))};
 catalog.fedora={id:'fedora-x64',version:catalog.version,format:'RPM',fileName:'fedora.rpm',path:'/downloads/desktop/releases/0.3.48/fedora.rpm',sha256:'c'.repeat(64),bytes:1,source:catalog.source};
 const location=async id=>fetch(base+'/downloads/desktop/latest/'+id,{redirect:'manual'});
 assert.equal((await location('windows-x64')).status,503);
 const publish=()=>writeFile(path.join(root,'catalog-macos-all.json'),JSON.stringify(catalog));await publish();
 for(const p of [...catalog.packages,catalog.fedora]){
  const r=await location(p.id);assert.equal(r.status,302);assert.equal(r.headers.get('location'),p.path);assert.equal(r.headers.get('cache-control'),'no-store');
  // The default origin is the release asset the publisher verified for this exact file.
  assert.equal(await cdnLocation(p.id),github('0.3.48',p.fileName));
 }
 catalog.packages[2].version='0.3.49';catalog.packages[2].source={path:'/downloads/desktop/releases/0.3.49/source.tar.gz',sha256:'e'.repeat(64)};catalog.packages[2].path='/downloads/desktop/releases/0.3.49/macos-arm64.dmg';await publish();
 assert.match((await location('macos-arm64')).headers.get('location'),/0\.3\.49/);
 assert.equal(await cdnLocation('macos-arm64'),github('0.3.49','macos-arm64.dmg'));
 assert.equal(await cdnLocation('windows-x64'),github('0.3.48','windows-x64.exe'));
 assert.equal((await fetch(base+'/downloads/desktop/latest/windows-x64',{method:'POST'})).status,405);
 assert.equal((await location('unsupported')).status,404);
 catalog.packages[0].path='https://attacker.invalid/installer.exe';await publish();
 assert.equal((await location('windows-x64')).status,503);
 assert.equal((await fetch(cdnBase+'/downloads/desktop/latest/windows-x64',{redirect:'manual'})).status,503);
});

test('rejects an unknown downloads origin',()=>{
 assert.throws(()=>latestDownloadsServer(tmpdir(),{origin:'https://attacker.invalid'}),/Unknown downloads origin/);
});
