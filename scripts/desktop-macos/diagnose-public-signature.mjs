import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {checkPreviewSignature} from './signature-check.mjs';
if(process.platform!=='darwin'||process.arch!=='x64')throw Error('Use the isolated Intel Mac diagnostic runner');
const dmg=path.resolve(process.argv[2]);
if((await fs.stat(dmg)).size!==810381694)throw Error('Unexpected published DMG size');
const h=createHash('sha256');for await(const b of createReadStream(dmg))h.update(b);
if(h.digest('hex')!=='798ed7864d7a4c8f4e04e392402f53c1ef219d91d1225860ab2f51210b6ebeed')throw Error('Published DMG checksum differs');
const mount=await fs.mkdtemp(path.join(os.tmpdir(),'mycellios-readonly-signature-'));let attached=false;
try{
 execFileSync('/usr/bin/hdiutil',['attach','-readonly','-nobrowse','-mountpoint',mount,dmg],{stdio:'pipe',timeout:60000});attached=true;
 const receipt=checkPreviewSignature(path.join(mount,'Mycellios Desktop.app'),(file,args,options)=>{
  const start=Date.now();const r=spawnSync(file,args,options);
  console.log(JSON.stringify({tool:path.basename(file),operation:args[0],elapsedMs:Date.now()-start,status:r.status,signal:r.signal,code:r.error?.code??null,stderr:String(r.stderr??'').slice(-4000)}));
  return r;
 });console.log(JSON.stringify({publishedVersion:'0.3.50',readonly:true,installed:false,executed:false,...receipt}));
}finally{
 if(attached){execFileSync('/usr/bin/hdiutil',['detach',mount],{stdio:'pipe',timeout:60000});attached=false;}
 if(!attached)await fs.rm(mount,{recursive:true,force:true});
}
