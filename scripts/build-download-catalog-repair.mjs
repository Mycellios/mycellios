// Recompile only the catalog contract while preserving the served page's overlays.
// A later full page build consumes this same corrected source contract directly.
import {build} from 'vite';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,cp} from 'node:fs/promises';
import path from 'node:path';
const [baseline,expected,output]=process.argv.slice(2);
if(!baseline||!/^[a-f0-9]{64}$/.test(expected??'')||!output)throw Error('Use baseline-web expected-entry-sha256 output-web');
const html=await readFile(path.join(baseline,'desktop-downloads.html'),'utf8');
const entries=[...html.matchAll(/src="\/downloads\/desktop\/assets\/([A-Za-z0-9._-]+\.js)"/g)];
if(entries.length!==1)throw Error('Expected one known page entry');
const name=entries[0][1],source=await readFile(path.join(baseline,'assets',name),'utf8');
const sha=v=>createHash('sha256').update(v).digest('hex');
if(sha(source)!==expected)throw Error('Served baseline changed');
// This exact call identifies the verified production contract, not an arbitrary
// text substitution throughout a minified bundle. Fail if its shape changes.
if(source.split('if(!_e(r))throw Error(`Invalid release`)').length!==2)throw Error('Baseline contract call changed');
await mkdir(output,{recursive:true});await cp(baseline,output,{recursive:true,errorOnExist:false});
await build({configFile:false,publicDir:false,build:{outDir:path.join(output,'repair'),emptyOutDir:false,minify:true,
 lib:{entry:path.resolve('src/contracts/desktop-downloads.ts'),formats:['es'],fileName:()=> 'catalog.js'}}});
const module=await readFile(path.join(output,'repair/catalog.js'),'utf8');
const moduleName='download-catalog-'+sha(module).slice(0,16)+'.js';
await writeFile(path.join(output,'assets',moduleName),module);
const repaired='import{isDesktopDownloadCatalog as repairedCatalog}from"./'+moduleName+'";\n'+source.replace('if(!_e(r))throw Error(`Invalid release`)','if(!repairedCatalog(r))throw Error(`Invalid release`)');
const entry='desktop-downloads-'+sha(repaired).slice(0,16)+'.js';
await writeFile(path.join(output,'assets',entry),repaired);
await writeFile(path.join(output,'desktop-downloads.html'),html.replace('/assets/'+name,'/assets/'+entry));
await writeFile(path.join(output,'catalog-repair.json'),JSON.stringify({baselineEntry:name,baselineSha256:expected,entry,entrySha256:sha(repaired),contract:moduleName,contractSha256:sha(module)},null,2));
console.log(JSON.stringify({entry,entrySha256:sha(repaired),preservedPageOverlays:true}));
