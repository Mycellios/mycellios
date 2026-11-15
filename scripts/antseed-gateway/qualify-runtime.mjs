/** Run against an isolated installed AntSeed tree, never a live data directory.
 * The fake buyer and gateway bind loopback inside a network-none container.
 * This qualifies admission/accounting plumbing, not real seller inference. */
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {patchGatewayServer,reservationModule} from './patch-gateway.mjs';
const base=process.argv[2]??'/opt/antseed/node_modules/@antseed/cli/dist';
const load=file=>import(pathToFileURL(path.join(base,file)));
const {GatewayStore}=await load('gateway/store.js');
const {GatewayAccounting}=await load('gateway/accounting.js');
const {SpendAttributionFeed,SPEND_ATTRIBUTION_HEADER}=await load('proxy/spend-attribution.js');
const {BUYER_IDENTITY_HEADER}=await load('proxy/request-utils.js');
const {ROUTING_POLICY_HEADER}=await load('routing-policy/policy.js');
const {SpendFeedPoller}=await load('gateway/spend-feed.js');
const data=await mkdtemp(path.join(tmpdir(),'bounded-gateway-'));
const store=new GatewayStore(data),feed=new SpendAttributionFeed();
const {key,secret}=store.createKey({label:'isolated contract qualification',limits:{daily:30000,total:30000},expiresAt:null});
const legacy=await readFile(path.join(base,'gateway/request-reservation.js'),'utf8');
await writeFile(path.join(base,'gateway/request-reservation.legacy.js'),legacy);
await writeFile(path.join(base,'gateway/request-reservation.js'),reservationModule);
await writeFile(path.join(base,'gateway/mycellios-text-cost-contract.mjs'),await readFile(new URL('./text-cost-contract.mjs',import.meta.url)));
await writeFile(path.join(base,'gateway/server.qualification.js'),patchGatewayServer(await readFile(path.join(base,'gateway/server.js'),'utf8'),[key.id]));
const {GatewayServer}=await load('gateway/server.qualification.js');
const seen=[];let complete,arrived;const firstArrival=new Promise(resolve=>arrived=resolve);
const buyer=http.createServer((req,res)=>{
 if(req.url.startsWith('/_antseed/attributed-spend')){res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:true,...feed.page(Number(new URL(req.url,'http://localhost').searchParams.get('after')??0))}));return;}
 const chunks=[];req.on('data',b=>chunks.push(b));req.on('end',()=>{
  const body=JSON.parse(Buffer.concat(chunks).toString());seen.push({body,headers:req.headers});
  const id='isolated-receipt-'+seen.length,tag=req.headers[SPEND_ATTRIBUTION_HEADER];
  complete=()=>{
   feed.track(id,tag);feed.record({requestId:id,buyerIdentity:req.headers[BUYER_IDENTITY_HEADER],sellerPeerId:'a'.repeat(40),amountUsdc:'1000',inputTokens:'100',cachedInputTokens:'0',outputTokens:'20',outputImages:'0'});
   res.writeHead(200,{'content-type':'application/json','x-antseed-request-id':id});res.end(JSON.stringify({id,choices:[{message:{role:'assistant',content:'qualified'}}],usage:{prompt_tokens:100,completion_tokens:20}}));
  };arrived();
 });
});
await new Promise(resolve=>buyer.listen(0,'127.0.0.1',resolve));const buyerPort=buyer.address().port;
const accounting=new GatewayAccounting(store,{holdUsdc:300000,settleGraceMs:50});
const poller=new SpendFeedPoller({buyerPort,onPage:page=>accounting.ingest(page.bootId,page.events),intervalMs:60000});
const gateway=new GatewayServer({store,accounting,buyerPort,controlSecret:'isolated-control-not-a-production-key',spendFeedState:()=>poller.state,refreshSpendFeed:()=>poller.pollOnce()});
const port=await gateway.start();
const post=(body,route='/v1/chat/completions')=>fetch('http://127.0.0.1:'+port+route,{method:'POST',headers:{authorization:'Bearer '+secret,'content-type':'application/json'},body:JSON.stringify(body)});
const request={model:'a'.repeat(40)+'@qualified-tool-model',messages:[{role:'user',content:'test'}],max_tokens:512,mycellios_cost_bounds:{version:2,input:'2',output:'4'}};
try{
 const unbounded=await post({...request,mycellios_cost_bounds:undefined});assert.equal(unbounded.status,400);assert.equal(seen.length,0);
 const image=await post({model:request.model,prompt:'test'},'/v1/images/generations');assert.equal(image.status,400);assert.equal(seen.length,0);
 const expensive=await post({...request,mycellios_cost_bounds:{version:2,input:'200',output:'400'}});assert.equal(expensive.status,429);assert.equal(seen.length,0);
 const first=post(request);await firstArrival;
 assert.equal(seen.length,1);assert.equal(seen[0].body.mycellios_cost_bounds,undefined);
 const policy=JSON.parse(Buffer.from(seen[0].headers[ROUTING_POLICY_HEADER],'base64url').toString());
 assert.equal(policy.maxInputUsdPerMillion,2);assert.equal(policy.maxOutputUsdPerMillion,4);assert.equal(policy.maxCachedInputUsdPerMillion,2);
 const concurrent=await post(request);assert.equal(concurrent.status,429);assert.equal(seen.length,1,'concurrent hold must stop a second paid delivery');
 complete();const result=await first;assert.equal(result.status,200);assert.equal(result.headers.get('x-mycellios-cost-contract'),'token-bounded-v2');await result.text();
 await poller.pollOnce();assert.equal(store.usageStats(key.id).spentUsdc,1000);
 assert.equal(store.getKey(key.id).limits.daily,30000);assert.equal(store.getKey(key.id).limits.total,30000);
 console.log(JSON.stringify({qualified:true,realGateway:true,realAccounting:true,syntheticBuyer:true,paidSellerInference:false,delivered:seen.length,settledUsdc:1000,concurrentBudgetBlocked:true,unboundedBlocked:true,imageBlocked:true,budgetsPreserved:true}));
}finally{await gateway.stop();accounting.dispose();await new Promise(resolve=>buyer.close(resolve));feed.close();store.close();await rm(data,{recursive:true,force:true});}
