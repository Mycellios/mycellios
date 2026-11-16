import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {publishRuntimeComponents,resolveRuntimeRelease,validateRuntimeComponent} from './publish-runtime-components.mjs';
test('component publication deduplicates immutable verified payloads and rejects changed assets',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'runtime-publication-'));const revision='a'.repeat(40),releases=new Map();let creates=0;
 try{
  for(const [platform,ext] of [['windows','msi'],['linux','deb'],['macos-arm64','pkg']]){
   const body=Buffer.from('fixture-'+ext),sha256=createHash('sha256').update(body).digest('hex');
   const directory=path.join(root,`desktop-${platform}-${revision}`,'runtime-component');await mkdir(directory,{recursive:true});
   const c={schema:'mycellios-desktop-runtime/2',file:`mycellios-runtime.${ext}`,sha256,bytes:body.length,url:`https://github.com/Mycellios/mycellios/releases/download/desktop-runtime-${sha256}/mycellios-runtime.${ext}`};
   await writeFile(path.join(directory,c.file),body);await writeFile(path.join(directory,'component.json'),JSON.stringify(c));
   for(const patch of [{bytes:0},{url:c.url+'?x=1'},{file:'../runtime.pkg'}])assert.throws(()=>validateRuntimeComponent({...c,...patch},ext));
  }
  const api=async resource=>{
   if(!resource.startsWith('releases/tags/'))return [...releases.values()].find(r=>String(r.id)===resource.replace('releases/',''))??null;
   const release=releases.get(resource.replace('releases/tags/',''));
   return release&&!release.draft?release:null;
  };
  const gh=(...args)=>{
   assert.equal(args[0],'release');const tag=args[2];
   if(args[1]==='view'){
    const release=releases.get(tag);
    if(!release)throw Object.assign(Error('Missing release'),{stderr:'release not found'});
    return JSON.stringify({apiUrl:`https://api.github.com/repos/Mycellios/mycellios/releases/${release.id}`,isDraft:release.draft});
   }
   if(args[1]==='create'){creates++;releases.set(tag,{id:creates,tag_name:tag,draft:true,assets:[]});}
   else if(args[1]==='upload'){
    const bytes=readFileSync(args[3]);releases.get(tag).assets.push({name:path.basename(args[3]),size:bytes.length,digest:'sha256:'+createHash('sha256').update(bytes).digest('hex')});
   }else if(args[1]==='edit')releases.get(tag).draft=false;
   else throw Error('Unexpected publication action');
  };
  await publishRuntimeComponents({input:root,revision,gh,api});assert.equal(creates,3);
  await publishRuntimeComponents({input:root,revision,gh,api});assert.equal(creates,3);
  releases.values().next().value.draft=true;
  await publishRuntimeComponents({input:root,revision,gh,api});assert.equal(creates,3);
  assert.equal(releases.values().next().value.draft,false);
  releases.values().next().value.assets[0].size++;
  await assert.rejects(publishRuntimeComponents({input:root,revision,gh,api}),/changed/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('resolves a hidden draft through only the first-party CLI release id',async()=>{
 const tag='desktop-runtime-'+'a'.repeat(64),release={id:42,tag_name:tag,draft:true,assets:[]},calls=[];
 const api=async resource=>{calls.push(resource);return resource==='releases/42'?release:null;};
 const gh=(...args)=>{assert.deepEqual(args,['release','view',tag,'--repo','Mycellios/mycellios','--json','apiUrl,isDraft']);return JSON.stringify({apiUrl:'https://api.github.com/repos/Mycellios/mycellios/releases/42',isDraft:true});};
 assert.equal(await resolveRuntimeRelease(tag,{gh,api}),release);
 assert.deepEqual(calls,['releases/tags/'+tag,'releases/42']);
});

test('rejects arbitrary URLs, foreign identities and changed draft state without writes',async()=>{
 const tag='desktop-runtime-'+'b'.repeat(64);
 for(const apiUrl of ['https://example.com/repos/Mycellios/mycellios/releases/42','https://api.github.com/repos/other/repo/releases/42','https://api.github.com/repos/Mycellios/mycellios/releases/42?token=x','https://api.github.com/repos/Mycellios/mycellios/releases/9007199254740992']){
  let reads=0;
  await assert.rejects(resolveRuntimeRelease(tag,{gh:()=>JSON.stringify({apiUrl,isDraft:true}),api:async()=>{reads++;return null;}}),/Untrusted/);
  assert.equal(reads,1);
 }
 for(const patch of [{id:43},{tag_name:'desktop-runtime-'+'c'.repeat(64)},{draft:false}]){
  await assert.rejects(resolveRuntimeRelease(tag,{gh:()=>JSON.stringify({apiUrl:'https://api.github.com/repos/Mycellios/mycellios/releases/42',isDraft:true}),api:async resource=>resource==='releases/42'?{id:42,tag_name:tag,draft:true,assets:[],...patch}:null}),/identity differs|state changed/);
 }
 const denied=Object.assign(Error('Access denied'),{stderr:'HTTP 403: resource not accessible'});
 await assert.rejects(resolveRuntimeRelease(tag,{api:async()=>null,gh:()=>{throw denied;}}),error=>error===denied);
});
