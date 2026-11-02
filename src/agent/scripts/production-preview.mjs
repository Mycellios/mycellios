// Explicit, loopback-only UI preview. No database connection or worker runs here.
import http from 'node:http';
import https from 'node:https';
import { pathToFileURL } from 'node:url';
import {localSignIn,registerAuthorization} from './production-preview-login.mjs';

const production = 'https://www.mycellios.com';
export function upstreamPath(path) {
  if (/^\/(api|rpc|auth\/v1)(\/|\?|$)/.test(path)) return '/agent' + path;
  return path;
}
export function localUrl(value, origin) {
  if (typeof value !== 'string') return value;
  if (value.startsWith(production + '/')) {
    const url = new URL(value);
    const pathname = url.pathname.replace(/^\/agent(?=\/|$)/, '') || '/';
    return origin + pathname + url.search + url.hash;
  }
  return value;
}
export function rewriteJson(value, convert) {
  if (typeof value === 'string') return convert(value);
  if (Array.isArray(value)) return value.map(v => rewriteJson(v, convert));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,rewriteJson(v,convert)]));
  return value;
}
export function cookieForLocal(cookie) {
  return cookie.replace(/;\s*Domain=[^;]+/ig, '').replace(/;\s*Path=\/agent(\/[^;]*)?(?=;|$)/ig, (_match,suffix) => '; Path='+(suffix||'/'));
}
export function translateResponse(status,contentType,path) {
  // OAuth callbacks can carry application/json on an empty redirect response.
  // Parsing those as JSON would discard both Location and the session cookies.
  return status>=200 && status<300 && status!==204 && contentType?.includes('application/json') && !path.startsWith('/rpc');
}
export function isPreviewUiPath(path, development=false) {
  return /^\/(?:$|\?|app(?:\/|\?|$)|sign-in(?:\?|$)|sign-up(?:\?|$)|onboarding(?:\/|\?|$)|assets\/|mycellios\/|favicon|manifest|sw\.js|registerSW|workbox-)/.test(path) ||
    (development && /^\/(?:@vite\/|@react-refresh(?:\?|$)|@id\/|@fs\/|src\/|node_modules\/|theme\.js(?:\?|$)|html-viewer\.html(?:\?|$)|preview-bridge\.js(?:\?|$))/.test(path));
}
export function createPreview({port=5191, hostname='localhost', preview='http://127.0.0.1:5187', development=false}={}) {
  if (development && !/^http:\/\/(?:127\.0\.0\.1|localhost):\d+\/$/.test(new URL(preview).href)) throw new Error('Development UI must be loopback-only');
  const origin = `http://${hostname}:${port}`;
  const server = http.createServer(async (req,res) => {
    // Reject DNS rebinding and cross-site requests before translating origins.
    if (req.headers.host !== `${hostname}:${port}` ||
        (req.headers.origin && req.headers.origin !== origin) ||
        req.headers['sec-fetch-site'] === 'cross-site') {
      console.warn('Rejected local request', JSON.stringify({host:req.headers.host,origin:req.headers.origin,site:req.headers['sec-fetch-site'],expected:origin}));
      res.writeHead(403); res.end('Local preview origin required'); return;
    }
    if (!req.url?.startsWith('/') || req.url.startsWith('//')) {res.writeHead(400);res.end();return;}
    if(await localSignIn(req,res,origin))return;
    if (req.url === '/__preview/status') {
      res.setHeader('content-type','application/json');
      res.end(JSON.stringify({api:production+'/agent',databaseConnection:false,workers:false,realAccountData:true,hotReload:development}));return;
    }
    const ui = isPreviewUiPath(req.url,development);
    if(development && ui && !['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end('Development assets are read-only');return;}
    const target = new URL(ui ? preview : production);
    const headers = {...req.headers,host:target.host,'accept-encoding':'identity'};
    delete headers.connection; delete headers['content-length'];
    delete headers['x-forwarded-host']; delete headers['x-forwarded-for']; delete headers['x-forwarded-proto'];
    if (!ui) {
      if (headers.origin) headers.origin=production;
      if (headers.referer?.startsWith(origin+'/')) headers.referer=production+'/agent/';
    } else {delete headers.cookie; delete headers.authorization;}
    let body;
    try {
      if (!['GET','HEAD'].includes(req.method)) {
        const chunks=[];let size=0;
        for await (const chunk of req) {size+=chunk.length;if(size>16*1024*1024)throw new Error('body limit');chunks.push(chunk);}
        body=Buffer.concat(chunks);
        if (!ui && headers['content-type']?.includes('application/json')) {
          body=Buffer.from(JSON.stringify(rewriteJson(JSON.parse(body.toString()),v=>v.startsWith(origin+'/')?production+'/agent'+v.slice(origin.length):v)));
        }
        headers['content-length']=String(body.length);
      }
    } catch {res.writeHead(400);res.end('Invalid or oversized request');return;}
    const upstream=(ui?http:https).request({hostname:target.hostname,port:target.port||undefined,path:ui?req.url:upstreamPath(req.url),method:req.method,headers},incoming=>{
      const responseHeaders={...incoming.headers};
      if(!ui && /^\/(?:agent\/)?auth\/v1\/oauth\/authorize(?:\?|$)/.test(req.url) && typeof responseHeaders.location==='string')registerAuthorization(responseHeaders.location);
      delete responseHeaders['transfer-encoding'];delete responseHeaders.connection;
      if (ui) {delete responseHeaders['set-cookie'];}
      else {
        if(responseHeaders['set-cookie']) responseHeaders['set-cookie']=responseHeaders['set-cookie'].map(cookieForLocal);
        if(responseHeaders.location) responseHeaders.location=localUrl(responseHeaders.location,origin).replace(/^\/agent(?=\/|$)/,'');
      }
      responseHeaders['cache-control']='no-store';
      if(!ui && req.url.startsWith('/api/auth/callback/')) {
        let destination;
        try{const u=new URL(responseHeaders.location,origin);destination={path:u.pathname,error:u.searchParams.get('error')};}catch{}
        console.log('OAuth callback transport',JSON.stringify({status:incoming.statusCode,destination,cookies:(responseHeaders['set-cookie']||[]).map(c=>({name:c.split('=',1)[0],path:c.match(/;\s*Path=([^;]*)/i)?.[1],secure:/;\s*Secure(?:;|$)/i.test(c)}))}));
      }
      // SSE and file downloads remain streamed. Only small JSON auth/config responses need URL translation.
      const translate=!ui && translateResponse(incoming.statusCode,incoming.headers['content-type'],req.url);
      if(translate){
        const chunks=[];let size=0;
        incoming.on('data',c=>{size+=c.length;if(size>8*1024*1024)incoming.destroy();else chunks.push(c);});
        incoming.on('end',()=>{try{const result=Buffer.from(JSON.stringify(rewriteJson(JSON.parse(Buffer.concat(chunks)),v=>localUrl(v,origin))));delete responseHeaders['content-length'];res.writeHead(incoming.statusCode,responseHeaders);res.end(result);}catch{res.writeHead(502);res.end('Invalid upstream response');}});
      }else{res.writeHead(incoming.statusCode,responseHeaders);incoming.pipe(res);}
      incoming.on('error',()=>res.destroy());
    });
    upstream.setTimeout(120000,()=>upstream.destroy());
    upstream.on('error',()=>{if(!res.headersSent){res.writeHead(502);res.end('Preview upstream unavailable');}else res.destroy();});
    res.on('close',()=>upstream.destroy());
    upstream.end(body);
  });
  // Never forward arbitrary WebSocket targets or enable the development screen secret.
  server.on('upgrade',(_req,socket)=>socket.end('HTTP/1.1 501 Not Implemented\r\n\r\n'));
  return server;
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const port=Number(process.env.PREVIEW_PORT||5191);
  createPreview({port}).listen(port,'127.0.0.1',()=>console.log(`Local UI: http://localhost:${port}; real production API; no workers/database`));
}
