import {test} from 'node:test';import assert from 'node:assert/strict';
test('live existing 0.3.50 release range acceptance from the GitHub runner',async()=>{
 const base='https://www.mycellios.com';
 const c=await(await fetch(base+'/public/v1/desktop-downloads?include=macos-all',{cache:'no-store'})).json();
 const a=await(await fetch(base+'/downloads/android/latest.json',{cache:'no-store'})).json();
 assert.equal(c.version,'0.3.50');assert.equal(a.revision,'2d852347329356138245007abcd65c45833c3efd');
 const results=[];
 for(const f of [...c.packages,c.fedora,a]){
  try{
   const r=await fetch(base+f.path,{headers:{Range:'bytes=0-1023'},signal:AbortSignal.timeout(30000)});
   let length=0;const reader=r.body.getReader();
   try{while(length<1025){const chunk=await reader.read();if(chunk.done)break;length+=chunk.value.length;if(length>1024)break;}}finally{await reader.cancel();}
   const result={id:f.id??'android',status:r.status,range:r.headers.get('content-range'),length,expected:f.bytes,type:r.headers.get('content-type'),encoding:r.headers.get('content-encoding'),cache:r.headers.get('cf-cache-status'),valid:r.status===206&&r.headers.get('content-range')===`bytes 0-1023/${f.bytes}`&&length===1024};
   results.push(result);console.log(JSON.stringify(result));
  }catch(error){const result={id:f.id??'android',error:String(error),valid:false};results.push(result);console.log(JSON.stringify(result));}
 }
 assert.equal(results.length,6);assert.ok(results.every(r=>r.valid),JSON.stringify(results));
});
