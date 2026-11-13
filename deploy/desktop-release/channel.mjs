import {createHash,randomUUID} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdir,readFile,writeFile,rename,lstat,unlink,statfs} from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:http';
import {pathToFileURL} from 'node:url';
import {validateReleaseIndex,assetIdentity} from '../../scripts/desktop-release-index.mjs';
const repository='https://api.github.com/repos/Mycellios/mycellios';
const rootUrl='https://github.com/Mycellios/mycellios/releases/download/';
const compare=(a,b)=>{const x=a.split('.').map(Number),y=b.split('.').map(Number);return x[0]-y[0]||x[1]-y[1]||x[2]-y[2];};
async function json(url,request=fetch){const r=await request(url,{headers:{accept:'application/vnd.github+json'},signal:AbortSignal.timeout(30000)});if(!r.ok||!r.body)throw Error('Release metadata unavailable');const chunks=[];let size=0;for await(const chunk of r.body){size+=chunk.length;if(size>2_000_000)throw Error('Oversized release metadata');chunks.push(Buffer.from(chunk));}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
async function directory(dir){await mkdir(dir,{recursive:true});const info=await lstat(dir);if(!info.isDirectory()||info.isSymbolicLink())throw Error('Unsafe release directory');}
async function regular(file){const info=await lstat(file).catch(()=>null);if(info&&(!info.isFile()||info.isSymbolicLink()))throw Error('Unsafe release file');return info;}
async function atomic(file,bytes){const tmp=file+'.'+randomUUID()+'.tmp';await writeFile(tmp,bytes,{flag:'wx',mode:0o644});await rename(tmp,file);}
export async function ingestRelease(root,index,request=fetch){
 validateReleaseIndex(index);await mkdir(root,{recursive:true});if((await lstat(root)).isSymbolicLink())throw Error('Unsafe release root');
 const previous=await readFile(path.join(root,'current-desktop.json'),'utf8').then(JSON.parse).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
 if(previous&&compare(index.version,previous.version)<=0){if(index.version===previous.version&&JSON.stringify(index)!==JSON.stringify(previous))throw Error('Immutable release changed');return {changed:false,version:previous.version};}
 if(!previous){const baseline=JSON.parse(await readFile(path.join(root,'catalog-macos-all.json'),'utf8'));if(compare(index.version,baseline.version)<=0)return {changed:false,version:baseline.version};}
 await directory(path.join(root,'releases'));const dir=path.join(root,'releases',index.version);await directory(dir);
 const space=await statfs(root);const size=index.assets.reduce((n,a)=>n+a.bytes,0);if(space.bavail*space.bsize<size+512*1024*1024)throw Error('Insufficient release disk space');
 for(const a of index.assets){
  const target=path.join(dir,a.name);const existing=await regular(target);
  if(existing){const current=await assetIdentity(target);if(current.bytes!==a.bytes||current.sha256!==a.sha256)throw Error('Existing release bytes differ');continue;}
  const temp=target+'.'+randomUUID()+'.partial';
  try{const response=await request(rootUrl+index.tag+'/'+a.name,{signal:AbortSignal.timeout(300000)});if(!response.ok||!response.body)throw Error('Release asset unavailable');
   const {open}=await import('node:fs/promises');const f=await open(temp,'wx',0o644);const hash=createHash('sha256');let count=0;
   try{for await(const chunk of response.body){count+=chunk.length;if(count>a.bytes)throw Error('Oversized release asset');hash.update(chunk);await f.writeFile(chunk);}await f.sync();}finally{await f.close();}
   if(count!==a.bytes||hash.digest('hex')!==a.sha256)throw Error('Release checksum mismatch');await rename(temp,target);
  }finally{await unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
 }
 const catalogs={};for(const name of ['catalog.json','catalog-macos.json','catalog-macos-all.json']){
  const old=JSON.parse(await readFile(path.join(root,name),'utf8'));const next={...old,version:index.version,source:sourceEntry(index),automaticUpdates:false};
  next.packages=old.packages.map(p=>catalogPackage(index,index.packages.find(a=>a.id===p.id)));
  if(name==='catalog-macos-all.json'){next.fedora=catalogPackage(index,index.packages.find(p=>p.id==='fedora-x64'));next.appImage=catalogPackage(index,index.packages.find(p=>p.id==='linux-appimage-x64'));}
  catalogs[name]={before:JSON.stringify(old,null,2)+'\n',after:JSON.stringify(next,null,2)+'\n'};
 }
 // No pointer changes until every installer, feed and source archive was verified.
 await atomic(path.join(dir,'desktop-release-index.json'),JSON.stringify(index,null,2)+'\n');
 await directory(path.join(root,'channel-backups'));const backup=path.join(root,'channel-backups',index.version);await directory(backup);
 for(const [name,c] of Object.entries(catalogs))await writeFile(path.join(backup,name),c.before,{flag:'wx',mode:0o600}).catch(e=>{if(e.code!=='EEXIST')throw e;});
 try{for(const [name,c] of Object.entries(catalogs))await atomic(path.join(root,name),c.after);await atomic(path.join(root,'current-desktop.json'),JSON.stringify(index,null,2)+'\n');}
 catch(e){for(const [name,c] of Object.entries(catalogs))await atomic(path.join(root,name),c.before);throw e;}
 return {changed:true,version:index.version,revision:index.revision};
}
function sourceEntry(index){const a=index.assets.find(a=>a.name===index.source);return {path:`/downloads/desktop/releases/${index.version}/${a.name}`,sha256:a.sha256};}
function catalogPackage(index,p){if(!p)throw Error('Missing catalog platform');const a=index.assets.find(a=>a.name===p.fileName);return {id:p.id,version:index.version,format:p.format,fileName:p.fileName,path:`/downloads/desktop/releases/${index.version}/${p.fileName}?sha256=${a.sha256}`,bytes:a.bytes,sha256:a.sha256,source:sourceEntry(index),automaticUpdates:p.automaticUpdates};}
export async function synchronize(root,request=fetch){
 const releases=await json(repository+'/releases?per_page=30',request);
 const candidates=releases.filter(r=>!r.draft&&/^desktop-v\d+\.\d+\.\d+$/.test(r.tag_name)).sort((a,b)=>compare(b.tag_name.slice(9),a.tag_name.slice(9)));
 if(!candidates.length)return {changed:false,reason:'no-qualified-unified-release'};
 const release=candidates[0];const index=validateReleaseIndex(await json(rootUrl+release.tag_name+'/desktop-release-index.json',request));
 if(index.tag!==release.tag_name)throw Error('Release tag mismatch');
 const run=await json(repository+'/actions/runs/'+index.workflowRunId,request);
 if(run.status!=='completed'||run.conclusion!=='success')return {changed:false,reason:'release-workflow-not-complete'};
 if(run.head_branch!=='main'||run.head_sha!==index.revision||run.path!=='.github/workflows/desktop-release.yml'||run.head_repository?.full_name!=='Mycellios/mycellios')throw Error('Untrusted release workflow');
 return ingestRelease(root,index,request);
}
export function channelServer(root){return createServer(async(req,res)=>{
 try{if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
  const url=new URL(req.url,'http://localhost');if(url.pathname==='/health'){res.setHeader('content-type','application/json');res.end('{"ok":true}');return;}
  const current=await readFile(path.join(root,'current-desktop.json'),'utf8').then(text=>validateReleaseIndex(JSON.parse(text))).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
  const latest=url.pathname.match(/^\/downloads\/desktop\/latest\/([a-z0-9-]+)$/);
  if(latest){const catalog=current?null:JSON.parse(await readFile(path.join(root,'catalog-macos-all.json'),'utf8'));const packages=current?.packages??[...catalog.packages,catalog.fedora,catalog.appImage].filter(Boolean);const p=packages.find(p=>p.id===latest[1]);if(!p)throw Error('Unknown platform');
   const destination=current?catalogPackage(current,p).path:p.path;if(!/^\/downloads\/desktop\/releases\/\d+\.\d+\.\d+\/[A-Za-z0-9._-]+(?:\?sha256=[a-f0-9]{64})?$/.test(destination))throw Error('Invalid latest redirect');
   res.writeHead(302,{location:destination,'cache-control':'no-store'});res.end();return;}
  const feed=url.pathname.match(/^\/downloads\/desktop\/updates\/(windows|macos|linux)\/(x64|arm64)\/(latest(?:-mac|-linux|-linux-arm64)?\.yml)$/);
  if(!feed||!current||!current.feeds[feed[1]+'/'+feed[2]]?.automaticUpdates){res.writeHead(404,{'cache-control':'no-store'});res.end();return;}
  const name=current.feeds[feed[1]+'/'+feed[2]].fileName;const a=current.assets.find(a=>a.name===name);if(!a)throw Error('Missing feed');
  res.writeHead(200,{'content-type':'text/yaml','content-length':a.bytes,'cache-control':'no-store'});if(req.method==='HEAD')res.end();else createReadStream(path.join(root,'releases',current.version,name)).on('error',()=>res.destroy()).pipe(res);
 }catch{if(!res.headersSent)res.writeHead(503,{'cache-control':'no-store'});res.end();}
});}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){const [mode,root,port]=process.argv.slice(2);if(mode==='sync')console.log(JSON.stringify(await synchronize(root)));else if(mode==='serve')channelServer(root).listen(Number(port??8387),'0.0.0.0');else throw Error('Use serve|sync ROOT [PORT]');}
