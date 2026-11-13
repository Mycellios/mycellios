import {test} from 'node:test';import assert from 'node:assert/strict';
import {validatePlatformReceipt} from './installer-release-contract.mjs';
const identity={revision:'a'.repeat(40),tree:'b'.repeat(40),version:'0.3.48',platform:'macos-x64'};
const fixture=()=>({schema:'mycellios-platform-release/1',...identity,qualifiedStartup:true,automaticUpdates:false,files:[{id:'macos-x64',format:'DMG',version:identity.version,fileName:'Mycellios-Desktop-0.3.48-macos-x64-preview.dmg',bytes:100,sha256:'c'.repeat(64)}]});
test('requires the actual native package from the same qualified source',()=>{
 assert.equal(validatePlatformReceipt(fixture(),identity).length,1);
 for(const patch of [{revision:'d'.repeat(40)},{tree:'d'.repeat(40)},{qualifiedStartup:false},{automaticUpdates:true},{version:'0.3.47'},{platform:'macos-arm64'},{files:[]}])assert.throws(()=>validatePlatformReceipt({...fixture(),...patch},identity));
});
test('rejects substitution, traversal, incomplete digests and unbounded files',()=>{
 for(const patch of [{fileName:'../../secret.dmg'},{fileName:'Mycellios-Desktop-0.3.48-macos-x64-preview.exe'},{format:'EXE'},{id:'macos-arm64'},{sha256:'unknown'},{bytes:0},{bytes:2_000_000_001},{bytes:1.5}]){
  const receipt=fixture();Object.assign(receipt.files[0],patch);assert.throws(()=>validatePlatformReceipt(receipt,identity));
 }
 const duplicate=fixture();duplicate.files.push({...duplicate.files[0]});assert.throws(()=>validatePlatformReceipt(duplicate,identity));
});
