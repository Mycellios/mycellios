/** Qualify real split chunks; never connect a model, account or payment provider. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from '../src/agent/node_modules/@playwright/test/index.mjs';

const root=path.resolve('landing-dist');
const version='0.0.1',sha256='a'.repeat(64);
const file=(id,format,extension)=>({id,format,version,fileName:`Mycellios-${id}.${extension}`,path:`/downloads/desktop/releases/${version}/Mycellios-${id}.${extension}`,bytes:100,sha256});
const catalog={schema:'mycellios-desktop-downloads/1',version,runtimeVersion:version,channel:'preview',automaticUpdates:false,
  packages:[file('windows-x64','EXE','exe'),file('linux-x64','DEB','deb'),file('macos-arm64','DMG','dmg'),file('macos-x64','DMG','dmg')],
  source:{path:`/downloads/desktop/releases/${version}/source.tar.gz`,sha256},
  fedora:{...file('fedora-x64','RPM','rpm'),source:{path:`/downloads/desktop/releases/${version}/source.tar.gz`,sha256}}};
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2'};
const server=createServer(async(req,res)=>{
  try{
    assert.equal(req.method,'GET');const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/public/v1/desktop-downloads'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(catalog));return;}
    const target=path.resolve(root,'.'+decodeURIComponent(url.pathname));
    assert(target===root||target.startsWith(root+path.sep));
    const file=(await stat(target)).isDirectory()?path.join(target,'index.html'):target;
    res.setHeader('Content-Type',types[path.extname(file)]??'application/octet-stream');res.setHeader('Cache-Control','no-store');res.end(await readFile(file));
  }catch{res.statusCode=404;res.end('Fixture resource unavailable');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
let browser;
try{
  browser=await chromium.launch({headless:true});
  for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
    const context=await browser.newContext({viewport,reducedMotion:'reduce'});
    await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(origin,{waitUntil:'networkidle'});
    await page.getByRole('heading',{name:'Meet Mycellios',exact:true}).waitFor();
    await page.locator('#mycellios-loader').waitFor({state:'detached'});
    assert.equal(await page.locator('.distributed-earn-node').count(),49);
    await page.getByRole('button',{name:'Choose a download platform',exact:true}).click();
    const menu=page.locator('#agent-download-platforms');await menu.waitFor();
    for(const [name,id] of [['Windows','windows-x64'],['Mac · Apple Silicon','macos-arm64'],['Mac · Intel','macos-x64'],['Linux','linux-x64'],['Fedora','fedora-x64']]){
      const link=menu.getByRole('link',{name:new RegExp('^'+name)});
      assert.equal(await link.count(),1,name);assert.equal(await link.locator('svg').count(),2,name);
      assert.equal(await link.getAttribute('href'),`/downloads/desktop/latest/${id}`,'An already open page must resolve the newest verified installer');
      assert.equal(await link.getAttribute('download'),null,'Do not pin an old filename across a release');
    }
    await page.keyboard.press('Escape');await menu.waitFor({state:'detached'});
    await page.waitForLoadState('networkidle');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'Horizontal overflow');
    assert.deepEqual(errors,[],'Compiled landing raised a browser error');
    await context.close();
  }
  console.log(JSON.stringify({passed:true,compiledChunks:true,desktopAndMobile:true,platformPicker:true,externalRequestsBlocked:true,modelsCalled:0}));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
