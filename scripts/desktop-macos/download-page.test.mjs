import {test}from'node:test';import assert from'node:assert/strict';import {chromium}from'@playwright/test';import fs from'node:fs/promises';
test('download page keeps all four platforms and fits desktop/mobile',async()=>{
 await fs.mkdir('outputs/macos-page-qa',{recursive:true});const browser=await chromium.launch({headless:true,channel:process.platform==='win32'?'msedge':undefined});
 try{for(const [width,height]of[[1440,1000],[390,844]]){
  const page=await browser.newPage({viewport:{width,height}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:5199/downloads/desktop');
  for(const p of ['Windows','macOS','Linux','Fedora'])await page.getByRole('link',{name:'Download for '+p,exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(errors,[]);await page.screenshot({path:`outputs/macos-page-qa/downloads-${width}.png`,fullPage:true});await page.close();
 }}finally{await browser.close();}
});
