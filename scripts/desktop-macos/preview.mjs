import {createServer}from'node:http';import fs from'node:fs/promises';import path from'node:path';
const root=path.resolve('build/desktop-downloads/web');
const server=createServer(async(req,res)=>{try{
 const u=new URL(req.url,'http://127.0.0.1');
 if(u.pathname==='/public/v1/desktop-downloads'){
  const c=await(await fetch('https://www.mycellios.com/public/v1/desktop-downloads')).json();
  // Explicit UI-only fixture until the real package qualifies. Never deployed.
  if(!c.packages.some(p=>p.id==='macos-arm64'))c.packages.push({id:'macos-arm64',format:'DMG',fileName:'fixture.dmg',path:'/downloads/desktop/releases/0.3.9/fixture.dmg',bytes:1,sha256:'f'.repeat(64)});
  res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(c));
 }
 if(u.pathname.startsWith('/assets/fonts/')){const r=await fetch('https://www.mycellios.com'+u.pathname);res.setHeader('Content-Type','font/woff2');return res.end(Buffer.from(await r.arrayBuffer()));}
 const rel=u.pathname==='/downloads/desktop'?'desktop-downloads.html':u.pathname.replace(/^\/downloads\/desktop\//,'');
 const file=path.resolve(root,rel);if(!file.startsWith(root+path.sep))throw Error('path');
 const mime=file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html';res.setHeader('Content-Type',mime);res.end(await fs.readFile(file));
}catch{res.statusCode=404;res.end();}});server.listen(5199,'127.0.0.1',()=>console.log('Mac downloads preview: http://127.0.0.1:5199/downloads/desktop'));
