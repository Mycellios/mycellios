import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import * as fs from 'node:fs/promises';
import path from 'node:path';

// osx-sign 1.3.3 recursively opens the whole bundle at once. Large bundled
// servers exceed macOS file descriptors. Preserve its discovery/signing order
// while bounding binary inspection to one open file, without relaxing signing.
export async function walkSequential(dir, {io=fs, isBinaryFile}={}) {
  const result=[];
  for(const child of await io.readdir(dir)) {
    const file=path.resolve(dir,child), stat=await io.stat(file);
    if(stat.isFile()) {
      if(path.extname(file)==='.cstemp') await io.unlink(file);
      else if(await isBinaryFile(file)) result.push(file);
    } else if(stat.isDirectory()&&!stat.isSymbolicLink()) {
      result.push(...await walkSequential(file,{io,isBinaryFile}));
      if(['.app','.framework'].includes(path.extname(file)))result.push(file);
    }
  }
  return result;
}

export async function installBoundedMacSigningWalk() {
  const require=createRequire(import.meta.url);
  const builder=createRequire(require.resolve('app-builder-lib'));
  const signing=createRequire(builder.resolve('@electron/osx-sign'));
  const utilPath=path.join(path.dirname(builder.resolve('@electron/osx-sign')),'util.js');
  const bytes=await fs.readFile(utilPath);
  if(createHash('sha256').update(bytes).digest('hex')!=='9c7fad52d41d72b4c5c2ccd85a9bbdf3bc88d72b98c2de4eae2a029a4a3e1595')
    throw Error('Review the bounded signing adapter for the changed osx-sign dependency');
  const util=signing(utilPath), {isBinaryFile}=signing('isbinaryfile');
  if(typeof util.walkAsync!=='function')throw Error('Unsupported osx-sign discovery API');
  util.walkAsync=dir=>walkSequential(dir,{isBinaryFile});
}
