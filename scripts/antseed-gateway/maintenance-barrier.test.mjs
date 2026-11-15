import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {attachBarrier,isNewAdmission,installRuntimeBarrier,runtimeBarrierStatus,restoreRuntimeBarrier} from './maintenance-barrier.mjs';
test('allows completion/receipt/worker traffic and blocks new paid admission only',()=>{
 for(const path of ['/v1/jobs','/v1/chat/completions','/v1/embeddings','/v1/audio/speech','/v1/audio/transcriptions','/v1/managed/quote','/v1/browser/inferences','/public/v1/assistant/chat','/local/v1/benchmarks/run'])assert(isNewAdmission('POST',path,'coordinator'));
 for(const path of ['/v1/jobs/job/result','/v1/workers/heartbeat','/internal/v1/workers/admission-challenge','/v1/managed/requests/x','/v1/models'])assert(!isNewAdmission('POST',path,'coordinator'));
 assert(!isNewAdmission('GET','/v1/chat/completions','coordinator'));
 assert(isNewAdmission('POST','/fal/v1/video/queue','gateway'));assert(!isNewAdmission('POST','/fal/v1/video/retrieve','gateway'));
});
test('keeps an admitted response alive and fences the next request on the same keepalive connection',async()=>{
 let release,started;const active=new Promise(resolve=>started=resolve);
 const server=http.createServer((req,res)=>{req.resume();req.on('end',()=>{if(req.url==='/v1/chat/completions'&&!release){release=()=>res.end('original completed');started();}else res.end('normal');});});
 server.listen(0,'127.0.0.1');await once(server,'listening');const port=server.address().port;
 const agent=new http.Agent({keepAlive:true,maxSockets:1});
 const call=(path,method='POST')=>new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port,path,method,agent,headers:{'content-length':2}},res=>{let body='';res.on('data',v=>body+=v);res.on('end',()=>resolve({status:res.statusCode,body}));});req.on('error',reject);req.end('{}');});
 try {
  const admitted=call('/v1/chat/completions');await active;
  installRuntimeBarrier(port,'coordinator');assert.equal(runtimeBarrierStatus(port).activeHttp,1);assert.equal(runtimeBarrierStatus(port).activeAdmissions,1);
  const blocked=call('/v1/chat/completions');release();assert.deepEqual(await admitted,{status:200,body:'original completed'});
  assert.equal((await blocked).status,503);assert.equal(runtimeBarrierStatus(port).activeHttp,0);
  assert.equal((await call('/v1/models','GET')).status,200);restoreRuntimeBarrier(port);
  assert.equal((await call('/v1/chat/completions')).status,200);
 }finally{agent.destroy();server.close();await once(server,'close');}
});
test('does not confuse an open telemetry subscription with an admitted inference',async()=>{
 const server=http.createServer((req,res)=>{res.writeHead(200,{'content-type':'text/event-stream'});res.write(': connected\n\n');});
 server.listen(0,'127.0.0.1');await once(server,'listening');const port=server.address().port;
 const request=http.get({host:'127.0.0.1',port,path:'/public/v1/events'});
 request.on('error',()=>{});const [response]=await once(request,'response');response.resume();
 try{installRuntimeBarrier(port,'coordinator');assert.equal(runtimeBarrierStatus(port).activeHttp,1);assert.equal(runtimeBarrierStatus(port).activeAdmissions,0);restoreRuntimeBarrier(port);assert(!response.destroyed,'Telemetry must not be cancelled by fencing');}
 finally{request.destroy();server.closeAllConnections();server.close();await once(server,'close');}
});
test('does not clobber a server with other request wrappers',async()=>{
 const server=http.createServer(()=>{});server.on('request',()=>{});assert.throws(()=>attachBarrier(server,'coordinator'));
});
