import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {devIdentityEnvironment,isDevIdentityCallback,DEV_OIDC_CLIENT,DEV_OIDC_CALLBACK} from './project-local-sso.mjs';
describe('dedicated local Mycellios account',()=>{
 const fixture=()=>({client_id:DEV_OIDC_CLIENT,client_secret:'test-only-not-a-real-credential-12345',redirect_uris:[DEV_OIDC_CALLBACK]});
 it('uses only the dedicated local client with the real issuer',()=>{const env=devIdentityEnvironment(fixture());assert.equal(env.MYCELLIOS_SSO_ENABLED,'true');assert.equal(env.OIDC_ISSUER,'https://www.mycellios.com/agent/auth/v1');assert.equal(env.OIDC_CLIENT_ID,DEV_OIDC_CLIENT);});
 it('rejects a production client, wrong callback, or missing secret',()=>{for(const value of [{...fixture(),client_id:'production'},{...fixture(),redirect_uris:['https://www.mycellios.com/agent/api/auth/callback/oidc']},{...fixture(),client_secret:''}])assert.throws(()=>devIdentityEnvironment(value),/Invalid dedicated/);});
 it('forwards only GET requests to the exact registered local callback',()=>{
  assert.equal(isDevIdentityCallback('GET','127.0.0.1:5188','/api/auth/callback/oidc?code=opaque&state=opaque'),true);
  for(const [method,host,url]of [['POST','127.0.0.1:5188','/api/auth/callback/oidc'],['GET','attacker.example','/api/auth/callback/oidc'],['GET','127.0.0.1:5188','https://evil.example/api/auth/callback/oidc'],['GET','127.0.0.1:5188','//evil.example/api/auth/callback/oidc'],['GET','127.0.0.1:5188','/api/auth/get-session']])assert.equal(isDevIdentityCallback(method,host,url),false);
 });
});
