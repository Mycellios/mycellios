import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,symlink} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {authorizedControl,developmentIdentity,developmentStack,freeDevelopmentPorts,installedDevelopmentDependencies,preparationFingerprint} from './desktop-dev-state.mjs';
import {projectLocalEnvironment} from './project-local-env.mjs';

test('canonical worktrees keep their identity while separate sources stay isolated',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'mycellios-dev-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const a=path.join(root,'a'),b=path.join(root,'b');await mkdir(a);await mkdir(b);
  const first=await developmentIdentity(a);
  assert.deepEqual(await developmentIdentity(path.join(a,'.')),first);
  assert.notEqual((await developmentIdentity(b)).id,first.id);
  const alias=path.join(root,'alias');await symlink(a,alias,process.platform==='win32'?'junction':'dir');
  assert.deepEqual(await developmentIdentity(alias),first);
  assert.match(first.id,/^wt-[a-f0-9]{64}$/);assert.ok(first.hue>=0&&first.hue<360);
});
test('dynamic ports are distinct valid loopback ports',async()=>{
  const ports=await freeDevelopmentPorts();assert.equal(new Set(Object.values(ports)).size,3);
  for(const port of Object.values(ports))assert.ok(port>=1024&&port<=65535);
});
test('isolated descriptor rejects invalid ports, collisions and relative state',()=>{
  for(const data of [{data:'relative',web:11000,api:11001,ready:11002},{data:os.tmpdir(),web:80,api:11001,ready:11002},{data:os.tmpdir(),web:11000,api:11000,ready:11002},null])
    assert.throws(()=>developmentStack(JSON.stringify(data)));
});
test('Dev redirects every local service and scrubs credentials and production identity',()=>{
  const data=path.join(os.tmpdir(),'private-dev-data');
  const env=projectLocalEnvironment({MYCELLIOS_DEV_STACK:JSON.stringify({data,web:12001,api:12002,ready:12003}),PATH:'tools',DATABASE_URL:'prod',OIDC_CLIENT_SECRET:'secret',ANTSEED_API_KEY:'secret',OPENAI_API_KEY:'secret',NODE_OPTIONS:'--require attacker'});
  assert.equal(env.DATA_DIR,data);assert.equal(env.API_PROXY_TARGET,'http://127.0.0.1:12002');assert.equal(env.BETTER_AUTH_URL,'http://127.0.0.1:12001');
  assert.equal(env.MYCELLIOS_SSO_ENABLED,'false');assert.equal(env.RAKAZO_WORKER_HEALTH_FILE,path.join(data,'worker-health.json'));
  for(const key of ['DATABASE_URL','OIDC_CLIENT_SECRET','ANTSEED_API_KEY','OPENAI_API_KEY','NODE_OPTIONS'])assert.equal(env[key],undefined);
});
test('control requires the private token, exact loopback host and a native POST',()=>{
  const token='a'.repeat(64),headers={host:'127.0.0.1:12345',authorization:`Bearer ${token}`};
  assert.equal(authorizedControl({method:'POST',headers},12345,token),true);
  for(const request of [{method:'GET',headers},{method:'POST',headers:{...headers,origin:'https://untrusted.test'}},{method:'POST',headers:{...headers,host:'localhost:12345'}},{method:'POST',headers:{...headers,authorization:'Bearer wrong'}},{method:'POST',headers:{...headers,authorization:`Bearer ${'é'.repeat(64)}`}}])
    assert.equal(authorizedControl(request,12345,token),false);
});
test('preparation stamps track lock, manifests, schema and patches, but ignore source edits',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'mycellios-dev-stamp-'));t.after(()=>rm(root,{recursive:true,force:true}));
  for(const folder of ['apps/web','packages/db/prisma','patches'])await mkdir(path.join(root,folder),{recursive:true});
  for(const file of ['package.json','package-lock.json','apps/web/package.json','packages/db/package.json'])await writeFile(path.join(root,file),'{}');
  const first=await preparationFingerprint(root);await writeFile(path.join(root,'apps/web/source.ts'),'changed');assert.equal(await preparationFingerprint(root),first);
  for(const file of ['package-lock.json','apps/web/package.json','packages/db/prisma/schema.prisma','patches/fix.patch']) {
    const before=await preparationFingerprint(root);await writeFile(path.join(root,file),'changed');assert.notEqual(await preparationFingerprint(root),before);
  }
});
test('an existing installation is reused only when its installed dependency lock agrees',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'mycellios-dev-lock-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(path.join(root,'node_modules'));
  const packages={'apps/desktop':{version:'0.3.53',dependencies:{example:'1.0.0'}},'node_modules/example':{version:'1.0.0',integrity:'sha512-fixture'},'node_modules/other-platform':{version:'1.0.0',optional:true}};
  await writeFile(path.join(root,'package-lock.json'),JSON.stringify({lockfileVersion:3,packages}));
  assert.equal(await installedDevelopmentDependencies(root),false);
  const installed={lockfileVersion:3,packages:{'apps/desktop':{version:'0.3.52',dependencies:{example:'1.0.0'}},'node_modules/example':packages['node_modules/example']}};
  await writeFile(path.join(root,'node_modules/.package-lock.json'),JSON.stringify(installed));
  assert.equal(await installedDevelopmentDependencies(root),true);
  installed.packages['node_modules/example'].version='2.0.0';
  await writeFile(path.join(root,'node_modules/.package-lock.json'),JSON.stringify(installed));
  assert.equal(await installedDevelopmentDependencies(root),false);
});
