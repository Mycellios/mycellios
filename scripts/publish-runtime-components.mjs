import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';

export function validateRuntimeComponent(c,extension){
 if(!['pkg','msi','deb'].includes(extension)||c?.schema!=='mycellios-desktop-runtime/2'||
   c.file!==`mycellios-runtime.${extension}`||!Number.isSafeInteger(c.bytes)||c.bytes<1||c.bytes>2_000_000_000||
   typeof c.sha256!=='string'||!/^[a-f0-9]{64}$/.test(c.sha256)||
   c.url!==`https://github.com/Mycellios/mycellios/releases/download/desktop-runtime-${c.sha256}/${c.file}`)
   throw Error('Invalid pinned runtime component');
 return c;
}

function checkedRelease(release,tag,id){
 if(!release||release.tag_name!==tag||!Number.isSafeInteger(release.id)||release.id<1||
   id!==undefined&&release.id!==id||typeof release.draft!=='boolean'||!Array.isArray(release.assets))
   throw Error('Runtime component release identity differs');
 return release;
}

/** The tag endpoint can hide drafts that the owned CLI can still resolve. */
export async function resolveRuntimeRelease(tag,{gh,api}){
 if(!/^desktop-runtime-[a-f0-9]{64}$/.test(tag))throw Error('Invalid runtime component tag');
 const direct=await api('releases/tags/'+tag);
 if(direct)return checkedRelease(direct,tag);
 let output;
 try{output=gh('release','view',tag,'--repo','Mycellios/mycellios','--json','apiUrl,isDraft');}
 catch(error){
  // Missing releases may be created; auth, transport and ambiguous CLI failures
  // must never create another draft or silently switch the selected release.
  if(/^(?:release not found|could not find release|no release found)(?:\s|$)/i.test(String(error.stderr??'').trim()))return null;
  throw error;
 }
 const view=JSON.parse(output);
 const match=/^https:\/\/api\.github\.com\/repos\/Mycellios\/mycellios\/releases\/([1-9][0-9]*)$/.exec(view?.apiUrl??'');
 const id=match?Number(match[1]):NaN;
 if(!Number.isSafeInteger(id)||typeof view.isDraft!=='boolean')throw Error('Untrusted runtime component release URL');
 const release=checkedRelease(await api('releases/'+id),tag,id);
 if(release.draft!==view.isDraft)throw Error('Runtime component release state changed');
 return release;
}

/** Serialized with Desktop publication. Never clobber a component or mutable latest pointer. */
export async function publishRuntimeComponents({input,revision,gh,api}){
 const result=[];
 for(const [platform,extension] of [['windows','msi'],['linux','deb'],['macos-arm64','pkg']]){
  const directory=path.join(input,`desktop-${platform}-${revision}`,'runtime-component');
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
      '--notes','Pinned original contribution installer, downloaded only on explicit enrollment. The package retains its original runtime and license metadata.');
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
  const staged=checkedRelease(await api('releases/'+existing.id),tag,existing.id);
  if(!wanted.every(a=>staged?.assets?.filter(b=>b.name===a.name&&b.size===a.size&&b.digest===a.digest).length===1))
   throw Error('Runtime component upload failed verification');
  if(existing.draft)gh('release','edit',tag,'--draft=false','--prerelease','--latest=false');
  // A public immutable asset and its GitHub digest must exist before Desktop points at it.
  const published=checkedRelease(await api('releases/tags/'+tag),tag,existing.id);
  const verified=published?.assets?.filter(a=>a.name===c.file)??[];
  if(published?.draft!==false||verified.length!==1||verified[0].size!==c.bytes||verified[0].digest!==`sha256:${c.sha256}`)
   throw Error('Runtime component publication failed verification');
  result.push(c);
 }
 return result;
}
