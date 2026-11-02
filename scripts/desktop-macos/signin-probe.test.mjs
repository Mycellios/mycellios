import{test}from'node:test';import assert from'node:assert/strict';import{chromium}from'@playwright/test';import{waitForMycelliosSignIn}from'./signin-probe.mjs';import fs from'node:fs/promises';
test('the current public first-party flow reaches its central login form',async()=>{
 const browser=await chromium.launch({headless:true,channel:process.platform==='win32'?'msedge':undefined});
 try{const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('https://www.mycellios.com/agent/sign-in');
  try{assert.equal(await waitForMycelliosSignIn(page,45000),'central-account-form');}catch(error){
   await fs.mkdir('outputs/macos-page-qa',{recursive:true});await page.screenshot({path:'outputs/macos-page-qa/signin-diagnostic.png'});
   console.log(JSON.stringify({path:new URL(page.url()).pathname,buttons:await page.getByRole('button').allTextContents(),headings:await page.getByRole('heading').allTextContents(),errors,inputTypes:await page.locator('input').evaluateAll(nodes=>nodes.map(n=>n.type))}));throw error;
  }
  assert.equal(new URL(page.url()).pathname,'/oauth/consent');
 }finally{await browser.close();}
});
