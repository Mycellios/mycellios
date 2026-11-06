import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {_electron} from '@playwright/test';
import {assertReleaseIdentity,writeWindowsRelease,hashes} from './desktop-release.mjs';

const directory=path.resolve(process.argv[2]??'');
if(process.platform!=='win32'||!process.argv[2])throw Error('Run on Windows: node scripts/qualify-windows-release.mjs <package-directory>');
const identity=JSON.parse(await fs.readFile(path.join(directory,'desktop-build.json'),'utf8'));
assertReleaseIdentity(identity,identity.version);
const packaged=JSON.parse(await fs.readFile(path.join(directory,'win-unpacked/resources/desktop-build.json'),'utf8'));
assert.deepEqual(packaged,identity);
const installer=await hashes(path.join(directory,`Mycellios-Desktop-${identity.version}-windows-x64-pilot.exe`));
const installation=JSON.parse(await fs.readFile(path.join(directory,'installer-qualification.json'),'utf8'));
assert.equal(installation.passed,true);assert.equal(installation.revision,identity.revision);
assert.equal(installation.installerSha256,installer.sha256);
const profile=await fs.mkdtemp(path.join(os.tmpdir(),'mycellios-release-qualification-'));
let app;
try{
 app=await _electron.launch({executablePath:path.join(directory,'win-unpacked/Mycellios Desktop.exe'),args:['--background'],
   env:{...process.env,RAKAZO_PERFORMANCE_USER_DATA:profile,RAKAZO_WEB_URL:'https://www.mycellios.com/agent/',RAKAZO_DISABLE_AUTO_UPDATE:'1'},timeout:120_000});
 assert.equal(await app.evaluate(({app})=>app.getVersion()),identity.version);
 await app.firstWindow({timeout:120_000});
 let page;
 const deadline=Date.now()+120_000;
 while(Date.now()<deadline){
  page=app.windows().find(p=>p.url().startsWith('https://www.mycellios.com/agent/'));
  if(page&&await page.locator('body').innerText().then(t=>/Sign in|Iniciar sesi.n|Continue with Mycellios|Continuar con Mycellios|Choose your language|Elige tu idioma/.test(t)).catch(()=>false))break;
  await new Promise(resolve=>setTimeout(resolve,250));
 }
 assert.ok(page,'No first-party application window');
 assert.match(await page.locator('body').innerText(),/Sign in|Iniciar sesi.n|Continue with Mycellios|Continuar con Mycellios|Choose your language|Elige tu idioma/);
 const bridge=await page.evaluate(()=>({platform:window.rakazoDesktop?.platform,apps:typeof window.rakazoDesktop?.appsStudio?.request,prepare:typeof window.rakazoDesktop?.update?.onPrepare}));
 assert.deepEqual(bridge,{platform:'win32',apps:'function',prepare:'function'});
 const denial=await page.evaluate(async()=>{try{await window.rakazoDesktop.appsStudio.request({action:'list'});return '';}catch(e){return String(e);}});
 assert.match(denial,/Apps necesita el acceso ya autorizado/);
 const smoke={passed:true,version:identity.version,revision:identity.revision,isolatedProfile:true,bridge,installerSha256:installer.sha256,installation,
   accountLoginSubmitted:false,realVideoGeneration:false};
 await fs.writeFile(path.join(directory,'packaged-smoke.json'),JSON.stringify(smoke,null,2));
 await writeWindowsRelease(directory,identity,smoke);
 console.log(JSON.stringify(smoke));
}finally{await app?.close();}
