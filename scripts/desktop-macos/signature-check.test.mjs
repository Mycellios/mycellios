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
