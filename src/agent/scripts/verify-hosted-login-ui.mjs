import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import http from 'node:http';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';

const agent=fileURLToPath(new URL('../',import.meta.url));
const output=path.resolve(process.argv[2] || 'hosted-login-proof');
const bundle=path.join(output,'bundle');
await mkdir(output,{recursive:true});
execFileSync(process.execPath,[path.join(agent,'apps/web/src/hosted-login/build.cjs')],{
  cwd:agent,stdio:'inherit',env:{...process.env,LOGIN_OUT_DIR:bundle,FIRST_PARTY_CLIENTS_PATH:'/oauth/consent-assets/clients-0000000000000000.json'},
});
const build=JSON.parse(await readFile(path.join(bundle,'build.json'),'utf8'));
const mime={'.js':'application/javascript','.css':'text/css','.woff2':'font/woff2'};
const server=http.createServer(async(req,res)=>{
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);return res.end();}
  const url=new URL(req.url,'http://127.0.0.1');
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  if(url.pathname==='/public/v1/auth-config'){
    res.setHeader('Content-Type','application/json');
    return res.end(JSON.stringify({enabled:true,providers:{email:true,google:false,twitter:false}}));
  }
  if(url.pathname==='/oauth/consent-assets/clients-0000000000000000.json'){
    res.setHeader('Content-Type','application/json');return res.end('[]');
  }
  if(url.pathname==='/favicon.ico'){res.writeHead(204);return res.end();}
  if(url.pathname==='/oauth/consent'){
    res.setHeader('Content-Type','text/html');
    return res.end('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mycellios synthetic login proof</title><link rel="stylesheet" href="/oauth/consent-assets/'+build.files.find(f=>f.endsWith('.css'))+'"><div id="root"></div><script type="module" src="/oauth/consent-assets/'+build.files.find(f=>f.endsWith('.js'))+'"></script></html>');
  }
  const name=path.basename(url.pathname);
  if(url.pathname==='/oauth/consent-assets/'+name && build.files.includes(name)){
    res.setHeader('Content-Type',mime[path.extname(name)]||'application/octet-stream');
    return res.end(await readFile(path.join(bundle,name)));
  }
  res.writeHead(404);res.end();
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try {
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage();
  const errors=[],external=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(/^https?:/.test(request.url())&&!request.url().startsWith('http://127.0.0.1:'))external.push(request.url());});
  await page.goto('http://127.0.0.1:'+server.address().port+'/oauth/consent?authorization_id=fixture-authorization-12345');
  await page.getByRole('heading',{name:'Sign in',exact:true}).waitFor();
  await page.evaluate(()=>document.fonts.ready);
  for(const [name,width,height] of [['desktop',1280,720],['reference-620',620,540],['mobile',390,844]]){
    await page.setViewportSize({width,height});
    const geometry=await page.locator('.oauth-consent > section').boundingBox();
    assert.ok(geometry&&geometry.x>=20&&geometry.x+geometry.width<=width-20);
    assert.ok(geometry.y>=0&&geometry.y+geometry.height<=height);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert.ok(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight));
    await page.screenshot({path:path.join(output,name+'.png')});
  }
  await page.getByRole('button',{name:'Create account',exact:true}).click();
  await page.getByRole('heading',{name:'Create your account',exact:true}).waitFor();
  assert.equal(new URL(page.url()).searchParams.get('authorization_id'),'fixture-authorization-12345');
  assert.equal(await page.getByLabel('Password',{exact:true}).getAttribute('autocomplete'),'new-password');
  await page.screenshot({path:path.join(output,'registration-mobile.png')});
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.getByLabel('Email address',{exact:true}).focus();
  await page.keyboard.press('Tab');
  assert.ok(await page.getByLabel('Password',{exact:true}).evaluate(node=>node===document.activeElement));
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  await writeFile(path.join(output,'receipt.json'),JSON.stringify({ok:true,synthetic:true,productionCredentials:false,standaloneBundle:true,screenshots:['desktop','reference-620','mobile','registration-mobile'],registrationRetainsAuthorization:true,pageErrors:errors,externalRequests:external},null,2));
} finally {
  await browser?.close();
  await new Promise(resolve=>server.close(resolve));
}
