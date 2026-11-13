import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,readdir,writeFile,rm} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {_electron,expect} from '@playwright/test';
const [directory,revision]=process.argv.slice(2);
if(process.platform!=='darwin'||!directory||!/^\w{40}$/.test(revision))throw Error('Native Mac qualification requires its exact revision');
const app=path.join(directory,process.arch==='arm64'?'mac-arm64':'mac','Mycellios Desktop.app');
const mode=JSON.parse(await readFile(path.join(directory,'release-mode.json'),'utf8'));
execFileSync('codesign',['--verify','--deep','--strict',app],{stdio:'pipe'});
if(mode.signed){execFileSync('spctl',['--assess','--type','execute',app],{stdio:'pipe'});execFileSync('xcrun',['stapler','validate',app],{stdio:'pipe'});}
const identity=JSON.parse(await readFile(path.join(directory,'desktop-build.json'),'utf8'));
if(identity.revision!==revision||identity.platform!==`macos-${process.arch}`)throw Error('Mac source identity mismatch');
const profile=await mkdtemp(path.join(os.tmpdir(),'mycellios-release-profile-'));
try {
 for(let i=0;i<2;i++){
  const client=await _electron.launch({executablePath:path.join(app,'Contents/MacOS/Mycellios Desktop'),env:{...process.env,RAKAZO_PERFORMANCE_USER_DATA:profile,RAKAZO_DISABLE_AUTO_UPDATE:'1',RAKAZO_WEB_URL:'data:text/html,<main>Mycellios release qualification</main>'}});
  try{const page=await client.firstWindow({timeout:60000});await expect(page.getByText('Mycellios release qualification')).toBeVisible({timeout:60000});
   if(!await client.evaluate(({app})=>app.isPackaged))throw Error('Unpackaged Mac host');
   if(await page.evaluate(()=>typeof window.require!=='undefined'))throw Error('Renderer is not isolated');
  }finally{await client.close();}
 }
}finally{await rm(profile,{recursive:true,force:true});}
const sha=async file=>{const h=createHash('sha256');for await(const b of createReadStream(file))h.update(b);return h.digest('hex');};
const dmg=(await readdir(directory)).find(n=>n.endsWith('.dmg'));if(!dmg)throw Error('Missing final disk image');
const mount=await mkdtemp(path.join(os.tmpdir(),'mycellios-release-dmg-'));let attached=false;
try{execFileSync('hdiutil',['attach','-readonly','-nobrowse','-mountpoint',mount,path.join(directory,dmg)],{stdio:'pipe'});attached=true;
 const distributed=path.join(mount,'Mycellios Desktop.app');execFileSync('codesign',['--verify','--deep','--strict',distributed],{stdio:'pipe'});
 if(await sha(path.join(app,'Contents/Resources/app.asar'))!==await sha(path.join(distributed,'Contents/Resources/app.asar')))throw Error('DMG differs from qualified app');
}finally{if(attached)execFileSync('hdiutil',['detach',mount],{stdio:'pipe'});await rm(mount,{recursive:true,force:true});}
const files={};for(const name of await readdir(directory))if(/\.(dmg|zip|yml)$/.test(name))files[name]={sha256:await sha(path.join(directory,name))};
await writeFile(path.join(directory,'platform-qualification.json'),JSON.stringify({...identity,qualifiedStartup:true,qualifiedSignature:true,notarized:mode.signed,automaticUpdates:mode.signed,physicalMac:false,files},null,2)+'\n');
