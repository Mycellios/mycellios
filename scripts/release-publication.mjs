import path from 'node:path';

const tagPatterns={runtime:/^desktop-runtime-[a-f0-9]{64}$/,desktop:/^desktop-v\d+\.\d+\.\d+-windows-preview$/};
function allowedTag(kind,tag){
 if(!tagPatterns[kind]?.test(tag))throw Error('Invalid first-party release tag');
}

export function checkedFirstPartyRelease(kind,release,tag,id){
 allowedTag(kind,tag);
 if(!release||release.tag_name!==tag||!Number.isSafeInteger(release.id)||release.id<1||
   id!==undefined&&release.id!==id||typeof release.draft!=='boolean'||!Array.isArray(release.assets))
   throw Error('First-party release identity differs');
 return release;
}

/** Resolve owned drafts without treating an API tag 404 as proof of absence. */
export async function resolveFirstPartyRelease(kind,tag,{gh,api}){
 allowedTag(kind,tag);
 const direct=await api('releases/tags/'+tag);
 if(direct)return checkedFirstPartyRelease(kind,direct,tag);
 let output;
 try{output=gh('release','view',tag,'--repo','Mycellios/mycellios','--json','apiUrl,isDraft');}
 catch(error){
  if(/^(?:release not found|could not find release|no release found)(?:\s|$)/i.test(String(error.stderr??'').trim()))return null;
  throw error;
 }
 const view=JSON.parse(output);
 const match=/^https:\/\/api\.github\.com\/repos\/Mycellios\/mycellios\/releases\/([1-9][0-9]*)$/.exec(view?.apiUrl??'');
 const id=match?Number(match[1]):NaN;
 if(!Number.isSafeInteger(id)||typeof view.isDraft!=='boolean')throw Error('Untrusted first-party release URL');
 const release=checkedFirstPartyRelease(kind,await api('releases/'+id),tag,id);
 if(release.draft!==view.isDraft)throw Error('First-party release state changed');
 return release;
}

function checkedDesktopSource(release,tagged,tag,revision){
 if(tagged&&(tagged.ref!==`refs/tags/${tag}`||tagged.object?.type!=='commit'||tagged.object.sha!==revision))
  throw Error('Tag already names another source; preserve its original identity');
 if(release&&(!tagged||release.target_commitish!==revision))
  throw Error('Existing Desktop release has no matching exact source tag and target');
}

function missingAssets(release,artifacts){
 const missing=[];
 for(const artifact of artifacts){
  const found=release.assets.filter(value=>value.name===artifact.fileName);
  if(found.length>1||found[0]&&(found[0].digest!==`sha256:${artifact.sha256}`||found[0].size!==artifact.bytes))
   throw Error('An existing release asset has different bytes; never replace it');
  if(!found.length)missing.push(artifact.fileName);
 }
 if(!release.draft&&missing.length)throw Error('A published release is incomplete; preserve its immutable state');
 return missing;
}

/** Qualified local assets only; no builders, credentials, or model calls here. */
export async function publishInstallerAssets({out,tag,revision,artifacts,notesFile,gh,api,assertCurrentMain}){
 allowedTag('desktop',tag);
 if(!/^[a-f0-9]{40}$/.test(revision)||!Array.isArray(artifacts)||!artifacts.length||typeof assertCurrentMain!=='function')
  throw Error('Exact Desktop publication identity required');
 const names=new Set();
 for(const artifact of artifacts){
  if(typeof artifact.fileName!=='string'||!/^[A-Za-z0-9._-]{1,220}$/.test(artifact.fileName)||artifact.fileName==='.'||artifact.fileName==='..'||names.has(artifact.fileName)||
    !/^[a-f0-9]{64}$/.test(artifact.sha256)||!Number.isSafeInteger(artifact.bytes)||artifact.bytes<1||artifact.bytes>2_000_000_000)
   throw Error('Invalid qualified Desktop asset');
  names.add(artifact.fileName);
 }
 await assertCurrentMain();
 let existing=await resolveFirstPartyRelease('desktop',tag,{gh,api});
 let tagged=await api('git/ref/tags/'+tag);
 checkedDesktopSource(existing,tagged,tag,revision);
 if(!tagged){
  gh('api','repos/Mycellios/mycellios/git/refs','-f','ref=refs/tags/'+tag,'-f','sha='+revision);
  tagged=await api('git/ref/tags/'+tag);checkedDesktopSource(null,tagged,tag,revision);
  if(!tagged)throw Error('Desktop source tag was not created');
 }
 if(!existing){
  gh('release','create',tag,'--verify-tag','--target',revision,'--draft','--prerelease','--latest=false',
   '--title',`Mycellios Desktop ${tag.slice('desktop-v'.length,-'-windows-preview'.length)}`,'--notes-file',notesFile);
  existing=await resolveFirstPartyRelease('desktop',tag,{gh,api});
 }
 if(!existing)throw Error('Desktop release draft unavailable');
 checkedDesktopSource(existing,tagged,tag,revision);
 const missing=missingAssets(existing,artifacts);
 if(missing.length)gh('release','upload',tag,...missing.map(name=>path.join(out,name)));
 let staged=checkedFirstPartyRelease('desktop',await api('releases/'+existing.id),tag,existing.id);
 if(missingAssets(staged,artifacts).length)throw Error('Desktop release upload failed verification');
 await assertCurrentMain();
 // Recheck both mutable source selectors after uploading and before publication.
 tagged=await api('git/ref/tags/'+tag);checkedDesktopSource(staged,tagged,tag,revision);
 staged=checkedFirstPartyRelease('desktop',await api('releases/'+existing.id),tag,existing.id);
 checkedDesktopSource(staged,tagged,tag,revision);
 if(missingAssets(staged,artifacts).length)throw Error('Desktop release changed before publication');
 if(staged.draft)gh('release','edit',tag,'--draft=false','--prerelease','--latest=false');
 const published=checkedFirstPartyRelease('desktop',await api('releases/tags/'+tag),tag,existing.id);
 checkedDesktopSource(published,await api('git/ref/tags/'+tag),tag,revision);
 if(published.draft||missingAssets(published,artifacts).length)throw Error('Desktop release publication failed verification');
 return published;
}
