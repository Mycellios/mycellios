import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {isDesktopDownloadCatalog} from '../../src/contracts/desktop-downloads.ts';

/** Read-only URLs: the qualified publisher remains the single catalog writer. */
export function latestDownloadsServer(root) {
 return createServer(async(req,res)=>{
  try {
   if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{allow:'GET, HEAD'});res.end();return;}
   const url=new URL(req.url,'http://localhost');
   if(url.pathname==='/health'){res.writeHead(200,{'content-type':'application/json'});res.end('{"ok":true}');return;}
   const match=url.pathname.match(/^\/downloads\/desktop\/latest\/(windows-x64|macos-arm64|macos-x64|linux-x64|fedora-x64)$/);
   if(!match){res.writeHead(404);res.end();return;}
   const catalog=JSON.parse(await readFile(path.join(root,'catalog-macos-all.json'),'utf8'));
   if(!isDesktopDownloadCatalog(catalog))throw Error('Unqualified catalog');
   const pkg=[...catalog.packages,...catalog.fedora?[catalog.fedora]:[]].find(p=>p.id===match[1]);
   if(!pkg){res.writeHead(404,{'cache-control':'no-store'});res.end();return;}
   res.writeHead(302,{location:pkg.path,'cache-control':'no-store','x-content-type-options':'nosniff'});res.end();
  } catch {res.writeHead(503,{'cache-control':'no-store'});res.end();}
 });
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 const [root,port='8387']=process.argv.slice(2);if(!root)throw Error('Expected verified catalog directory');
 latestDownloadsServer(root).listen(Number(port),'0.0.0.0');
}
