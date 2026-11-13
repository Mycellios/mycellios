import {test} from 'node:test';import assert from 'node:assert/strict';import {platformVersions} from './installer-version.mjs';
test('one Desktop version automatically defines an upgradeable Android release',()=>{
 assert.deepEqual(platformVersions('0.3.48'),{desktop:'0.3.48',android:'1.3.48',androidVersionCode:103048});
 const releases=['0.3.48','0.3.49','0.4.0','0.999.999','1.0.0','1999.999.999'].map(platformVersions);
 for(let i=1;i<releases.length;i++)assert.ok(releases[i].androidVersionCode>releases[i-1].androidVersionCode);
 assert.ok(releases.every(r=>r.androidVersionCode<2_100_000_000));
});
test('never maps overflow or ambiguous version strings to an Android downgrade',()=>{
 for(const version of ['0.03.48','v0.3.48','0.3.1000','2000.0.0','../1.0.0'])assert.throws(()=>platformVersions(version));
});
