const installed=new Map();
export function isNewAdmission(method,url,profile) {
  if(method!=='POST')return false;
  const path=String(url??'').split('?')[0];
  if(profile==='coordinator')return ['/v1/jobs','/v1/chat/completions','/v1/embeddings','/v1/audio/speech','/v1/audio/transcriptions','/v1/responses','/v1/messages','/v1/browser/inferences','/v1/browser/inferences/quote','/public/v1/assistant/chat','/local/v1/benchmarks/run'].includes(path)||/^\/v1\/managed\/(?:quote|execute|media\/quote|media\/execute|video-edit\/quote|video-edit\/execute)$/.test(path);
  if(profile==='gateway')return /^\/v1\/(?:chat\/completions|responses|messages|images\/(?:generations|edits)|audio\/speech|systemone)$/.test(path)||/^\/(?:api\/v1|fal\/v1)\/video\/queue$/.test(path);
  throw new Error('unknown_admission_profile');
}
export function attachBarrier(server,profile) {
  const originals=server.listeners('request');
  if(originals.length!==1)throw new Error('unexpected_http_request_handlers');
  const original=originals[0];let refused=0;
  const handler=(req,res)=>{
    if(isNewAdmission(req.method,req.url,profile)){
      refused++;req.resume();res.writeHead(503,{'content-type':'application/json','retry-after':'5','cache-control':'no-store'});
      res.end(JSON.stringify({error:{code:'maintenance_admission_paused',message:'New inference is temporarily paused for an update. Retry shortly.'}}));return;
    }
    original.call(server,req,res);
  };
  server.removeListener('request',original);server.on('request',handler);
  return {profile,blocked:()=>refused,restore(){if(!server.listeners('request').includes(handler))throw new Error('barrier_handler_changed');server.removeListener('request',handler);server.on('request',original);}};
}
export function installRuntimeBarrier(port,profile) {
  if(!Number.isSafeInteger(port)||port<1||port>65535)throw new Error('invalid_http_port');
  if(installed.has(port)) {if(installed.get(port).profile!==profile)throw new Error('existing_barrier_mismatch');return runtimeBarrierStatus(port);}
  const servers=process._getActiveHandles().filter(handle=>handle.constructor?.name==='Server'&&handle.address?.()?.port===port);
  if(servers.length!==1)throw new Error('expected_one_http_server');
  installed.set(port,attachBarrier(servers[0],profile));return runtimeBarrierStatus(port);
}
export function runtimeBarrierStatus(port) {
  const value=installed.get(port);if(!value)throw new Error('barrier_not_installed');
  const active=process._getActiveHandles().filter(handle=>handle.localPort===port&&handle._httpMessage&&!handle._httpMessage.writableEnded);
  const activeAdmissions=active.filter(handle=>isNewAdmission(handle._httpMessage.req.method,handle._httpMessage.req.url,value.profile)).length;
  return {profile:value.profile,port,refused:value.blocked(),activeHttp:active.length,activeAdmissions,installed:true};
}
export function restoreRuntimeBarrier(port){const value=installed.get(port);if(!value)throw new Error('barrier_not_installed');value.restore();installed.delete(port);return{restored:true,port};}
