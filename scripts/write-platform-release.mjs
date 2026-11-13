import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readFile,readdir,stat,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
const [out,platform]=process.argv.slice(2);
if(!out||!['linux','macos-arm64','macos-x64'].includes(platform))throw Error('Expected output directory and native platform');
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
const version=JSON.parse(await readFile('src/agent/apps/desktop/package.json','utf8')).version;
const digest=async file=>{const h=createHash('sha256');for await(const b of createReadStream(file))h.update(b);return h.digest('hex');};
const candidates=platform==='linux'?[...await readdir(out),...(await readdir(path.join(out,'fedora'))).map(n=>'fedora/'+n)]:await readdir(out);
const files=[];
for(const name of candidates){
 if(!name.endsWith('.deb')&&!name.endsWith('.rpm')&&!name.endsWith('.dmg'))continue;
 const file=path.join(out,name),s=await stat(file);
 if(!s.isFile()||s.size<1||s.size>2_000_000_000)throw Error('Invalid installer');
 const id=name.endsWith('.deb')?'linux-x64':name.endsWith('.rpm')?'fedora-x64':platform;
 if(!name.includes(version)||files.some(f=>f.id===id))throw Error('Ambiguous installer identity');
 files.push({id,fileName:path.basename(name),format:name.endsWith('.dmg')?'DMG':name.endsWith('.deb')?'DEB':'RPM',bytes:s.size,sha256:await digest(file),version});
}
if(files.length!==(platform==='linux'?2:1))throw Error('Missing qualified installer');
await writeFile(path.join(out,`platform-release-${platform}.json`),JSON.stringify({schema:'mycellios-platform-release/1',revision:git('rev-parse','HEAD'),tree:git('rev-parse','HEAD^{tree}'),version,platform,qualifiedStartup:true,qualification:'native-ci',physicalInstallation:false,automaticUpdates:false,files},null,2));
