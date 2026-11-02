import fs from'node:fs/promises';import path from'node:path';import os from'node:os';import{createHash}from'node:crypto';import{createReadStream}from'node:fs';import{execFileSync}from'node:child_process';import{checkPreviewSignature}from'./signature-check.mjs';
if(process.platform!=='darwin'||process.arch!=='arm64')throw Error('DMG qualification requires Apple Silicon macOS');
const[app,dmg,output]=process.argv.slice(2).map(p=>path.resolve(p));
if(!app||!dmg||!output)throw Error('Provide the packaged app, final DMG and evidence output');
const digest=async file=>{const h=createHash('sha256');for await(const b of createReadStream(file))h.update(b);return h.digest('hex');};
const mount=await fs.mkdtemp(path.join(os.tmpdir(),'mycellios-dmg-qualification-'));let attached=false;
try{
 execFileSync('/usr/bin/hdiutil',['attach','-readonly','-nobrowse','-mountpoint',mount,dmg],{stdio:'pipe',timeout:60000});attached=true;
 const installed=path.join(mount,'Mycellios Desktop.app');
 const signature=checkPreviewSignature(installed);
 const asar='Contents/Resources/app.asar';
 const original=await digest(path.join(app,asar)),distributed=await digest(path.join(installed,asar));
 if(original!==distributed)throw Error('Final DMG changes the qualified native application');
 await fs.mkdir(path.dirname(output),{recursive:true});
 await fs.writeFile(output,JSON.stringify({artifact:'final-readonly-dmg',dmgSha256:await digest(dmg),asarSha256:distributed,...signature,physicalMac:false,browserDownloadLaunch:false},null,2));
}finally{
 if(attached)execFileSync('/usr/bin/hdiutil',['detach',mount],{stdio:'pipe',timeout:60000});
 // A failed detach must stop before deleting a mounted volume.
 await fs.rm(mount,{recursive:true,force:true});
}
