import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

// The Windows helper's native I/O is exercised against a child-only fixture
// environment. No installed service, account, elevation or model is used.
const helper=fileURLToPath(new URL('./runtime-public-status.cjs',import.meta.url));
async function fixture(run){
 const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'mycellios-public-status-'));
 const programFiles=path.join(temporary,'programs'),programData=path.join(temporary,'data');
 const root=path.join(programFiles,'Mycellios'),config=path.join(programData,'Mycellios/Configuration/node.json');
 await fs.mkdir(root,{recursive:true});await fs.mkdir(path.dirname(config),{recursive:true});
 const inherited=Object.fromEntries(Object.entries(process.env).filter(([key])=>!['programfiles','programdata'].includes(key.toLowerCase())));
 const bootstrap="process.env.ProgramFiles=process.argv[1]; process.env.ProgramData=process.argv[2]; require(process.argv[3]);";
 const invoke=(args=[])=>spawnSync(process.execPath,['-e',bootstrap,programFiles,programData,helper,...args],{encoding:'utf8',env:inherited,windowsHide:true});
 try{await run({temporary,root,config,invoke});}finally{
  const target=path.resolve(temporary);
  assert.equal(path.dirname(target),path.resolve(os.tmpdir()));
  assert.match(path.basename(target),/^mycellios-public-status-/);
  await fs.rm(target,{recursive:true,force:true});
 }
}
const windows={skip:process.platform!=='win32'};
test('publishes only the public ID and preserves the private file',windows,()=>fixture(async({root,config,invoke})=>{
 const original=JSON.stringify({nodeId:'existing-node',workerToken:'fixture-private-token',accountId:'private-owner'});
 await fs.writeFile(config,original);const result=invoke();assert.equal(result.status,0,result.stderr);
 assert.deepEqual(JSON.parse(await fs.readFile(path.join(root,'desktop-node.json'),'utf8')),{schema:'mycellios-desktop-runtime-status/1',nodeId:'existing-node'});
 assert.equal(await fs.readFile(config,'utf8'),original);assert.equal(result.stdout,'');
}));
test('rejects corrupt, oversized and invalid configuration without publishing',windows,()=>fixture(async({root,config,invoke})=>{
 for(const value of ['not json',JSON.stringify({nodeId:'../../different-node'}),' '.repeat(65537)]){
  await fs.writeFile(config,value);assert.notEqual(invoke().status,0);
  await assert.rejects(fs.access(path.join(root,'desktop-node.json')));
 }
}));
test('creates a bounded receipt only inside the protected installation root',windows,()=>fixture(async({temporary,root,config,invoke})=>{
 await fs.writeFile(config,JSON.stringify({nodeId:'existing-node',workerToken:'fixture-secret'}));
 const name='.desktop-status-receipt-12345678-1234-1234-1234-123456789abc.json';
 const receipt=path.join(root,name);assert.equal(invoke(['--receipt',receipt]).status,0);
 assert.equal(JSON.parse(await fs.readFile(receipt,'utf8')).nodeId,'existing-node');
 const outside=path.join(temporary,name);assert.notEqual(invoke(['--receipt',outside]).status,0);await assert.rejects(fs.access(outside));
}));
