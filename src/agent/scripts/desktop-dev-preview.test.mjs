import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {seedDevelopmentPreview} from './desktop-dev-preview.mjs';
const user={id:'local-developer',email:'developer@mycellios.invalid'};
const empty={me:{userId:user.id,billingEnabled:false},bots:[],archivedBots:[],groups:[],archivedGroups:[],spaces:[]};
async function fixture(t) {
  const profile=await mkdtemp(path.join(os.tmpdir(),'mycellios-dev-preview-'));t.after(()=>rm(profile,{recursive:true,force:true}));
  return {profile,url:'http://127.0.0.1:12345',user,cookie:'local-session=fixture'};
}
test('the preview never seeds a remote origin or a real user',async t=>{
  const options=await fixture(t);let calls=0;const fetcher=async()=>{calls++;throw Error('Unexpected request');};
  await assert.rejects(seedDevelopmentPreview({...options,url:'https://www.mycellios.com'},fetcher));
  await assert.rejects(seedDevelopmentPreview({...options,user:{...user,email:'real@example.test'}},fetcher));
  assert.equal(calls,0);
});
test('the preview rejects a mismatched identity or live billing before any write',async t=>{
  const options=await fixture(t);
  for(const me of [{userId:'other',billingEnabled:false},{userId:user.id,billingEnabled:true}]) {
    let calls=0;await assert.rejects(seedDevelopmentPreview(options,async()=>{calls++;return Response.json({json:{...empty,me}});}));assert.equal(calls,1);
  }
});
test('one inert import is seeded once, with no model, credential, routine or generation request',async t=>{
  const options=await fixture(t),calls=[];
  const fetcher=async(url,init)=>{
    const route=new URL(url).pathname;calls.push({route,body:JSON.parse(init.body).json});
    if(route==='/rpc/bootstrap')return Response.json({json:empty});
    if(route==='/rpc/bots/importPreview')return Response.json({json:{instructions:[{id:'instructions-1'}]}});
    if(route==='/rpc/bots/importCreate')return Response.json({json:{id:'preview-mico'}});
    throw Error('Unexpected request');
  };
  const result=await seedDevelopmentPreview(options,fetcher);assert.equal(result.botId,'preview-mico');
  assert.deepEqual(calls.map(call=>call.route),['/rpc/bootstrap','/rpc/bots/importPreview','/rpc/bots/importCreate']);
  assert.equal(calls[2].body.includeSecrets,false);assert.deepEqual(calls[2].body.selection,{instructions:['instructions-1'],memory:[],skills:[],model:false,mcpServers:[],routines:[],apiKeys:[]});
  assert.equal(JSON.parse(await readFile(path.join(options.profile,'preview.json'),'utf8')).userId,user.id);
  assert.deepEqual(await seedDevelopmentPreview(options,()=>{throw Error('A repeat must not change the profile');}),result);
});
test('existing or archived work is preserved instead of reseeding the profile',async t=>{
  const options=await fixture(t);let calls=0;
  const result=await seedDevelopmentPreview(options,async()=>{calls++;return Response.json({json:{...empty,archivedBots:[{id:'previous'}]}});});
  assert.equal(result.seeded,false);assert.equal(calls,1);
});
