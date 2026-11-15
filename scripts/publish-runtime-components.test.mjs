import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {publishRuntimeComponents,validateRuntimeComponent} from './publish-runtime-components.mjs';
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
  const api=async resource=>releases.get(resource.replace('releases/tags/',''))??null;
  const gh=(...args)=>{
   assert.equal(args[0],'release');const tag=args[2];
   if(args[1]==='create'){creates++;releases.set(tag,{draft:true,assets:[]});}
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
