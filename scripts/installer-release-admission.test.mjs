import {test} from 'node:test';import assert from 'node:assert/strict';
import {admittedRevision} from './installer-release-admission.mjs';
const main='a'.repeat(40),repository='Mycellios/mycellios';
const input=()=>({eventName:'workflow_run',event:{workflow_run:{conclusion:'success',head_branch:'main',head_repository:{full_name:repository},head_sha:main}},repository,main,ref:'refs/heads/main'});
test('only successful current first-party main builds can spend release capacity',()=>{
 assert.equal(admittedRevision(input()),main);
 for(const field of [{conclusion:'failure'},{head_sha:'b'.repeat(40)},{head_branch:'fork'},{head_repository:{full_name:'other/repo'}}]){
  const value=input();Object.assign(value.event.workflow_run,field);assert.equal(admittedRevision(value),null);
 }
 assert.equal(admittedRevision({...input(),repository:'other/repo'}),null);
});
test('manual recovery cannot promote a branch, PR or untrusted event',()=>{
 assert.equal(admittedRevision({...input(),eventName:'workflow_dispatch'}),main);
 assert.equal(admittedRevision({...input(),eventName:'workflow_dispatch',ref:'refs/heads/work'}),null);
 assert.equal(admittedRevision({...input(),eventName:'pull_request'}),null);
});
