import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {compactServer,verifyCompactServer} from './compact-resources.mjs';
const require=createRequire(import.meta.url),asar=require('@electron/asar');

async function fixture() {
  const root=await mkdtemp(path.join(tmpdir(),'mycellios-compact-'));
  const source=path.join(root,'source'),target=path.join(root,'server');
  async function put(name,content){const file=path.join(source,name);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,content);}
  await put('package.json','{"name":"local-fixture","type":"module"}');
  await put('prisma/schema.prisma','// preserved migration schema');
  await put('prisma.config.mjs',`import value from 'plain-js';console.log(JSON.stringify({migrationCli:value===42}));`);
  await put('node_modules/plain-js/package.json','{"name":"plain-js","type":"module","exports":"./index.js"}');
  await put('node_modules/plain-js/index.js','export default 42;');
  await put('node_modules/plain-cjs/package.json','{"name":"plain-cjs","main":"index.cjs"}');
  await put('node_modules/plain-cjs/index.cjs','module.exports=42;');
  await put('node_modules/native-shim/package.json','{"name":"native-shim","main":"index.cjs","exports":"./index.cjs"}');
  await put('node_modules/native-shim/index.cjs',`module.exports=require('plain-cjs');`);
  await put('node_modules/native-shim/vendor/native.exe',Buffer.from([1,2,3]));
  await put('node_modules/plain-js/LICENSE','Fixture license preserved');
  await put('dist/desktop-local-entry.js',`import value from 'plain-js';import native from '../node_modules/native-shim/index.cjs';let denied=false;try{await import('native-shim/private.js')}catch(e){denied=e.code==='ERR_PACKAGE_PATH_NOT_EXPORTED'}process.parentPort.postMessage({esm:value===42,nativeDependency:native===42,exportsDenied:denied});`);
  const receipt=await compactServer(source,target);
  return {root,source,target,receipt};
}

test('keeps every JavaScript/license byte and external native package without a duplicate tree',async()=>{
  const f=await fixture();
  try {
    assert.equal(f.receipt.sourceFiles,12);
    assert.deepEqual(f.receipt.nativeRoots,['node_modules/native-shim']);
    assert.equal(asar.extractFile(path.join(f.target,'runtime.asar'),path.normalize('node_modules/plain-js/LICENSE')).toString(),'Fixture license preserved');
    assert.deepEqual(await readFile(path.join(f.target,'node_modules/native-shim/vendor/native.exe')),Buffer.from([1,2,3]));
    await assert.rejects(access(path.join(f.target,'node_modules/plain-js')));
    assert.equal(await readFile(path.join(f.target,'prisma/schema.prisma'),'utf8'),'// preserved migration schema');
    assert.deepEqual(await verifyCompactServer(f.target),f.receipt);
    await mkdir(path.join(f.target,'dist'));
    await writeFile(path.join(f.target,'dist/desktop-local-entry.js'),'Unexpected legacy duplicate');
    await assert.rejects(verifyCompactServer(f.target),/duplicate or unexpected/);
  }finally{await rm(f.root,{recursive:true,force:true});}
});

test('real Windows Electron resolves ESM/CJS across native packages and its migration child', {skip:process.platform!=='win32',timeout:40000},async()=>{
  const f=await fixture();
  try {
    const main=path.join(f.root,'main.cjs');
    const preload=path.join(f.target,'compact-resource-preload.cjs');
    await writeFile(main,`const {app,utilityProcess}=require('electron');const {execFile}=require('child_process');app.setPath('userData',${JSON.stringify(path.join(f.root,'profile'))});const timer=setTimeout(()=>app.exit(1),25000);app.whenReady().then(()=>{const child=utilityProcess.fork(${JSON.stringify(path.join(f.target,'compact-server-entry.cjs'))},[],{stdio:'pipe'});child.stderr?.pipe(process.stderr);child.on('message',msg=>{console.log(JSON.stringify(msg));child.kill();execFile(process.execPath,[${JSON.stringify(path.join(f.target,'prisma.config.mjs'))}],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1',NODE_OPTIONS:'--require='+JSON.stringify(${JSON.stringify(preload)})},windowsHide:true},(err,out,stderr)=>{console.log(out);if(stderr)console.error(stderr);clearTimeout(timer);app.exit(err?1:0);});});});`);
    const child=spawn(require('electron'),[main],{windowsHide:true,env:{...process.env,ELECTRON_RUN_AS_NODE:undefined},stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);
    const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve)});
    assert.equal(code,0,stderr+'\n'+stdout);
    assert.match(stdout,/"esm":true/);assert.match(stdout,/"nativeDependency":true/);assert.match(stdout,/"exportsDenied":true/);assert.match(stdout,/"migrationCli":true/);
  }finally{await rm(f.root,{recursive:true,force:true});}
});

test('extensionless Mach-O and ELF engines stay executable outside ASAR with their package metadata',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'mycellios-unix-compact-'));
 try{
  const source=path.join(root,'source'),target=path.join(root,'target');
  const files={
   'package.json':'{"name":"fixture"}',
   'node_modules/@prisma/engines/package.json':'{"name":"@prisma/engines"}',
   'node_modules/@prisma/engines/schema-engine-darwin-arm64':Buffer.from('cffaedfe01020304','hex'),
   'node_modules/@prisma/engines/LICENSE':'Engine license',
   'node_modules/unix-tool/bin/tool':Buffer.from('7f454c4601020304','hex'),
   'node_modules/plain/LICENSE':'Plain license',
   'node_modules/plain/bin/cli':'#!/usr/bin/env node\nconsole.log("plain JavaScript");',
  };
  for(const [name,bytes] of Object.entries(files)){await mkdir(path.dirname(path.join(source,name)),{recursive:true});await writeFile(path.join(source,name),bytes);}
  const receipt=await compactServer(source,target);
  assert.deepEqual(receipt.nativeRoots,['node_modules/unix-tool','node_modules/@prisma/engines']);
  for(const name of ['node_modules/@prisma/engines/schema-engine-darwin-arm64','node_modules/@prisma/engines/LICENSE','node_modules/@prisma/engines/package.json','node_modules/unix-tool/bin/tool'])
   assert.deepEqual(await readFile(path.join(target,name)),Buffer.from(files[name]));
  assert.equal(asar.extractFile(path.join(target,'runtime.asar'),path.normalize('node_modules/plain/bin/cli')).toString(),files['node_modules/plain/bin/cli']);
  await assert.rejects(access(path.join(target,'node_modules/plain')));
  assert.deepEqual(await verifyCompactServer(target),receipt);
 }finally{await rm(root,{recursive:true,force:true});}
});
