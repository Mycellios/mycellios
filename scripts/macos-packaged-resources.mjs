import {access} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

export async function verifyMacPackagedResources(appRoot,extractFile) {
  const resources=path.join(appRoot,'Contents/Resources');
  for(const file of ['local-server/compact-server-entry.cjs','local-server/compact-resources.json','web/first-party/index.html'])
    await access(path.join(resources,file));
  const archived=(archive,file)=>extractFile(path.join(resources,archive),path.normalize(file));
  const desktop=JSON.parse(archived('app.asar','package.json'));
  const source=JSON.parse(archived('development-source.asar','source/src/agent/apps/desktop/package.json'));
  assert.equal(source.version,desktop.version,'Bundled development source must match the installed app');
  assert.equal(JSON.parse(archived('development-tools/npm.asar','package.json')).name,'npm');
  for(const [archive,file] of [['local-server/runtime.asar','dist/desktop-local-entry.js'],['development-tools/npm.asar','bin/npm-cli.js']])
    assert.ok(archived(archive,file).length>0,'Missing archived runtime: '+file);
}
