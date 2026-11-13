import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdir,readdir,readFile,copyFile,writeFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

export const desktopPlatforms=['windows-x64','macos-arm64','macos-x64','linux-x64','fedora-x64','linux-appimage-x64'];
const hex=/^[a-f0-9]{40}$/;
export function validateReleaseIndex(v){
 if(v?.schema!=='mycellios-desktop-release-index/1'||!/^\d+\.\d+\.\d+$/.test(v.version)||!hex.test(v.revision)||!hex.test(v.tree)||v.tag!==`desktop-v${v.version}`||!/^\d+$/.test(v.workflowRunId))throw Error('Invalid release identity');
 if(!Array.isArray(v.assets)||v.assets.length<6||v.assets.length>64||!Array.isArray(v.packages))throw Error('Incomplete release');
 const names=new Set();let total=0;
 for(const a of v.assets){if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,179}$/.test(a.name)||a.name.includes('..')||names.has(a.name)||!Number.isSafeInteger(a.bytes)||a.bytes<=0||a.bytes>2_000_000_000||!/^[a-f0-9]{64}$/.test(a.sha256))throw Error('Invalid release asset');names.add(a.name);total+=a.bytes;}
 if(total>8_000_000_000)throw Error('Oversized release');
 if(v.packages.length!==desktopPlatforms.length||new Set(v.packages.map(p=>p.id)).size!==desktopPlatforms.length||!desktopPlatforms.every(id=>v.packages.some(p=>p.id===id)))throw Error('Missing platform');
 const formats={'windows-x64':['EXE','.exe'],'macos-arm64':['DMG','.dmg'],'macos-x64':['DMG','.dmg'],'linux-x64':['DEB','.deb'],'fedora-x64':['RPM','.rpm'],'linux-appimage-x64':['AppImage','.AppImage']};
 for(const p of v.packages){if(!p.fileName?.startsWith(`Mycellios-Desktop-${v.version}-`)||p.format!==formats[p.id]?.[0]||!p.fileName.endsWith(formats[p.id]?.[1]))throw Error('Package version/format mismatch');if(!names.has(p.fileName)||typeof p.automaticUpdates!=='boolean'||p.qualifiedStartup!==true)throw Error('Unqualified platform');
  if(p.automaticUpdates&&p.id!=='linux-appimage-x64'&&(!p.signed||p.id.startsWith('macos-')&&!p.notarized))throw Error('Automatic update has no qualified signature');}
 const channels=['windows/x64','macos/arm64','macos/x64','linux/x64'];
 if(Object.keys(v.feeds??{}).length!==channels.length||!channels.every(c=>v.feeds[c]))throw Error('Missing update feed');
 for(const [channel,feed] of Object.entries(v.feeds)){if(!channels.includes(channel)||feed.fileName!==`latest-${channel.replace('/','-')}.yml`||!names.has(feed.fileName)||typeof feed.automaticUpdates!=='boolean')throw Error('Invalid update feed');if(feed.automaticUpdates&&!v.packages.some(p=>p.automaticUpdates&&p.id===(channel==='linux/x64'?'linux-appimage-x64':channel.replace('/','-'))))throw Error('Unqualified automatic feed');}
 if(!names.has(v.source))throw Error('Missing source archive');
 return v;
}
export async function assetIdentity(file,name=path.basename(file)){
 const h=createHash('sha256');for await(const b of createReadStream(file))h.update(b);
 return {name,bytes:(await stat(file)).size,sha256:h.digest('hex')};
}
async function walk(dir){let all=[];for(const d of await readdir(dir,{withFileTypes:true})){const f=path.join(dir,d.name);if(d.isSymbolicLink())throw Error('Artifact links are forbidden');if(d.isDirectory())all.push(...await walk(f));else all.push(f);}return all;}
export async function prepareReleaseIndex({input,output,revision,tree,version,workflowRunId}){
 await mkdir(output,{recursive:true});const files=await walk(input),packages=[],assets=[],feeds={};
 const windows=JSON.parse(await readFile(files.find(f=>path.basename(f)==='desktop-release.json'),'utf8'));
 if(windows.revision!==revision||windows.tree!==tree||windows.version!==version||!windows.qualifiedStartup||!windows.qualifiedInstallation)throw Error('Unqualified Windows installer');
 const mac={};for(const arch of ['arm64','x64']){
  const f=files.find(f=>f.includes(`macos-${arch}`)&&path.basename(f)==='platform-qualification.json');
  const q=JSON.parse(await readFile(f,'utf8'));if(q.revision!==revision||q.tree!==tree||q.version!==version||!q.qualifiedStartup||!q.qualifiedSignature)throw Error('Unqualified Mac '+arch);mac[arch]=q;
 }
 const linuxProof=files.find(f=>f.includes('linux')&&path.basename(f)==='desktop-build.json');
 const linux=JSON.parse(await readFile(linuxProof,'utf8'));if(linux.revision!==revision||linux.tree!==tree||linux.version!==version)throw Error('Linux source mismatch');
 const linuxSums=new Map((await readFile(path.join(path.dirname(linuxProof),'SHA256SUMS.txt'),'utf8')).trim().split(/\r?\n/).map(line=>{const m=line.match(/^([a-f0-9]{64})  (.+)$/);if(!m)throw Error('Invalid Linux qualification hashes');return [path.basename(m[2]),m[1]];}));
 const endings=[['windows-x64',/-windows-x64-pilot\.exe$/,'EXE'],['macos-arm64',/-macos-arm64-preview\.dmg$/,'DMG'],['macos-x64',/-macos-x64-preview\.dmg$/,'DMG'],['linux-x64',/-linux-x64-pilot\.deb$/,'DEB'],['fedora-x64',/-fedora-x86_64\.rpm$/,'RPM'],['linux-appimage-x64',/-linux-x64-pilot\.AppImage$/,'AppImage']];
 for(const [id,pattern,format] of endings){const matches=files.filter(f=>pattern.test(f));if(matches.length!==1)throw Error('Missing/ambiguous package '+id);const file=matches[0],q=id.startsWith('macos-')?mac[id.slice(6)]:id==='windows-x64'?windows:linux;
  packages.push({id,format,fileName:path.basename(file),qualifiedStartup:true,signed:q.updateTrust==='signed'&&q.automaticUpdates===true,notarized:q.notarized===true,automaticUpdates:id==='linux-appimage-x64'||(q.updateTrust==='signed'&&q.automaticUpdates===true)});
 }
 for(const [id,pattern] of endings){const file=files.find(f=>pattern.test(f));const hash=(await assetIdentity(file)).sha256;const q=id.startsWith('macos-')?mac[id.slice(6)]:null;if(q&&q.files[path.basename(file)]?.sha256!==hash)throw Error('Mac changed after qualification');if(id==='windows-x64'&&(windows.artifact.fileName!==path.basename(file)||windows.artifact.sha256!==hash))throw Error('Windows changed after qualification');if(['linux-x64','fedora-x64','linux-appimage-x64'].includes(id)&&linuxSums.get(path.basename(file))!==hash)throw Error('Linux changed after qualification');}
 for(const file of files){let name=path.basename(file);if(!/\.(exe|dmg|zip|deb|rpm|AppImage|yml|blockmap|tar\.gz)$/.test(name))continue;
  if(name.endsWith('.yml')){const channel=file.includes('macos-arm64')?'macos/arm64':file.includes('macos-x64')?'macos/x64':file.includes('linux')?'linux/x64':'windows/x64';name='latest-'+channel.replace('/','-')+'.yml';
   let text=await readFile(file,'utf8');text=text.replace(/^(\s*(?:-\s*)?(?:url|path):\s*)([^\s]+)\s*$/gm,(_m,prefix,value)=>{if(!/^[A-Za-z0-9][A-Za-z0-9._-]+$/.test(value))throw Error('Unexpected updater URL');return prefix+`https://www.mycellios.com/downloads/desktop/releases/${version}/${value}`;});
   await writeFile(path.join(output,name),text);feeds[channel]={fileName:name,automaticUpdates:packages.some(p=>p.automaticUpdates&&(channel==='linux/x64'?p.id==='linux-appimage-x64':p.id===channel.replace('/','-')))};
  }else await copyFile(file,path.join(output,name));
  if(assets.some(a=>a.name===name))throw Error('Duplicate immutable asset '+name);assets.push(await assetIdentity(path.join(output,name),name));
 }
 const source=assets.find(a=>/^Mycellios-Desktop-[\d.]+-source-[a-f0-9]+\.tar\.gz$/.test(a.name))?.name;
 const index=validateReleaseIndex({schema:'mycellios-desktop-release-index/1',version,revision,tree,tag:`desktop-v${version}`,workflowRunId:String(workflowRunId),source,packages,assets,feeds});
 await writeFile(path.join(output,'desktop-release-index.json'),JSON.stringify(index,null,2)+'\n');return index;
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){const [input,output,revision,tree,version,workflowRunId]=process.argv.slice(2);await prepareReleaseIndex({input,output,revision,tree,version,workflowRunId});}
