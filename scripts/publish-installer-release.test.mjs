import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {assertMainStillAdmits,publishInstallerAssets,resolveFirstPartyRelease} from './release-publication.mjs';

const revision='a'.repeat(40),tag='desktop-v0.3.56-windows-preview';
async function fixture(run){
 const out=await mkdtemp(path.join(os.tmpdir(),'installer-publication-'));
 try{
  const artifacts=[];
  for(const [fileName,body] of [['setup.exe','qualified fixture'],['installer-release.json','qualified metadata']]){
   const bytes=Buffer.from(body);await writeFile(path.join(out,fileName),bytes);
   artifacts.push({fileName,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
  }
  const state={release:null,tagged:null,creates:0,uploads:[],edits:0,refs:0,reads:[],mainChecks:0,failUpload:false,corruptUpload:false,mainAdvances:false};
  const identity=()=>({id:42,tag_name:tag,target_commitish:revision,draft:true,assets:[]});
  const source=()=>({ref:`refs/tags/${tag}`,object:{type:'commit',sha:revision}});
  const asset=a=>({name:a.fileName,size:a.bytes,digest:`sha256:${a.sha256}`});
  const api=async resource=>{
   state.reads.push(resource);
   if(resource===`git/ref/tags/${tag}`)return state.tagged;
   if(resource===`releases/tags/${tag}`)return state.release&&!state.release.draft?state.release:null;
   if(resource==='releases/42')return state.release;
   throw Error('Unexpected API resource');
  };
  const gh=(...args)=>{
   assert(!args.includes('--clobber'));
   if(args[0]==='api'){
    assert.deepEqual(args,['api','repos/Mycellios/mycellios/git/refs','-f',`ref=refs/tags/${tag}`,'-f',`sha=${revision}`]);
    state.refs++;state.tagged=source();return '';
   }
   assert.equal(args[0],'release');assert.equal(args[2],tag);
   if(args[1]==='view'){
    if(!state.release)throw Object.assign(Error('Missing release'),{stderr:'release not found'});
    return JSON.stringify({apiUrl:'https://api.github.com/repos/Mycellios/mycellios/releases/42',isDraft:state.release.draft});
   }
   if(args[1]==='create'){
    assert(!state.release);assert(args.includes('--verify-tag'));assert.equal(args[args.indexOf('--target')+1],revision);
    state.creates++;state.release=identity();return '';
   }
   if(args[1]==='upload'){
    const names=args.slice(3).map(file=>path.basename(file));state.uploads.push(names);
    for(const file of args.slice(3)){
     const bytes=readFileSync(file),name=path.basename(file);assert(!state.release.assets.some(a=>a.name===name));
     state.release.assets.push({name,size:bytes.length,digest:'sha256:'+(state.corruptUpload?'f'.repeat(64):createHash('sha256').update(bytes).digest('hex'))});
     if(state.failUpload){state.failUpload=false;throw Error('Synthetic interrupted upload');}
    }
    return '';
   }
   if(args[1]==='edit'){state.edits++;state.release.draft=false;return '';}
   throw Error('Unexpected CLI operation');
  };
  const publish=(patch={})=>publishInstallerAssets({out,tag,revision,artifacts,notesFile:path.join(out,'notes.md'),gh,api,
   assertCurrentMain:async()=>{state.mainChecks++;if(state.mainAdvances&&state.mainChecks===2)throw Error('Main advanced');},...patch});
  await run({state,publish,identity,source,asset,artifacts,api,gh});
 }finally{await rm(out,{recursive:true,force:true});}
}

test('resumes a hidden Desktop draft after partial upload without recreating or clobbering assets',()=>fixture(async({state,publish})=>{
 state.failUpload=true;
 await assert.rejects(publish(),/interrupted upload/);
 assert.equal(state.creates,1);assert.equal(state.refs,1);assert.equal(state.release.draft,true);assert.equal(state.release.assets.length,1);
 await publish();
 assert.equal(state.creates,1);assert.equal(state.refs,1);assert.equal(state.edits,1);assert.equal(state.release.draft,false);
 assert.deepEqual(state.uploads,[['setup.exe','installer-release.json'],['installer-release.json']]);
 assert(state.reads.includes('releases/42'));
 await publish();
 assert.equal(state.creates,1);assert.equal(state.uploads.length,2);assert.equal(state.edits,1);
}));

test('refuses a Desktop draft with missing, foreign or changed source selectors before mutation',()=>fixture(async({state,publish,identity,source})=>{
 const cases=[{tagged:null},{tagged:{...source(),ref:'refs/tags/other'}},{tagged:{...source(),object:{type:'tag',sha:revision}}},
  {tagged:{...source(),object:{type:'commit',sha:'b'.repeat(40)}}},{target_commitish:'main'}];
 for(const patch of cases){
  state.release={...identity(),...(patch.target_commitish?{target_commitish:patch.target_commitish}:{})};
  state.tagged=Object.hasOwn(patch,'tagged')?patch.tagged:source();
  await assert.rejects(publish(),/source|target/);
 }
 assert.equal(state.creates,0);assert.equal(state.refs,0);assert.equal(state.uploads.length,0);assert.equal(state.edits,0);
}));

test('preserves immutable assets, rejects duplicates and never fills a published incomplete release',()=>fixture(async({state,publish,identity,source,asset,artifacts})=>{
 state.tagged=source();
 for(const assets of [[{...asset(artifacts[0]),digest:'sha256:'+'f'.repeat(64)}],[{...asset(artifacts[0]),size:1}],
  [asset(artifacts[0]),asset(artifacts[0])]]){
  state.release={...identity(),assets};await assert.rejects(publish(),/different bytes/);
 }
 state.release={...identity(),draft:false,assets:[asset(artifacts[0])]};
 await assert.rejects(publish(),/published release is incomplete/);
 assert.equal(state.creates,0);assert.equal(state.uploads.length,0);assert.equal(state.edits,0);
}));

test('keeps the draft private when GitHub upload digests differ or main advances',()=>fixture(async({state,publish})=>{
 state.corruptUpload=true;await assert.rejects(publish(),/different bytes/);
 assert.equal(state.release.draft,true);assert.equal(state.edits,0);
 state.release=null;state.corruptUpload=false;state.mainChecks=0;state.mainAdvances=true;
 await assert.rejects(publish(),/Main advanced/);assert.equal(state.release.draft,true);assert.equal(state.edits,0);
}));

test('rejects foreign Desktop URLs, release identities and runtime/Desktop pattern confusion',()=>fixture(async({state,api})=>{
 for(const apiUrl of ['https://example.com/repos/Mycellios/mycellios/releases/42','https://api.github.com/repos/other/repo/releases/42','https://api.github.com/repos/Mycellios/mycellios/releases/42?download=1']){
  await assert.rejects(resolveFirstPartyRelease('desktop',tag,{api,gh:()=>JSON.stringify({apiUrl,isDraft:true})}),/Untrusted/);
 }
 await assert.rejects(resolveFirstPartyRelease('desktop','desktop-runtime-'+'a'.repeat(64),{api,gh:()=>{throw Error('Should not call CLI');}}),/Invalid/);
 await assert.rejects(resolveFirstPartyRelease('runtime',tag,{api,gh:()=>{throw Error('Should not call CLI');}}),/Invalid/);
 state.release={id:43,tag_name:tag,target_commitish:revision,draft:true,assets:[]};
 await assert.rejects(resolveFirstPartyRelease('desktop',tag,{api,gh:()=>JSON.stringify({apiUrl:'https://api.github.com/repos/Mycellios/mycellios/releases/42',isDraft:true})}),/identity differs/);
}));

test('rejects unsafe or duplicate local asset names before contacting GitHub',()=>fixture(async({state,publish,artifacts})=>{
 for(const patch of [{fileName:'../secret'},{fileName:undefined},{bytes:0},{sha256:'unknown'}])
  await assert.rejects(publish({artifacts:[{...artifacts[0],...patch}]}),/Invalid qualified/);
 await assert.rejects(publish({artifacts:[artifacts[0],artifacts[0]]}),/Invalid qualified/);
 assert.deepEqual(state.reads,[]);assert.equal(state.creates,0);
}));

test('a qualified revision publishes after main advances only while main keeps its Desktop version',()=>{
 const base={revision,version:'0.10.0',mainContainsRevision:true,mainVersion:'0.10.0'};
 assert.doesNotThrow(()=>assertMainStillAdmits({...base,main:revision}));
 assert.doesNotThrow(()=>assertMainStillAdmits({...base,main:'b'.repeat(40)}));
 assert.throws(()=>assertMainStillAdmits({...base,main:'b'.repeat(40),mainVersion:'0.10.1'}),/another Desktop version; draft retained/);
 assert.throws(()=>assertMainStillAdmits({...base,main:'b'.repeat(40),mainContainsRevision:false}),/no longer contains the qualified revision/);
});
