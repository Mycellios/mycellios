import {test} from 'node:test';import assert from 'node:assert/strict';
import {fetchNodeRuntimeLicense} from './node-runtime-license.mjs';
const valid='Node.js is licensed for use as follows:\nFixture license';
test('runtime license retries transient failures at the exact versioned URL',async()=>{
 let calls=0;const delays=[];
 const result=await fetchNodeRuntimeLicense('v24.22.2',{sleep:async ms=>delays.push(ms),request:async url=>{
  assert.equal(url,'https://raw.githubusercontent.com/nodejs/node/v24.22.2/LICENSE');calls++;
  if(calls===1)throw Error('connect timeout');if(calls===2)return new Response('unavailable',{status:503});return new Response(valid);
 }});
 assert.equal(result,valid);assert.equal(calls,3);assert.deepEqual(delays,[1000,2000]);
});
test('missing or malformed runtime licenses fail closed',async()=>{
 let calls=0;
 await assert.rejects(fetchNodeRuntimeLicense('v24.22.2',{request:async()=>{calls++;return new Response('missing',{status:404});}}),/HTTP 404/);
 assert.equal(calls,1);
 await assert.rejects(fetchNodeRuntimeLicense('v24.22.2',{request:async()=>new Response('<html>Error</html>')}),/Invalid Node runtime license response/);
 await assert.rejects(fetchNodeRuntimeLicense('../main'),/Invalid Node runtime version/);
});
