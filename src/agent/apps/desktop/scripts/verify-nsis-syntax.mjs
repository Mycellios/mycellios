// A synthetic, non-published installer checks NSIS macros without a full app build.
import {mkdtemp,mkdir,writeFile,copyFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),desktop=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(process.platform!=='win32')throw Error('NSIS syntax qualification requires Windows');
const root=await mkdtemp(path.join(tmpdir(),'mycellios-nsis-syntax-'));
await mkdir(path.join(root,'scripts'));
await copyFile(path.join(desktop,'scripts/fast-install.ps1'),path.join(root,'scripts/fast-install.ps1'));
await writeFile(path.join(root,'package.json'),JSON.stringify({name:'mycellios-desktop-syntax',version:'0.3.19',main:'index.cjs',description:'Synthetic NSIS syntax fixture; never publish or install',author:'Mycellios'}));
await writeFile(path.join(root,'index.cjs'),`require('electron').app.whenReady().then(()=>require('electron').app.quit());`);
const {build,Platform,Arch}=require('electron-builder');
const result=await build({projectDir:root,targets:Platform.WINDOWS.createTarget('nsis',Arch.x64),publish:'never',config:{
 appId:'com.mycellios.desktop.syntax-fixture',productName:'Mycellios Desktop',electronVersion:'45.0.0',
 electronDist:path.dirname(require('electron')),files:['index.cjs','package.json'],directories:{output:path.join(root,'out')},
 win:{target:'nsis',signAndEditExecutable:false},nsis:{oneClick:true,perMachine:false,runAfterFinish:false,createDesktopShortcut:false,createStartMenuShortcut:false,include:path.join(desktop,'assets/fast-install.nsh')},
}});
console.log(JSON.stringify({passed:true,scope:'synthetic NSIS compilation only',directory:root,artifacts:result}));
