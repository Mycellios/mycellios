import readline from 'node:readline';
const engine=process.argv[2],stuck=process.argv.includes('--no-progress');
const send=x=>process.stdout.write(JSON.stringify(x)+'\n');
const reply=(m,result)=>send({jsonrpc:'2.0',id:m.id,result});
const pending=new Map();let seq=1000,phase=0,bridge;
setInterval(()=>{},1000);
if(engine==='claude')bridge=JSON.parse(process.argv[process.argv.indexOf('--mcp-config')+1]).mcpServers.rakazo;
function callCodex(index,args,turn){const id=seq++;return new Promise(resolve=>{pending.set(id,resolve);send({id,method:'item/tool/call',params:{threadId:'work-session',turnId:turn,callId:'call-'+id,tool:'rakazo_'+index,arguments:args}});});}
async function callHttp(index,args){
 const authorization=Array.isArray(bridge.headers)?bridge.headers.find(h=>h.name==='Authorization').value:bridge.headers.Authorization;
 const r=await fetch(bridge.url,{method:'POST',headers:{Authorization:authorization,'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:seq++,method:'tools/call',params:{name:'tool_'+index,arguments:args}})});
 if(!r.ok)throw Error('bridge failed');
 await r.text();
}
async function perform(call){
 phase++;
 await call(1,{steps:[{id:'verify',title:'Verify notes',status:phase>1&&!stuck?'done':'running'}]});
 if(phase===1)await call(0,{path:'notes.txt'});
 return phase===1?'Voy a comprobar el resultado.':stuck?'Partial work remains.':'Hecho y verificado.';
}
readline.createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(pending.has(m.id)){pending.get(m.id)(m.result);pending.delete(m.id);return;}
 void(async()=>{
 if(engine==='codex'){
  if(m.method==='initialize')reply(m,{});
  else if(m.method==='thread/start'||m.method==='thread/resume')reply(m,{thread:{id:'work-session'}});
  else if(m.method==='turn/start'){
   if(m.params.approvalPolicy!=='untrusted'||m.params.permissions!=='rakazo-runtime')throw Error('permissions changed');
   const turn='turn-'+(phase+1);reply(m,{turn:{id:turn}});send({method:'turn/started',params:{threadId:'work-session',turn:{id:turn}}});
   const answer=await perform((i,a)=>callCodex(i,a,turn));
   send({method:'item/agentMessage/delta',params:{threadId:'work-session',turnId:turn,delta:answer}});
   send({method:'turn/completed',params:{threadId:'work-session',turn:{id:turn,status:'completed'}}});
  }
 }else if(engine==='claude'&&m.type==='user'){
  send({type:'system',subtype:'init',session_id:'work-session'});
  const answer=await perform(callHttp);send({type:'stream_event',event:{type:'content_block_delta',delta:{type:'text_delta',text:answer}}});send({type:'result',subtype:'success',is_error:false});
 }else if(engine==='acp'){
  if(m.method==='initialize')reply(m,{protocolVersion:1,agentCapabilities:{mcpCapabilities:{http:true}}});
  else if(m.method==='session/new'){bridge=m.params.mcpServers[0];reply(m,{sessionId:'work-session'});}
  else if(m.method==='session/prompt'){const answer=await perform(callHttp);send({method:'session/update',params:{update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:answer}}}});reply(m,{stopReason:'end_turn'});}
 }
 })().catch(()=>process.exit(1));
});
