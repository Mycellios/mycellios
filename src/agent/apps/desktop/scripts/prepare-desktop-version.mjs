import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

/** Preparation only: no commit, Git tag, upload, deployment or automatic app update. */
export async function prepareDesktopVersion(agent,increment){
 if(!['patch','minor','major'].includes(increment))throw Error('Choose patch, minor or major');
 const packageFile=path.join(agent,'apps/desktop/package.json'),lockFile=path.join(agent,'package-lock.json');
 const pkg=JSON.parse(await readFile(packageFile,'utf8')),lock=JSON.parse(await readFile(lockFile,'utf8'));
 if(!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(pkg.version)||lock.packages?.['apps/desktop']?.version!==pkg.version)
  throw Error('Desktop and lockfile versions must agree before preparation');
 const oldVersion=pkg.version,parts=oldVersion.split('.').map(Number),index={major:0,minor:1,patch:2}[increment];
 parts[index]++;for(let i=index+1;i<parts.length;i++)parts[i]=0;
 const version=parts.join('.');pkg.version=version;lock.packages['apps/desktop'].version=version;
 await writeFile(packageFile,JSON.stringify(pkg,null,2)+'\n');
 await writeFile(lockFile,JSON.stringify(lock,null,2)+'\n');
 return {oldVersion,version,tag:`desktop-v${version}-windows-preview`};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const agent=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
 console.log(JSON.stringify(await prepareDesktopVersion(agent,process.argv[2])));
}
