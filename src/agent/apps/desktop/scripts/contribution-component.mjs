import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {copyFile,lstat,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';

/** Original pinned bytes are qualified by the builder even when delivered separately. */
export async function stageContributionComponent({file,sha256,output,extension}) {
  if(!['pkg','msi','deb'].includes(extension)||!/^[a-f0-9]{64}$/.test(sha256))throw Error('Invalid runtime component pin');
  const info=await lstat(file);
  if(!info.isFile()||info.isSymbolicLink()||info.size<1||info.size>2_000_000_000)throw Error('Invalid runtime component file');
  const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);
  if(hash.digest('hex')!==sha256)throw Error('Runtime component hash mismatch');
  const fileName=`mycellios-runtime.${extension}`;
  const component={schema:'mycellios-desktop-runtime/2',file:fileName,sha256,bytes:info.size,
    url:`https://github.com/Mycellios/mycellios/releases/download/desktop-runtime-${sha256}/${fileName}`};
  const directory=path.join(output,'runtime-component');await mkdir(directory,{recursive:true});
  await copyFile(file,path.join(directory,fileName));
  await writeFile(path.join(directory,'component.json'),JSON.stringify(component,null,2));
  const manifest=path.join(output,'runtime.json');await writeFile(manifest,JSON.stringify(component,null,2));
  return manifest;
}
