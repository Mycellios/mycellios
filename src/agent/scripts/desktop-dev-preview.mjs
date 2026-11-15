import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';

/** One inert example in a private local profile, using the normal import API.
 * Import never starts a greeting/run and never imports a model or credentials.
 */
export async function seedDevelopmentPreview({url,profile,user,cookie},fetcher=fetch) {
  const origin=new URL(url);
  if(origin.protocol!=='http:' || origin.hostname!=='127.0.0.1' || origin.pathname!=='/' ||
    user?.email!=='developer@mycellios.invalid' || typeof user.id!=='string' || !cookie)
    throw Error('Development preview requires its isolated local account.');
  const marker=path.join(profile,'preview.json');
  try {
    const previous=JSON.parse(await readFile(marker,'utf8'));
    if(previous.userId!==user.id || previous.version!==1)throw Error('The development preview identity changed.');
    return previous;
  }catch(error){if(error.code!=='ENOENT')throw error;}
  async function rpc(route,input) {
    const response=await fetcher(`${origin.origin}/rpc/${route}`,{method:'POST',redirect:'error',
      headers:{'content-type':'application/json',origin:origin.origin,cookie},body:JSON.stringify({json:input}),signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw Error('Could not prepare the development preview.');
    return (await response.json()).json;
  }
  const bootstrap=await rpc('bootstrap',{});
  if(bootstrap.me?.userId!==user.id || bootstrap.me?.billingEnabled)throw Error('Development preview cannot use a different account or live billing.');
  const hasContent=[bootstrap.bots,bootstrap.archivedBots,bootstrap.groups,bootstrap.archivedGroups].some(rows=>rows?.length) || bootstrap.spaces?.some(space=>space.hasContent);
  let botId=bootstrap.bots?.[0]?.id;
  if(!hasContent) {
    const files=[{path:'AGENTS.md',content:'# Vista de desarrollo\n\nEsta es una copia local de Mycellios. Haz los cambios desde el chat que abrió esta ventana. No se han copiado conexiones ni credenciales.\n'}];
    const plan=await rpc('bots/importPreview',{files,includeSecrets:false});
    const bot=await rpc('bots/importCreate',{files,includeSecrets:false,importKey:'mycellios-development-preview-v1',spawnKey:'mycellios-development-preview-v1',
      name:'Vista de desarrollo',description:'Copia local para ver tus cambios en vivo.',computerMode:'team',destination:{kind:'new'},
      selection:{instructions:plan.instructions.map(item=>item.id),memory:[],skills:[],model:false,mcpServers:[],routines:[],apiKeys:[]}});
    botId=bot.id;
  }
  const result={version:1,userId:user.id,botId,seeded:!hasContent};
  await writeFile(marker,JSON.stringify(result),{flag:'wx',mode:0o600});
  return result;
}
