import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPreview,isPreviewUiPath,upstreamPath,localUrl,rewriteJson,cookieForLocal,translateResponse} from './production-preview.mjs';
import {validateAuthorization,callbackForPreview,resolvedAuthorization,registerAuthorization,authorizationFresh} from './production-preview-login.mjs';

test('development modules stay local without rerouting account endpoints or enabling remote targets',()=>{
 for(const path of ['/@vite/client','/@react-refresh','/@fs/C:/repo/file.ts','/@id/react','/src/main.tsx','/node_modules/.vite/deps/react.js','/theme.js','/html-viewer.html','/preview-bridge.js']) {
  assert.equal(isPreviewUiPath(path,true),true);
  assert.equal(isPreviewUiPath(path,false),false);
 }
 for(const path of ['/rpc/models','/api/auth/get-session','/oauth/consent','/auth/v1/token','/api/computers/screen']) assert.equal(isPreviewUiPath(path,true),false);
 assert.throws(()=>createPreview({development:true,preview:'https://evil.test'}));
});
test('routes only fixed Mycellios namespace and preserves OAuth query',()=>{
 assert.equal(upstreamPath('/api/auth/get-session'),'/agent/api/auth/get-session');
 assert.equal(upstreamPath('/oauth/consent?id=a'),'/oauth/consent?id=a');
 const query='?redirect_uri=https%3A%2F%2Fwww.mycellios.com%2Fagent%2Fapi%2Fauth%2Fcallback%2Foidc';
 assert.equal(localUrl('https://www.mycellios.com/agent/auth/v1/authorize'+query,'http://127.0.0.1:5188'),'http://127.0.0.1:5188/auth/v1/authorize'+query);
 assert.equal(localUrl('https://evil.test/agent','http://127.0.0.1:5188'),'https://evil.test/agent');
});
test('stale or bookmarked consent pages cannot reuse an authorization',()=>{
 const id='test-authorization-only-123456';
 assert.equal(authorizationFresh(id,1000),false);
 assert.equal(registerAuthorization('https://evil.test/oauth/consent?authorization_id='+id,1000),false);
 assert.equal(registerAuthorization('https://www.mycellios.com/oauth/consent?authorization_id='+id,1000),true);
 assert.equal(authorizationFresh(id,1001),true);
 assert.equal(authorizationFresh(id,301001),false);
});
test('empty OAuth redirects preserve their cookies and location instead of entering JSON parsing',()=>{
 for(const status of [302,303,307,204])assert.equal(!!translateResponse(status,'application/json','/api/auth/callback/oidc'),false);
 assert.equal(!!translateResponse(200,'application/json','/api/auth/get-session'),true);
 assert.equal(!!translateResponse(200,'text/event-stream','/rpc/subscribe'),false);
});
test('previously approved accounts finish directly without consuming authorization twice',()=>{
 const origin='http://localhost:5191';
 const callback='https://www.mycellios.com/agent/api/auth/callback/oidc';
 assert.equal(resolvedAuthorization({redirect_url:callback+'?code=example&state=state'},[],'id',origin),origin+'/api/auth/callback/oidc?code=example&state=state');
 assert.throws(()=>resolvedAuthorization({redirect_url:'https://evil.test/callback?code=example'},[],'id',origin));
 assert.throws(()=>resolvedAuthorization({},[],'id',origin));
 const clients=[{clientId:'real-client',redirectUri:callback}];
 assert.equal(resolvedAuthorization({authorization_id:'id',client:{id:'real-client'},scope:'openid profile',redirect_uri:callback},clients,'id',origin),null);
});
test('JSON URLs only; cookie flags retained',()=>{
 assert.deepEqual(rewriteJson({url:'https://www.mycellios.com/agent/app',amount:2},v=>localUrl(v,'http://127.0.0.1:5188')),{url:'http://127.0.0.1:5188/app',amount:2});
 assert.equal(cookieForLocal('session=x; Domain=www.mycellios.com; Path=/agent/; Secure; HttpOnly; SameSite=Lax'),'session=x; Path=/; Secure; HttpOnly; SameSite=Lax');
 assert.equal(cookieForLocal('session=x; Path=/agent; HttpOnly'),'session=x; Path=/; HttpOnly');
});
test('rejects non-loopback hosts and foreign origins before any upstream request',async()=>{
 const server=createPreview({port:5190,hostname:'127.0.0.1'});await new Promise(r=>server.listen(5190,'127.0.0.1',r));
 try{
  assert.equal((await fetch('http://127.0.0.1:5190/__preview/status',{headers:{origin:'https://evil.test'}})).status,403);
  const status=await (await fetch('http://127.0.0.1:5190/__preview/status')).json();
  assert.equal(status.databaseConnection,false);assert.equal(status.workers,false);
 }finally{await new Promise(r=>server.close(r));}
});
test('production identity and callback remain strictly pinned',()=>{
 const callback='https://www.mycellios.com/agent/api/auth/callback/oidc';
 const details={authorization_id:'authorization',client:{id:'real-client'},scope:'openid email profile',redirect_uri:callback};
 const clients=[{clientId:'real-client',redirectUri:callback}];
 assert.equal(validateAuthorization(details,clients,'authorization'),true);
 assert.equal(validateAuthorization({...details,scope:'openid admin'},clients,'authorization'),false);
 assert.equal(validateAuthorization({...details,client:{id:'unknown'}},clients,'authorization'),false);
 assert.equal(validateAuthorization(details,clients,'wrong'),false);
 assert.equal(validateAuthorization({...details,redirect_uri:'https://evil.test'},clients,'authorization'),false);
 assert.equal(callbackForPreview(callback+'?code=example&state=pinned','http://localhost:5191'),'http://localhost:5191/api/auth/callback/oidc?code=example&state=pinned');
 assert.throws(()=>callbackForPreview('https://evil.test/callback','http://localhost:5191'));
});
