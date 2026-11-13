import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import path from 'node:path';
import {verifyMacPackagedResources} from './macos-packaged-resources.mjs';
test('compact Mac resources qualify archive contents and reject missing or stale source',async()=>{
 const app=await mkdtemp(path.join(tmpdir(),'mycellios-mac-layout-'));
 try{
  const resources=path.join(app,'Contents/Resources');
  for(const file of ['local-server/compact-server-entry.cjs','local-server/compact-resources.json','web/first-party/index.html']){
   await mkdir(path.dirname(path.join(resources,file)),{recursive:true});await writeFile(path.join(resources,file),'fixture');
  }
  const entries=new Map([
   ['app.asar:package.json','{"version":"0.3.49"}'],
   ['development-source.asar:source/src/agent/apps/desktop/package.json','{"version":"0.3.49"}'],
   ['npm.asar:package.json','{"name":"npm"}'],['npm.asar:bin/npm-cli.js','fixture cli'],
   ['runtime.asar:dist/desktop-local-entry.js','fixture runtime'],
  ]);
  const extract=(archive,file)=>{const value=entries.get(path.basename(archive)+':'+file.split(path.sep).join('/'));if(value===undefined)throw Error('Missing archive member');return Buffer.from(value);};
  await verifyMacPackagedResources(app,extract);
  entries.set('development-source.asar:source/src/agent/apps/desktop/package.json','{"version":"0.3.9"}');
  await assert.rejects(verifyMacPackagedResources(app,extract),/match the installed app/);
  entries.set('development-source.asar:source/src/agent/apps/desktop/package.json','{"version":"0.3.49"}');
  entries.delete('runtime.asar:dist/desktop-local-entry.js');
  await assert.rejects(verifyMacPackagedResources(app,extract),/Missing archive member/);
 }finally{await rm(app,{recursive:true,force:true});}
});
