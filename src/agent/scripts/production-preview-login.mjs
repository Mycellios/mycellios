// Local transport adaptation only. Production still validates OAuth state/PKCE.
const site='https://www.mycellios.com';
const callback=site+'/agent/api/auth/callback/oidc';
const identity='https://supabase-mycellios.nodecodex.io';
const scopes=new Set(['openid','email','profile']);
const pending=new Map();
const freshAuthorizations=new Map();
export function registerAuthorization(value,now=Date.now()) {
  for(const [id,expires]of freshAuthorizations)if(expires<now)freshAuthorizations.delete(id);
  const url=new URL(value,site);
  const id=url.searchParams.get('authorization_id');
  if(url.origin!==site||url.pathname!=='/oauth/consent'||!id||!/^[a-z0-9_-]{16,256}$/i.test(id))return false;
  if(freshAuthorizations.size>=32)return false;
  freshAuthorizations.set(id,now+5*60_000);return true;
}
export function authorizationFresh(id,now=Date.now()) {
  return (freshAuthorizations.get(id)||0)>now;
}
export function validateAuthorization(details,clients,id) {
  return details?.authorization_id===id && details.redirect_uri===callback &&
    typeof details.scope==='string' && details.scope.split(/\s+/).includes('openid') &&
    details.scope.split(/\s+/).every(s=>scopes.has(s)) &&
    clients.some(c=>c.clientId===details.client?.id && c.redirectUri===callback);
}
export function callbackForPreview(value,origin) {
  const url=new URL(value);
  if(url.origin+url.pathname!==callback || url.username || url.password || url.hash)throw new Error('Unexpected callback');
  return origin+'/api/auth/callback/oidc'+url.search;
}
export function resolvedAuthorization(details,clients,id,origin) {
  // Supabase returns a callback directly when this account has already consented.
  // That GET consumes the pending authorization; never fetch it a second time.
  if(typeof details?.redirect_url==='string')return callbackForPreview(details.redirect_url,origin);
  if(!validateAuthorization(details,clients,id)){const e=new Error('Authorization mismatch');e.code='authorization_mismatch';throw e;}
  return null;
}
async function getJson(url,options={}) {
  const response=await fetch(url,{...options,redirect:'error',signal:AbortSignal.timeout(15000)});
  const text=await response.text();
  if(!response.ok || text.length>256*1024){
    const error=new Error('Sign-in unavailable');error.status=response.status;
    try{const body=JSON.parse(text);const code=body.error_code||body.code; if(typeof code==='string'&&/^[a-z0-9_]{1,64}$/i.test(code))error.code=code;}catch{}
    throw error;
  }
  return JSON.parse(text);
}
async function publicSettings() {
  const config=await getJson(site+'/public/v1/auth-config');
  if(!config.enabled || config.url!==identity || typeof config.anonKey!=='string')throw new Error('Identity configuration changed');
  const html=await (await fetch(site+'/oauth/consent',{signal:AbortSignal.timeout(10000)})).text();
  const script=html.match(/src="(\/oauth\/consent-assets\/login-[\w-]+\.js)"/);
  if(!script)throw new Error('Sign-in configuration unavailable');
  const code=await (await fetch(site+script[1],{signal:AbortSignal.timeout(10000)})).text();
  const clientPath=code.match(/\/oauth\/consent-assets\/clients-[a-f0-9]{16}\.json/);
  if(!clientPath)throw new Error('Sign-in configuration unavailable');
  const clients=await getJson(site+clientPath[0]);
  if(!Array.isArray(clients)||clients.length>8)throw new Error('Invalid client configuration');
  return {config,clients,stylesheet:html.match(/href="(\/oauth\/consent-assets\/login-[\w-]+\.css)"/)?.[1]};
}
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function localSignIn(req,res,origin) {
  const parsed=new URL(req.url,origin);
  if(parsed.pathname!=='/oauth/consent')return false;
  const id=parsed.searchParams.get('authorization_id');
  if(!id || !/^[a-z0-9_-]{16,256}$/i.test(id)){res.writeHead(400);res.end('Open local sign-in again.');return true;}
  res.setHeader('cache-control','no-store');
  // A bookmarked/back-navigation form must never replay a consumed OAuth request.
  if(!authorizationFresh(id)){req.resume();res.writeHead(303,{location:'/sign-in'});res.end();return true;}
  // no-referrer makes Chromium send Origin:null for HTML form POSTs.
  // Preserve the same-origin POST signal required by the loopback CSRF guard.
  res.setHeader('referrer-policy','same-origin');
  res.setHeader('content-security-policy',"default-src 'none'; style-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
  try {
    const {config,clients,stylesheet}=await publicSettings();
    let error='';
    let stage='identity';
    for(const [key,value]of pending)if(value.expires<Date.now())pending.delete(key);
    if(req.method==='POST') {
      const chunks=[];let size=0;
      for await(const chunk of req){size+=chunk.length;if(size>8192)throw new Error('Oversized sign-in');chunks.push(chunk);}
      const form=new URLSearchParams(Buffer.concat(chunks).toString());
      try {
        let token=pending.get(id)?.token;
        if(!token){
          const auth=await getJson(identity+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:config.anonKey,'content-type':'application/json'},body:JSON.stringify({email:form.get('email'),password:form.get('password')})});
          if(typeof auth.access_token!=='string'||auth.user?.email?.toLowerCase()!==form.get('email')?.toLowerCase())throw new Error('Identity mismatch');
          if(auth.user?.factors?.some(f=>f.status==='verified')){const e=new Error('MFA required');e.code='mfa_required';throw e;}
          token=auth.access_token;
          if(pending.size<8)pending.set(id,{token,expires:Date.now()+120000});
        }
        const headers={apikey:config.anonKey,authorization:'Bearer '+token,'content-type':'application/json'};
        const endpoint=site+'/agent/auth/v1/oauth/authorizations/'+id;
        stage='authorization';
        const details=await getJson(endpoint,{headers});
        const automatic=resolvedAuthorization(details,clients,id,origin);
        if(automatic){pending.delete(id);freshAuthorizations.delete(id);res.writeHead(303,{location:automatic});res.end();return true;}
        stage='consent';
        const approved=await getJson(endpoint+'/consent',{method:'POST',headers,body:JSON.stringify({action:'approve'})});
        stage='callback';
        const location=callbackForPreview(approved.redirect_url,origin);
        pending.delete(id);
        freshAuthorizations.delete(id);
        res.writeHead(303,{location});res.end();return true;
      }catch(e){console.warn('Preview sign-in failed',JSON.stringify({stage,status:e.status,code:e.code||'unexpected'}));if(stage==='authorization'&&[400,404].includes(e.status)){pending.delete(id);freshAuthorizations.delete(id);res.writeHead(303,{location:'/sign-in'});res.end();return true;}error=stage==='identity'?'Mycellios could not authenticate this sign-in. Please use your normal account credentials.':'Your identity was verified, but the connection could not finish. Retry sign-in below.';}
    } else if(req.method!=='GET'){res.writeHead(405);res.end();return true;}
    res.setHeader('content-type','text/html; charset=utf-8');
    res.end(`<!doctype html><html lang="en" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mycellios — local preview</title>${stylesheet?`<link rel="stylesheet" href="${escape(stylesheet)}">`:''}</head><body><main class="oauth-consent"><section><a class="login-brand" href="/">Mycellios</a><h1>Sign in</h1><p>Local preview · your real Mycellios account and agents.</p>${error?`<p role="alert">${escape(error)}</p>`:''}<form method="post">${pending.has(id)?'':`<label>Email<input name="email" type="email" autocomplete="username" required></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label>`}<button class="login-button" type="submit">${pending.has(id)?'Retry sign-in':'Continue with Mycellios'}</button></form><p>Changes made here affect your real account. No development workers or database connection are started.</p></section></main></body></html>`);
  }catch {res.writeHead(502);res.end('Mycellios sign-in is temporarily unavailable. Open local sign-in again.');}
  return true;
}
