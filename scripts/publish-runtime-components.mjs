import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {checkedFirstPartyRelease,resolveFirstPartyRelease} from './release-publication.mjs';

export function validateRuntimeComponent(c,extension){
 if(!['pkg','msi','deb'].includes(extension)||c?.schema!=='mycellios-desktop-runtime/2'||
   c.file!==`mycellios-runtime.${extension}`||!Number.isSafeInteger(c.bytes)||c.bytes<1||c.bytes>2_000_000_000||
   typeof c.sha256!=='string'||!/^[a-f0-9]{64}$/.test(c.sha256)||
   c.url!==`https://github.com/Mycellios/mycellios/releases/download/desktop-runtime-${c.sha256}/${c.file}`)
   throw Error('Invalid pinned runtime component');
 return c;
}

export const resolveRuntimeRelease=(tag,access)=>resolveFirstPartyRelease('runtime',tag,access);

/** Serialized with Desktop publication. Never clobber a component or mutable latest pointer. */
export async function publishRuntimeComponents({input,revision,gh,api}){
 const result=[];
 for(const [platform,extension] of [['windows','msi'],['linux','deb'],['macos-arm64','pkg']])
  result.push(await publishRuntimeComponent({directory:path.join(input,`desktop-${platform}-${revision}`,'runtime-component'),extension,revision,gh,api}));
 return result;
}

/** Publishes one staged component (component.json + package) as its immutable hash-named release. */
export async function publishRuntimeComponent({directory,extension,revision,gh,api}){
 const c=validateRuntimeComponent(JSON.parse(await fs.readFile(path.join(directory,'component.json'),'utf8')),extension);
 const file=path.join(directory,c.file),info=await fs.lstat(file);
 const hash=createHash('sha256');for await(const block of createReadStream(file))hash.update(block);
 if(!info.isFile()||info.isSymbolicLink()||info.size!==c.bytes||hash.digest('hex')!==c.sha256)throw Error('Runtime component bytes differ');
 const tag=`desktop-runtime-${c.sha256}`;
 let existing=await resolveRuntimeRelease(tag,{gh,api});
 const metadata=path.join(directory,'component.json'),metadataBytes=await fs.readFile(metadata);
 const wanted=[{name:c.file,size:c.bytes,digest:`sha256:${c.sha256}`,path:file},
   {name:'component.json',size:metadataBytes.length,digest:'sha256:'+createHash('sha256').update(metadataBytes).digest('hex'),path:metadata}];
 if(!existing){
  gh('release','create',tag,'--target',revision,'--draft','--prerelease','--latest=false',
     '--title',`Mycellios contribution runtime ${c.sha256.slice(0,12)}`,
     '--notes','Pinned contribution runtime installer, downloaded only on explicit enrollment or an explicit one-time runtime update. The package retains its original runtime and license metadata.');
  existing=await resolveRuntimeRelease(tag,{gh,api});
 }
 if(!existing||!Array.isArray(existing.assets))throw Error('Runtime component draft unavailable');
 for(const wantedAsset of wanted){
  const found=existing.assets.filter(a=>a.name===wantedAsset.name);
  if(found.length>1||found[0]&&(found[0].size!==wantedAsset.size||found[0].digest!==wantedAsset.digest))
   throw Error('Existing runtime component changed; preserve it');
  if(!found.length){
   if(!existing.draft)throw Error('Published runtime component is incomplete; preserve it');
   gh('release','upload',tag,wantedAsset.path);
  }
 }
 const staged=checkedFirstPartyRelease('runtime',await api('releases/'+existing.id),tag,existing.id);
 if(!wanted.every(a=>staged?.assets?.filter(b=>b.name===a.name&&b.size===a.size&&b.digest===a.digest).length===1))
  throw Error('Runtime component upload failed verification');
 if(existing.draft)gh('release','edit',tag,'--draft=false','--prerelease','--latest=false');
 // A public immutable asset and its GitHub digest must exist before Desktop points at it.
 const published=checkedFirstPartyRelease('runtime',await api('releases/tags/'+tag),tag,existing.id);
 const verified=published?.assets?.filter(a=>a.name===c.file)??[];
 if(published?.draft!==false||verified.length!==1||verified[0].size!==c.bytes||verified[0].digest!==`sha256:${c.sha256}`)
  throw Error('Runtime component publication failed verification');
 return c;
}
