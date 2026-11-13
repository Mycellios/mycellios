import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {mkdtemp,mkdir,writeFile,access} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
import {checkPreviewSignature} from './desktop-macos/signature-check.mjs';
if(process.platform!=='darwin'||!['arm64','x64'].includes(process.arch))throw Error('Native Mac runner required');
const [appRoot,out]=process.argv.slice(2).map(p=>path.resolve(p));
const binary=path.join(appRoot,'Contents/MacOS/Mycellios Desktop');
assert.equal(execFileSync('/usr/bin/lipo',['-archs',binary],{encoding:'utf8'}).trim(),process.arch==='arm64'?'arm64':'x86_64');
const signature=checkPreviewSignature(appRoot);
await access(path.join(appRoot,'Contents/Resources/local-server/dist/desktop-local-entry.js'));
await access(path.join(appRoot,'Contents/Resources/web/first-party/index.html'));
const require=createRequire(new URL('../src/agent/apps/desktop/package.json',import.meta.url));
const {_electron,expect}=await import(pathToFileURL(require.resolve('@playwright/test')).href);
for(let launch=0;launch<2;launch++){
 const profile=await mkdtemp(path.join(tmpdir(),'mycellios-macos-release-'));
 const instance=await _electron.launch({executablePath:binary,env:{...process.env,RAKAZO_PERFORMANCE_USER_DATA:profile,RAKAZO_DISABLE_AUTO_UPDATE:'1',RAKAZO_WEB_URL:'data:text/html,<main>Mycellios native release</main>'}});
 try{
  await expect.poll(()=>instance.windows().some(p=>p.url().startsWith('data:text/html')),{timeout:60000}).toBe(true);
  const page=instance.windows().find(p=>p.url().startsWith('data:text/html'));
  await expect(page.getByText('Mycellios native release')).toBeVisible();
  assert.equal(await page.evaluate(()=>window.rakazoDesktop?.platform),'darwin');
  assert.equal(await instance.evaluate(({app})=>app.isPackaged),true);
 }finally{await instance.close();}
}
await mkdir(out,{recursive:true});
await writeFile(path.join(out,'native-startup.json'),JSON.stringify({qualifiedStartup:true,platform:process.platform,arch:process.arch,launches:2,signature,physicalMac:false},null,2));
