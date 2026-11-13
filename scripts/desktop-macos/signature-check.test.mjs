import test from'node:test';import assert from'node:assert/strict';import{checkPreviewSignature}from'./signature-check.mjs';
const result=(status,stderr='')=>({status,stderr,stdout:''});
test('an intact preview records rejected Gatekeeper trust separately from signature integrity',()=>{
 const calls=[];const responses=[result(0),result(0,'Signature=adhoc\nTeamIdentifier=not set\n'),result(3,'rejected\n')];
 const receipt=checkPreviewSignature('/fixture/Mycellios Desktop.app',(file,args)=>{calls.push({file,args});return responses.shift();});
 assert.deepEqual(receipt,{integrityVerified:true,signature:'ad-hoc',notarized:false,gatekeeperAccepted:false,gatekeeperStatus:3,requiresManualApproval:true});
 assert.deepEqual(calls[0].args,['--verify','--deep','--strict','--verbose=2','/fixture/Mycellios Desktop.app']);
 assert.equal(calls[2].file,'/usr/sbin/spctl');
});
test('missing or altered signatures cannot pass merely because direct launch works',()=>{
 for(const first of[result(1),{status:null,error:Error('tool unavailable')}])assert.throws(()=>checkPreviewSignature('/fixture',()=>first),/missing or invalid/);
 const responses=[result(0),result(0,'Authority=Developer ID Application: fixture')];assert.throws(()=>checkPreviewSignature('/fixture',()=>responses.shift()),/expected ad-hoc/);
});
test('an assessment execution failure is not recorded as an expected preview rejection',()=>{
 const responses=[result(0),result(0,'Signature=adhoc'),{status:null,error:Error('timeout')}];assert.throws(()=>checkPreviewSignature('/fixture',()=>responses.shift()),/could not run/);
});
test('a local approval does not remove the preview manual-approval requirement',()=>{
 const responses=[result(0),result(0,'Signature=adhoc'),result(0,'accepted')];const receipt=checkPreviewSignature('/fixture',()=>responses.shift());assert.equal(receipt.gatekeeperAccepted,true);assert.equal(receipt.requiresManualApproval,true);assert.equal(receipt.notarized,false);
});
test('invalid tool arguments are not confused with a policy rejection',()=>{
 const responses=[result(0),result(0,'Signature=adhoc'),result(2,'invalid argument')];assert.throws(()=>checkPreviewSignature('/fixture',()=>responses.shift()),/trust decision/);
});
test('a timed out strict read retries the identical verification once and still needs a valid signature',()=>{
 const calls=[];const responses=[{status:null,error:{code:'ETIMEDOUT'},signal:'SIGTERM'},result(0),result(0,'Signature=adhoc'),result(3,'rejected')];
 const receipt=checkPreviewSignature('/readonly/fixture',(file,args,options)=>{calls.push({file,args,options});return responses.shift();});
 assert.equal(receipt.integrityVerified,true);assert.deepEqual(calls[0],calls[1]);assert.equal(calls.length,4);
});
test('a signature rejection fails immediately with the actual codesign diagnostic',()=>{
 let calls=0;
 assert.throws(()=>checkPreviewSignature('/fixture',()=>{calls++;return result(1,'sealed resource is missing or invalid');}),/status=1.*sealed resource is missing or invalid/);
 assert.equal(calls,1);
});
test('repeated timeouts remain a failure with a bounded attempt count and explicit cause',()=>{
 let calls=0;
 assert.throws(()=>checkPreviewSignature('/fixture',()=>{calls++;return{status:null,error:{code:'ETIMEDOUT'},signal:'SIGTERM'};}),/code=ETIMEDOUT.*signal=SIGTERM/);
 assert.equal(calls,2);
});
