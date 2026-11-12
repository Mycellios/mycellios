import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { createServer, request } from 'node:http';
export const DEV_OIDC_CLIENT='6704e1e2-4e72-4f30-b148-80bdb823f6d6';
export const DEV_OIDC_CALLBACK='http://127.0.0.1:5188/api/auth/callback/oidc';
export function devIdentityEnvironment(value) {
 if(value?.client_id!==DEV_OIDC_CLIENT || typeof value.client_secret!=='string' || value.client_secret.length<24 ||
   !Array.isArray(value.redirect_uris) || value.redirect_uris.length!==1 || value.redirect_uris[0]!==DEV_OIDC_CALLBACK)
  throw new Error('Invalid dedicated local Mycellios identity');
 return {MYCELLIOS_LOCAL_ACCOUNT_ENABLED:'1',MYCELLIOS_SSO_ENABLED:'true',OIDC_ISSUER:'https://www.mycellios.com/agent/auth/v1',OIDC_CLIENT_ID:DEV_OIDC_CLIENT,OIDC_CLIENT_SECRET:value.client_secret,OIDC_NAME:'Mycellios',OIDC_SCOPES:'openid email profile'};
}
export function loadDevIdentityEnvironment() {
 if(!existsSync(new URL('../.cache/local-sso-enabled',import.meta.url)))return {};
 if(process.platform!=='win32'||!process.env.LOCALAPPDATA)throw new Error('Dedicated local Mycellios identity requires this Windows profile');
 const file=join(process.env.LOCALAPPDATA,'MycelliosDev','local-oidc.dpapi');
 try {
  const encrypted=readFileSync(file,'utf8');
  const script='$ErrorActionPreference="Stop";$cipher=[Console]::In.ReadToEnd().Trim();$s=ConvertTo-SecureString $cipher;$p=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s);try{[Console]::Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($p))}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p)}';
  const json=execFileSync('pwsh',['-NoProfile','-Command',script],{input:encrypted,encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe'],timeout:10000});
  return devIdentityEnvironment(JSON.parse(json));
 }catch{throw new Error('Could not open the dedicated local Mycellios identity');}
}
export function isDevIdentityCallback(method,host,url) {
 if(method!=='GET'||host!=='127.0.0.1:5188'||typeof url!=='string'||!url.startsWith('/')||url.startsWith('//')||url.length>8192)return false;
 try{return new URL(url,DEV_OIDC_CALLBACK).origin==='http://127.0.0.1:5188'&&new URL(url,DEV_OIDC_CALLBACK).pathname==='/api/auth/callback/oidc';}catch{return false;}
}
export async function startDevIdentityCallback() {
 const server=createServer((req,res)=>{
  res.setHeader('cache-control','no-store');res.setHeader('referrer-policy','no-referrer');
  if(!isDevIdentityCallback(req.method,req.headers.host,req.url)){res.writeHead(404);res.end();return;}
  // Only the existing registered callback, forwarded to the local auth verifier.
  // Better Auth retains state, nonce, PKCE, subject and issuer checks.
  const upstream=request({hostname:'127.0.0.1',port:3100,path:req.url,method:'GET',headers:{host:'127.0.0.1:5188',...(req.headers.cookie?{cookie:req.headers.cookie}:{})},timeout:15000},response=>{
   res.writeHead(response.statusCode??502,{...response.headers,'cache-control':'no-store','referrer-policy':'no-referrer'});response.pipe(res);
  });
  upstream.on('timeout',()=>upstream.destroy());upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end('Local sign-in is temporarily unavailable');});upstream.end();
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(5188,'127.0.0.1',resolve);});
 return server;
}
