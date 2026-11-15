import {describe,expect,it} from 'vitest';
import {ManagedAntseedGateway} from '../src/coordinator/managed-antseed-gateway.js';
import {antseedGatewayFixture,gatewayKey,gatewaySeller} from './fixtures/managed-antseed-gateway.js';
function fixture(){
 const f=antseedGatewayFixture();f.contract('token-bounded-v2');
 f.model.id='generic-agent';f.model.name='Generic Agent';f.model.peers[0]!.serviceId='vendor/generic-agent';
 Object.assign(f.model.peers[0]!.capabilities,{toolUse:true});f.row.model='vendor/generic-agent';
 const adapter=new ManagedAntseedGateway(gatewayKey,'http://127.0.0.1:8379',['*'],2,f.transport,'token-bounded-v2');
 return {f,adapter,input:{model:'mycellios/managed/antseed/generic-agent',messages:[{role:'user',content:'Hello'}],max_tokens:10}};
}
describe('generic bounded gateway text',()=>{
 it('requires an upstream cost contract before advertising any new model',async()=>{const {f,adapter}=fixture();f.contract('old');await expect(adapter.refresh()).rejects.toThrow('cost_contract_unavailable');expect(adapter.catalog()).toEqual([]);expect(f.inference()).toHaveLength(0);});
 it('lists all compatible offers, pins the actual service and keeps account bounds private',async()=>{
  const {f,adapter,input}=fixture();await adapter.refresh();expect(adapter.catalog().map(m=>m.id)).toEqual([input.model]);
  const q=adapter.quote(input);expect(q.body.model).toBe(gatewaySeller+'@vendor/generic-agent');
  expect(q.body.mycellios_cost_bounds).toEqual({version:2,input:'0.1',output:'0.2'});
  expect(q.billingContext).toMatchObject({contract:'token-bounded-v2',input:'0.0000001',output:'0.0000002'});
  const result=await adapter.execute(q,undefined,async()=>{});expect(result.usd).toBe('0.000005');expect(f.inference()).toHaveLength(1);
 });
 it('rounds the upper token rate up instead of promising an unreserved fractional cost',async()=>{
  const {f,adapter,input}=fixture();Object.assign(f.model.peers[0]!,{inputUsdPerMillion:0.1000000001,cachedInputUsdPerMillion:0.3000000001});await adapter.refresh();
  expect(adapter.quote(input).body.mycellios_cost_bounds).toEqual({version:2,input:'0.300001',output:'0.2'});
 });
 it('accepts models above the old DeepSeek price while preserving their own higher reserve',async()=>{
  const {f,adapter,input}=fixture();Object.assign(f.model.peers[0]!,{inputUsdPerMillion:4,outputUsdPerMillion:20});await adapter.refresh();
  expect(adapter.catalog()).toHaveLength(1);expect(adapter.quote(input).body.mycellios_cost_bounds).toEqual({version:2,input:'4',output:'20'});
 });
 it('retains the selected offer and its price after subsequent discovery changes',async()=>{
  const {f,adapter,input}=fixture();await adapter.refresh();const q=adapter.quote(input);
  Object.assign(f.model.peers[0]!,{peerId:'b'.repeat(40),outputUsdPerMillion:4});await adapter.refresh();
  expect(q.body.model).toBe(gatewaySeller+'@vendor/generic-agent');expect(q.body.mycellios_cost_bounds).toEqual({version:2,input:'0.1',output:'0.2'});
 });
 it('discovers more than a manual shortlist without enabling image or tool-less services',async()=>{
  const {f,adapter}=fixture();for(let i=0;i<160;i++)f.models.push({...f.model,id:'agent-'+i,peers:f.model.peers.map(p=>({...p,serviceId:'agent-'+i}))});
  f.models.push({...f.model,id:'no-tools',peers:f.model.peers.map(p=>({...p,capabilities:{...p.capabilities,toolUse:false}}))});
  f.models.push({...f.model,id:'picture',type:'image'});await adapter.refresh();expect(adapter.catalog()).toHaveLength(161);
 });
 it('refuses an ambiguous extra billable unit instead of treating its token price as the complete invoice',async()=>{
  const {f,adapter}=fixture();Object.assign(f.model.peers[0]!,{unitBillingModels:{fee:1}});await adapter.refresh();expect(adapter.catalog()).toEqual([]);expect(f.inference()).toHaveLength(0);
 });
 it('retains uncertain receipt holds and recovers by GET without a second paid POST',async()=>{
  const {f,adapter,input}=fixture();await adapter.refresh();let job:unknown;f.pending(true);
  await expect(adapter.execute(adapter.quote(input),undefined,async value=>{job=value})).rejects.toThrow('receipt_pending');
  f.pending(false);expect((await adapter.recover(job))?.usd).toBe('0.000005');expect(f.inference()).toHaveLength(1);
 });
 it('does not settle a bill above the accepted maximum',async()=>{
  const {f,adapter,input}=fixture();await adapter.refresh();f.row.spent='1';
  await expect(adapter.execute(adapter.quote(input),undefined,async()=>{})).rejects.toThrow('cost_bound_exceeded');expect(f.inference()).toHaveLength(1);
 });
 it('never accepts a receipt for another model under the same nonce',async()=>{
  const {f,adapter,input}=fixture();await adapter.refresh();f.row.model='other';
  await expect(adapter.execute(adapter.quote(input),undefined,async()=>{})).rejects.toThrow('receipt_mismatch');expect(f.inference()).toHaveLength(1);
 });
});
