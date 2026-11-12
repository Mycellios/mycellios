import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { windowsSigningConfiguration, assertWindowsSignatureReceipt } from './windows-signing.mjs';

const azure={MYCELLIOS_WINDOWS_SIGNING:'azure',MYCELLIOS_WINDOWS_PUBLISHER:'Verified publisher fixture',
  MYCELLIOS_WINDOWS_AZURE_ENDPOINT:'https://weu.codesigning.azure.net/',MYCELLIOS_WINDOWS_AZURE_ACCOUNT:'fixture-signing',MYCELLIOS_WINDOWS_AZURE_PROFILE:'public-trust'};
test('publisher signing is forced with explicit identity and SHA256 timestamping',()=>{
 const c=windowsSigningConfiguration(azure);assert.equal(c.build.forceCodeSigning,true);
 assert.equal(c.build.win.azureSignOptions.publisherName,azure.MYCELLIOS_WINDOWS_PUBLISHER);
 assert.equal(c.build.win.azureSignOptions.fileDigest,'SHA256');assert.equal(c.build.win.azureSignOptions.timestampDigest,'SHA256');
 assert.equal(c.build.win.signtoolOptions,undefined);
 for(const key of Object.keys(azure).filter(k=>k!=='MYCELLIOS_WINDOWS_SIGNING'))assert.throws(()=>windowsSigningConfiguration({...azure,[key]:''}));
 for(const endpoint of ['http://weu.codesigning.azure.net','https://attacker.test','https://weu.codesigning.azure.net@attacker.test/','https://weu.codesigning.azure.net/path'])
  assert.throws(()=>windowsSigningConfiguration({...azure,MYCELLIOS_WINDOWS_AZURE_ENDPOINT:endpoint}));
});
test('store signing selects only the configured certificate; preview cannot discover keys',()=>{
 const store=windowsSigningConfiguration({MYCELLIOS_WINDOWS_SIGNING:'certificate-store',MYCELLIOS_WINDOWS_PUBLISHER:'Fixture',MYCELLIOS_WINDOWS_CERTIFICATE_SHA1:'a'.repeat(40)});
 assert.equal(store.build.win.signtoolOptions.certificateSha1,'a'.repeat(40));assert.equal(store.build.forceCodeSigning,true);
 assert.deepEqual(windowsSigningConfiguration({MYCELLIOS_WINDOWS_SIGNING:'unsigned-preview',CSC_LINK:'ignored'}).build,
  {forceCodeSigning:false,win:{signExecutable:false}});
 assert.throws(()=>windowsSigningConfiguration({MYCELLIOS_WINDOWS_SIGNING:'automatic'}));
});
test('receipts reject substituted, wrong-publisher, unsigned and untimestamped releases',()=>{
 const sha='b'.repeat(64),publisher=azure.MYCELLIOS_WINDOWS_PUBLISHER;
 const receipt={schema:'mycellios-windows-signature/1',mode:'authenticode',publisher,
  files:['installer','application'].map(role=>({role,sha256:sha,status:'Valid',publisher,thumbprint:'c'.repeat(40),timestampSubject:'Trusted TSA fixture'}))};
 assert.doesNotThrow(()=>assertWindowsSignatureReceipt(receipt,sha,publisher));
 assert.throws(()=>assertWindowsSignatureReceipt(receipt,'d'.repeat(64),publisher));
 assert.throws(()=>assertWindowsSignatureReceipt(receipt,sha,'Another publisher'));
 for(const patch of [{status:'NotSigned'},{publisher:'Another publisher'},{timestampSubject:null},{thumbprint:''}]){
  const bad=structuredClone(receipt);Object.assign(bad.files[0],patch);assert.throws(()=>assertWindowsSignatureReceipt(bad,sha,publisher));
 }
 assert.throws(()=>assertWindowsSignatureReceipt({...receipt,files:receipt.files.slice(0,1)},sha,publisher));
 const preview={schema:receipt.schema,mode:'unsigned-preview',publisher:null,files:[{role:'installer',sha256:sha,status:'NotSigned'}]};
 assert.doesNotThrow(()=>assertWindowsSignatureReceipt(preview,sha));
 assert.throws(()=>assertWindowsSignatureReceipt(preview,sha,publisher));
});
test('release and promotion retain source gates and make unsigned publication an explicit exception',()=>{
 const workflow=readFileSync(new URL('../../../../../.github/workflows/desktop-windows-release.yml',import.meta.url),'utf8');
 const promotion=readFileSync(new URL('../../../../../.github/workflows/desktop-windows-promote.yml',import.meta.url),'utf8');
 assert.match(workflow,/default: publisher/);assert.match(workflow,/force|MYCELLIOS_WINDOWS_SIGNING/);
 assert.match(workflow,/codesigning\.azure\.net --output none/);assert.match(workflow,/az account clear/);
 assert.match(promotion,/allow_unsigned_preview/);assert.match(promotion,/verify-windows-signature.ps1/);
 assert.match(promotion,/merge-base --is-ancestor/);assert.match(promotion,/sha256sum --check --strict/);
});
