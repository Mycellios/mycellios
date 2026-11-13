import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {validateReleaseIndex,desktopPlatforms} from './desktop-release-index.mjs';
import {ingestRelease,channelServer,synchronize} from '../deploy/desktop-release/channel.mjs';

function fixture(version='0.3.48') {
 const bytes=new Map(),assets=[],packages=[];
 const add=(name,body)=>{const b=Buffer.from(body);bytes.set(name,b);assets.push({name,bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')});return name;};
 for(const id of desktopPlatforms){const extension=id.startsWith('windows')?'exe':id.startsWith('macos')?'dmg':id==='fedora-x64'?'rpm':id==='linux-appimage-x64'?'AppImage':'deb';
  packages.push({id,fileName:add(`Mycellios-Desktop-${version}-${id}.${extension}`,id),format:extension==='AppImage'?extension:extension.toUpperCase(),qualifiedStartup:true,signed:false,notarized:false,automaticUpdates:id==='linux-appimage-x64'});}
 const feeds={};for(const channel of ['windows/x64','macos/arm64','macos/x64','linux/x64'])feeds[channel]={fileName:add(`latest-${channel.replace('/','-')}.yml`,'version: '+version),automaticUpdates:channel==='linux/x64'};
 const source=add(`Mycellios-Desktop-${version}-source-aaaaaaaa.tar.gz`,'source');
 return {index:{schema:'mycellios-desktop-release-index/1',version,revision:'a'.repeat(40),tree:'b'.repeat(40),tag:'desktop-v'+version,workflowRunId:'123',assets,packages,feeds,source},bytes};
}
async function temporary(t){const root=await mkdtemp(path.join(tmpdir(),'mycellios-channel-'));t.after(()=>rm(root,{recursive:true,force:true}));const f=fixture('0.3.47');const catalog={schema:'mycellios-desktop-downloads/1',version:'0.3.47',channel:'preview',automaticUpdates:false,source:{path:'/source',sha256:'c'.repeat(64)},packages:f.index.packages.filter(p=>!['fedora-x64','linux-appimage-x64'].includes(p.id)).map(p=>({...p,path:`/downloads/desktop/releases/0.3.47/${p.fileName}`}))};for(const name of ['catalog.json','catalog-macos.json','catalog-macos-all.json'])await writeFile(path.join(root,name),JSON.stringify(catalog));return root;}
const response=(data,status=200)=>new Response(typeof data==='string'||Buffer.isBuffer(data)?data:JSON.stringify(data),{status});
test('complete identity rejects missing/duplicate platforms, unsafe names and unsigned automatic channels',()=>{
 const {index}=fixture();assert.equal(validateReleaseIndex(index),index);
 for(const mutate of [x=>x.packages.pop(),x=>x.packages.push(x.packages[0]),x=>x.assets[0].name='../installer.exe',x=>x.packages[0].automaticUpdates=true,x=>delete x.feeds['macos/x64'],x=>x.feeds['windows/x64'].automaticUpdates=true,x=>x.tree='bad']){const bad=structuredClone(index);mutate(bad);assert.throws(()=>validateReleaseIndex(bad));}
});
test('checksum failure preserves every public catalog and no current pointer is published',async t=>{
 const root=await temporary(t),{index,bytes}=fixture(),before=await readFile(path.join(root,'catalog-macos-all.json'),'utf8');let count=0;
 await assert.rejects(ingestRelease(root,index,async url=>response(++count===3?'corrupted':bytes.get(url.split('/').pop()))),/checksum|Oversized/);
 assert.equal(await readFile(path.join(root,'catalog-macos-all.json'),'utf8'),before);await assert.rejects(readFile(path.join(root,'current-desktop.json')),/ENOENT/);
});
test('complete promotion is idempotent, immutable and never downgrades',async t=>{
 const root=await temporary(t),{index,bytes}=fixture();const request=async url=>response(bytes.get(url.split('/').pop()));
 assert.equal((await ingestRelease(root,index,request)).changed,true);assert.equal((await ingestRelease(root,index,request)).changed,false);
 const catalog=JSON.parse(await readFile(path.join(root,'catalog-macos-all.json')));assert.equal(catalog.version,'0.3.48');assert.equal(catalog.appImage.id,'linux-appimage-x64');assert.equal(catalog.automaticUpdates,false);
 assert.equal((await ingestRelease(root,fixture('0.3.46').index,request)).changed,false);
 const changed=structuredClone(index);changed.revision='c'.repeat(40);await assert.rejects(ingestRelease(root,changed,request),/Immutable/);
});
test('stable URLs redirect without cache and only qualified automatic feeds are served',async t=>{
 const root=await temporary(t),{index,bytes}=fixture(),server=channelServer(root);await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const base='http://127.0.0.1:'+server.address().port;
 const fallback=await fetch(base+'/downloads/desktop/latest/macos-arm64',{redirect:'manual'});assert.equal(fallback.status,302);assert.match(fallback.headers.get('location'),/0\.3\.47/);
 await ingestRelease(root,index,async url=>response(bytes.get(url.split('/').pop())));
 for(const p of index.packages){const r=await fetch(base+'/downloads/desktop/latest/'+p.id,{redirect:'manual'});assert.equal(r.status,302);assert.equal(r.headers.get('cache-control'),'no-store');assert.match(r.headers.get('location'),/0\.3\.48/);}
 assert.equal((await fetch(base+'/downloads/desktop/updates/windows/x64/latest.yml')).status,404);
 assert.equal((await fetch(base+'/downloads/desktop/updates/linux/x64/latest-linux.yml')).status,200);
 assert.equal((await fetch(base+'/downloads/desktop/latest/windows-x64',{method:'POST'})).status,405);
});
test('GitHub release cannot promote before successful main workflow provenance',async t=>{
 const root=await temporary(t),{index}=fixture();let run={status:'in_progress',conclusion:null};
 const request=async url=>response(url.includes('/releases?')?[{draft:false,tag_name:index.tag}]:url.includes('/actions/runs/')?run:index);
 assert.equal((await synchronize(root,request)).reason,'release-workflow-not-complete');
 run={status:'completed',conclusion:'success',head_branch:'untrusted',head_sha:index.revision,path:'.github/workflows/desktop-release.yml',head_repository:{full_name:'Mycellios/mycellios'}};
 await assert.rejects(synchronize(root,request),/Untrusted/);await assert.rejects(readFile(path.join(root,'current-desktop.json')),/ENOENT/);
});
test('symlinked asset directories are not followed',async t=>{
 if(process.platform==='win32')return t.skip('Unix service symlink boundary');
 const {symlink}=await import('node:fs/promises');const root=await temporary(t),elsewhere=path.join(root,'unowned');await mkdir(elsewhere);await symlink(elsewhere,path.join(root,'releases'));
 await assert.rejects(ingestRelease(root,fixture().index),/Unsafe/);
});
