import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {_electron as electron} from '@playwright/test';
import {waitForMycelliosSignIn} from './signin-probe.mjs';
import {checkPreviewSignature} from './signature-check.mjs';
const app=path.resolve(process.argv[2]);
const output=path.resolve(process.argv[3]);
if(process.platform!=='darwin'||process.arch!=='arm64')throw Error('Qualification needs Apple Silicon macOS');
await fs.mkdir(output,{recursive:true});
const binary=path.join(app,'Contents/MacOS/Mycellios Desktop');
const arch=execFileSync('/usr/bin/lipo',['-archs',binary],{encoding:'utf8'}).trim();
if(arch!=='arm64')throw Error('Unexpected application architecture');
const resources=path.join(app,'Contents/Resources');
for(const f of ['app.asar','contribution/mycellios-runtime.pkg','contribution/runtime.json','contribution/install-runtime-macos.sh','contribution/describe-runtime-macos.sh','licenses/Agent-Apache-2.0.txt','licenses/Mycellios-GPL-3.0.txt'])await fs.access(path.join(resources,f));
execFileSync('/bin/sh',['-n',path.join(resources,'contribution/install-runtime-macos.sh')]);
execFileSync('/bin/sh',['-n',path.join(resources,'contribution/describe-runtime-macos.sh')]);
execFileSync('/usr/bin/shlock',['-p',String(process.pid),'-f',path.join(output,'lock-probe')]);
await fs.unlink(path.join(output,'lock-probe'));
const userData=await fs.mkdtemp(path.join(os.tmpdir(),'mycellios-mac-qa-'));
const receipt={platform:process.platform,architecture:arch,profile:'isolated-empty',physicalMac:false,realAccountSignIn:false,modelInference:false,signature:checkPreviewSignature(app),launches:[]};
try{
 for(let i=0;i<2;i++){
  const client=await electron.launch({executablePath:binary,env:{...process.env,RAKAZO_PERFORMANCE_USER_DATA:userData},timeout:90000});
  try{
   await client.firstWindow({timeout:60000});
   let window;
   const deadline=Date.now()+60000;
   while(!window&&Date.now()<deadline){
    for(const page of client.windows())if(await page.evaluate(()=>Boolean(window.rakazoDesktop)).catch(()=>false)){window=page;break;}
    if(!window)await new Promise(resolve=>setTimeout(resolve,100));
   }
   if(!window)throw Error('No main window with the native Desktop bridge');
   const signInSurface=await waitForMycelliosSignIn(window);
   const mainWindows=await client.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().filter(w=>w.isVisible()).length);
   if(mainWindows!==1)throw Error('Desktop did not open exactly one visible window');
   const isolation=await window.evaluate(()=>({node:typeof window.require,process:typeof window.process}));
   if(isolation.node!=='undefined'||isolation.process!=='undefined')throw Error('Renderer exposes Node privileges');
   await window.screenshot({path:path.join(output,`launch-${i+1}.png`)});
   receipt.launches.push({visibleWindows:mainWindows,path:new URL(window.url()).pathname,signInSurface,rendererIsolated:true});
  } catch(error){
   receipt.failure=String(error.message).split('\n')[0];
   for(const [j,page]of client.windows().entries())await page.screenshot({path:path.join(output,`failure-${i}-${j}.png`)}).catch(()=>{});
   await fs.writeFile(path.join(output,'macos-qualification.json'),JSON.stringify(receipt,null,2));throw error;
  } finally{await client.close();}
 }
 await fs.writeFile(path.join(output,'macos-qualification.json'),JSON.stringify(receipt,null,2));
}finally{await fs.rm(userData,{recursive:true,force:true});}
