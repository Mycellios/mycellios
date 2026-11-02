/** Hidden, account-free native browser qualification; never opens the installed profile. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { app, BrowserWindow, webContents } from "electron";
import { installProjectBrowser } from "../src/project-browser.js";

const output = process.env.MYCELLIOS_BROWSER_FIXTURE_OUTPUT!;
app.setPath("userData", path.join(output, "fixture-profile"));
app.commandLine.appendSwitch("disable-gpu");
async function until<T>(read: () => Promise<T>, accepts: (value: T) => boolean, label: string) {
  const end = Date.now() + 20_000;
  while (Date.now() < end) { const value = await read(); if (accepts(value)) return value; await pause(75); }
  throw new Error(`Timed out: ${label}`);
}
void app.whenReady().then(async () => {
const win = new BrowserWindow({ show: false, width: 1300, height: 900, webPreferences: {
  preload: path.join(import.meta.dirname, "preload.cjs"), sandbox: true, contextIsolation: true,
  nodeIntegration: false, backgroundThrottling: false,
} });
let scope = "fixture-space:chat-one";
const browser = installProjectBrowser({
  getWindow: () => win,
  authorize: event => event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame,
  scope: async () => scope,
});
const trace: unknown[] = [];
try {
  await win.loadURL(process.env.MYCELLIOS_BROWSER_FIXTURE_OWNER!);
  await win.webContents.executeJavaScript("window.__changes=[];window.rakazoDesktop.preview.onChanged(state=>window.__changes.push(state));void 0;");
  await win.webContents.session.cookies.set({ url:process.env.MYCELLIOS_BROWSER_FIXTURE_OWNER!, name:"fixture-owner-cookie", value:"fixture-only" });
  const target = process.env.MYCELLIOS_BROWSER_FIXTURE_URL!;
  await win.webContents.executeJavaScript(`window.rakazoDesktop.preview.show(${JSON.stringify({id:"page",url:target,bounds:{x:650,y:110,width:600,height:650}})})`);
  const page = await until(async () => webContents.getAllWebContents().find(wc => wc !== win.webContents && wc.getURL().startsWith(target)), value => Boolean(value), "native page");
  assert(page);
  page.on("ipc-message",(event,channel,...args)=>trace.push({channel,main:event.senderFrame===page.mainFrame,args}));
  page.on("console-message",details=>trace.push({console:details.message}));
  await until(async () => page.executeJavaScript("!!document.getElementById('target')"), Boolean, "project DOM");
  assert.equal(await page.executeJavaScript("typeof window.rakazoDesktop"),"undefined");
  assert.equal((await page.session.cookies.get({url:target})).length,0,"Application cookie must not reach project");
  await win.webContents.executeJavaScript("window.rakazoDesktop.preview.command({id:'page',action:'select',enabled:true})");
  await page.executeJavaScript("document.getElementById('target').click()");
  await pause(100);
  assert.equal(await win.webContents.executeJavaScript("window.__changes.some(state=>state.selection)"),false,"Synthetic page events must not trigger capture");
  const point = await page.executeJavaScript("(()=>{const r=document.getElementById('target').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()");
  trace.push({point,hit:await page.executeJavaScript(`({target:document.elementFromPoint(${point.x},${point.y})?.id,visibility:document.visibilityState,width:innerWidth,height:innerHeight})`)});
  // Windows does not dispatch native-widget mouse events to a never-shown HWND.
  // Show without activation; inputs below target only this fixture's Chromium page.
  win.showInactive();
  page.debugger.attach("1.3");
  await page.debugger.sendCommand("Emulation.setFocusEmulationEnabled", {enabled:true});
  await page.debugger.sendCommand("Input.dispatchMouseEvent", {type:"mouseMoved",...point});
  await page.debugger.sendCommand("Input.dispatchMouseEvent", {type:"mousePressed",button:"left",clickCount:1,...point});
  await page.debugger.sendCommand("Input.dispatchMouseEvent", {type:"mouseReleased",button:"left",clickCount:1,...point});
  page.debugger.detach();
  const selection = await until(async () => win.webContents.executeJavaScript("window.__changes.findLast(state=>state.selection)?.selection"), Boolean,"trusted selection and screenshot");
  assert.equal(selection.selector,"button#target");
  assert.equal(selection.text,"Review this button");
  assert.match(selection.screenshot,/^data:image\/png;base64,/);
  const png = Buffer.from(selection.screenshot.split(",")[1],"base64");
  assert(png.length>100);
  await writeFile(path.join(output,"selected-element.png"),png);
  await page.executeJavaScript(`(() => {
    const dialog=document.createElement("dialog"),frame=document.createElement("iframe");
    frame.id="framed";frame.title="Embedded project";
    frame.srcdoc="<button id='inside' onclick='parent.__frameClicks=(parent.__frameClicks||0)+1'>Do not activate</button>";
    dialog.append(frame);document.body.append(dialog);dialog.showModal();
  })()`);
  await until(async()=>page.executeJavaScript("!!document.getElementById('framed').contentDocument?.getElementById('inside')"),Boolean,"framed project");
  await win.webContents.executeJavaScript("window.__changes=[];window.rakazoDesktop.preview.command({id:'page',action:'select',enabled:true})");
  const framedPoint=await page.executeJavaScript("(()=>{const r=document.getElementById('framed').getBoundingClientRect();return{x:Math.round(r.x+25),y:Math.round(r.y+20)}})()");
  page.debugger.attach("1.3");
  await page.debugger.sendCommand("Input.dispatchMouseEvent",{type:"mousePressed",button:"left",clickCount:1,...framedPoint});
  await page.debugger.sendCommand("Input.dispatchMouseEvent",{type:"mouseReleased",button:"left",clickCount:1,...framedPoint});
  page.debugger.detach();
  const framedSelection=await until(async()=>win.webContents.executeJavaScript("window.__changes.findLast(state=>state.selection)?.selection"),Boolean,"iframe container selection");
  assert.equal(framedSelection.selector,"iframe#framed");
  assert.equal(await page.executeJavaScript("window.__frameClicks||0"),0,"Selecting framed content must not click through");
  await page.executeJavaScript("document.querySelector('dialog').close()");
  win.hide();
  const nonce = await page.executeJavaScript("window.__documentNonce");
  await page.executeJavaScript("document.getElementById('work').value='preserved while editing'");
  await win.webContents.session.cookies.set({url:process.env.MYCELLIOS_BROWSER_FIXTURE_OWNER!,name:"fixture-owner-cookie",value:"refreshed-fixture"});
  await pause(50);
  assert.equal(page.isDestroyed(),false,"Routine owner cookie refresh must preserve the project");
  const css = process.env.MYCELLIOS_BROWSER_FIXTURE_CSS!;
  const original = await readFile(css,"utf8");
  try {
    await writeFile(css,original+"\n#target { padding-left: 48px; }\n");
    await until(async()=>page.executeJavaScript("getComputedStyle(document.getElementById('target')).paddingLeft"),value=>value==="48px","Vite CSS hot reload");
    assert.equal(await page.executeJavaScript("window.__documentNonce"),nonce);
    assert.equal(await page.executeJavaScript("document.getElementById('work').value"),"preserved while editing");
  } finally { await writeFile(css,original); }
  await win.webContents.executeJavaScript(`window.rakazoDesktop.preview.show(${JSON.stringify({id:"page",url:target+"next",bounds:{x:650,y:110,width:600,height:650}})})`);
  await until(async()=>page.getURL(),value=>value.endsWith("/next"),"navigation");
  await until(async()=>page.isLoading(),value=>!value,"navigation load");
  await win.webContents.executeJavaScript("window.rakazoDesktop.preview.command({id:'page',action:'back'})");
  await until(async()=>page.getURL(),value=>value===target,"history back");
  const oldId = page.id;
  scope="fixture-space:chat-two";
  await win.webContents.executeJavaScript(`window.rakazoDesktop.preview.show(${JSON.stringify({id:"other",url:target,bounds:{x:650,y:110,width:600,height:650}})})`);
  await until(async()=>webContents.getAllWebContents().some(wc=>wc.id===oldId),value=>!value,"old chat closed");
  await writeFile(path.join(output,"native-proof.json"),JSON.stringify({passed:true,nativeBrowser:true,isolatedSession:true,noAppBridge:true,trustedSelection:true,frameContainerSelection:true,noFrameClickThrough:true,routineCookiePreserved:true,screenshotBytes:png.length,hotReloadWithoutDocumentReload:true,history:true,chatIsolation:true,realAccount:false},null,2));
  browser.dispose(); win.destroy(); app.exit(0);
} catch(error) {
  const changes = await win.webContents.executeJavaScript("window.__changes").catch(()=>[]);
  await writeFile(path.join(output,"native-proof.json"),JSON.stringify({passed:false,error:String(error),stack:error instanceof Error ? error.stack : undefined,trace,changes},null,2));
  browser.dispose(); win.destroy(); app.exit(1);
}
});
