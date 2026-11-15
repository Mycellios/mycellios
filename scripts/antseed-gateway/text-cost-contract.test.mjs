import assert from 'node:assert/strict';
import {test} from 'node:test';
import {boundedTextRequest,boundedHoldUsdc,tokenPolicyCaps,priceMicros} from './text-cost-contract.mjs';
import {patchGatewayServer} from './patch-gateway.mjs';
const model='a'.repeat(40)+'@gpt-example';
const input=()=>({model,messages:[{role:'user',content:'Hola'}],max_tokens:128,store:false,mycellios_cost_bounds:{version:2,input:'2.000001',output:'8'}});
test('strips private bounds and reserves exact rounded maximum before delivery',()=>{
 const request=boundedTextRequest('/v1/chat/completions',model,input());
 assert(!('mycellios_cost_bounds' in request));
 const bytes=Buffer.from(JSON.stringify(request));
 const exact=(BigInt(bytes.length+8192+64)*2_000_001n+128n*8_000_000n+999_999n)/1_000_000n;
 assert.equal(boundedHoldUsdc(bytes,request),Number(exact));
 assert.deepEqual(tokenPolicyCaps(request),{maxInputUsdPerMillion:2.000001,maxCachedInputUsdPerMillion:2.000001,maxOutputUsdPerMillion:8});
});
test('accepts truly free prices without dropping the pre-execution admission',()=>{
 const body=input();body.mycellios_cost_bounds.input='0';body.mycellios_cost_bounds.output='0';
 const request=boundedTextRequest('/v1/chat/completions',model,body);assert.equal(boundedHoldUsdc(Buffer.from(JSON.stringify(request)),request),0);
});
for(const value of ['-1','NaN','Infinity','1e9','1000001','0.0000001','1.2.3',1,null])test('rejects an ambiguous or unbounded price '+String(value),()=>assert.throws(()=>priceMicros(value)));
test('does not trust a cloned or forged request object as a cost contract',()=>assert.throws(()=>boundedHoldUsdc(Buffer.from('{}'),input())));
for(const extra of [{modalities:['audio']},{audio:{voice:'x'}},{store:true},{tools:[{type:'web_search'}]},{messages:[{role:'user',content:[{type:'image_url',image_url:{url:'secret'}}]}]},{max_tokens:8193}])test('rejects an extra charging path '+JSON.stringify(extra),()=>assert.throws(()=>boundedTextRequest('/v1/chat/completions',model,{...input(),...extra})));
test('requires a pinned service for a generic quote',()=>assert.throws(()=>boundedTextRequest('/v1/chat/completions','gpt-example',input())));
test('does not activate paid routes besides text completions',()=>assert.equal(boundedTextRequest('/v1/images/generations',model,input()),null));
test('patching fails closed on upstream drift',()=>assert.throws(()=>patchGatewayServer('changed upstream',['key-owned'])));
