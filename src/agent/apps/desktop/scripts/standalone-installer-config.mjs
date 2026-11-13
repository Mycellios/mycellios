import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';

// API overrides concatenate electron-builder's resource arrays. A complete
// configuration file retains platform/voice defaults while replacing arrays.
export async function writeStandaloneInstallerConfig(desktopRoot,overrides,output,name='installer-config.json') {
  const base=JSON.parse(await readFile(path.join(desktopRoot,'package.json'),'utf8')).build??{};
  function merge(left,right) {
    const result={...left};
    for(const [key,value] of Object.entries(right))result[key]=value&&!Array.isArray(value)&&typeof value==='object'
      ?merge(left?.[key]&&!Array.isArray(left[key])?left[key]:{},value):value;
    return result;
  }
  await mkdir(output,{recursive:true});
  const file=path.resolve(output,name);
  await writeFile(file,JSON.stringify({...merge(base,overrides),extends:null},null,2));
  return file;
}
