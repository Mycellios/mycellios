import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, cp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {_electron} from '@playwright/test';

// Dedicated Windows-runner fixture only. Never attaches to an installed profile.
assert.equal(process.platform, 'win32');
const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(process.argv[2]);
const temp = await mkdtemp(path.join(tmpdir(), 'mycellios-interaction-proof-'));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let app;
let phase = 'prepare';
try {
  await mkdir(output, {recursive:true});
  await mkdir(path.join(temp, 'profile'));
  for (const name of ['companion.html', 'companion.css', 'companion.js', 'companion-preload.cjs', 'tokens.css', 'assets']) {
    await cp(path.join(desktop, 'dist', name), path.join(temp, name), {recursive:true});
  }
  const preload = path.join(temp, 'fixture.cjs');
  await writeFile(preload, `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('fixture',{
    defaults:()=>ipcRenderer.invoke('fixture.defaults'),save:value=>ipcRenderer.invoke('desktop.companions.save',value),
    publish:value=>ipcRenderer.invoke('desktop.companions.publish',value)});`);
  const entry = path.join(temp, 'fixture.mjs');
  const source = `
    import {app,BrowserWindow,ipcMain} from 'electron';
    import {DEFAULT_DESKTOP_COMPANIONS} from '@rakazo/contracts';
    import {installDesktopCompanions} from ${JSON.stringify(path.join(desktop,'src/desktop-companions.ts'))};
    import {browserWindowOptions} from ${JSON.stringify(path.join(desktop,'src/window-options.ts'))};
    app.setPath('userData',${JSON.stringify(path.join(temp,'profile'))});
    async function qualify() {
    await app.whenReady();
    const main=new BrowserWindow({...browserWindowOptions(process.platform),x:80,y:150,width:800,height:600,
      webPreferences:{preload:${JSON.stringify(preload)},sandbox:true,contextIsolation:true,nodeIntegration:false}});
    const host=await installDesktopCompanions({profile:app.getPath('userData'),mainWindow:()=>main,
      allowed:e=>e.sender===main.webContents&&e.senderFrame===main.webContents.mainFrame,reveal:()=>{}});
    ipcMain.handle('fixture.defaults',()=>DEFAULT_DESKTOP_COMPANIONS);
    app.on('before-quit',()=>host.dispose());
    await main.loadURL('data:text/html,<title>Isolated interaction fixture</title><input id="draft" aria-label="Draft">');
    }
    void qualify().catch(error=>{console.error(error);app.exit(1);});
  `;
  await build({stdin:{contents:source,resolveDir:desktop,sourcefile:'interaction-fixture.mjs'},outfile:entry,
    bundle:true,platform:'node',format:'esm',target:'node24',external:['electron'],
    banner:{js:"import {createRequire as fixtureRequire} from 'node:module';const require=fixtureRequire(import.meta.url);"}});
  phase = 'launch';
  const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE;
  app = await _electron.launch({args:[entry],env,timeout:60_000});
  const page = await app.firstWindow();
  await page.waitForSelector('#draft');
  await page.evaluate(async () => {
    const prefs=await window.fixture.defaults();
    await window.fixture.save({...prefs,dock:{...prefs.dock,shown:true,display:'window'},island:{...prefs.island,shown:true}});
    window.snapshot = {scope:'fixture:space',theme:'light',agents:[{id:'fixture',name:'Fixture',color:'#3f9f78',status:'Waiting',result:'',working:false,unread:false}],
      questions:[{id:'fixture:question',botId:'fixture',runId:'fixture-run',messageId:'fixture-message',legacy:true,questions:[{id:'question',question:'Fixture?',options:[]}]}]};
    await window.fixture.publish(window.snapshot);
  });
  phase = 'focus';
  const deadline = Date.now()+15_000;
  let island;
  while (!island && Date.now()<deadline) {
    island = app.windows().find(p => p.url().endsWith('/companion.html') && p !== page);
    // Select by the host title because dock and island share their local document.
    island = await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows().some(w=>w.getTitle()==='Mycellios · Island')) ? island : undefined;
    if(!island) await pause(100);
  }
  assert.ok(island, 'Island did not open');
  await app.evaluate(async ({BrowserWindow}) => {
    const win=BrowserWindow.getAllWindows().find(w=>w.getTitle()==='Mycellios · Island');
    await win.webContents.executeJavaScript('window.companion.expand(true)');
  });
  await pause(200);
  await app.evaluate(async ({BrowserWindow}) => {
    const win=BrowserWindow.getAllWindows().find(w=>w.getTitle()==='Mycellios · Island');
    win.focus(); await win.webContents.executeJavaScript('document.querySelector("input").focus()');
    const main=BrowserWindow.getAllWindows().find(w=>w.getTitle()==='Isolated interaction fixture');
    main.show();main.focus();
  });
  await page.locator('#draft').focus();
  await page.evaluate(() => {window.poll=setInterval(()=>{
    window.snapshot.agents[0].status='Update '+Date.now();void window.fixture.publish(window.snapshot);
  },40);});
  const focused = () => app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle()==='Isolated interaction fixture').isFocused());
  for (const text of ['A draft ', 'that stays ', 'in the main window.']) {
    assert.equal(await focused(),true,'Background activity stole native focus');
    await page.keyboard.type(text,{delay:25}); await pause(250);
    assert.equal(await focused(),true,'Typing lost native focus');
  }
  assert.equal(await page.locator('#draft').inputValue(),'A draft that stays in the main window.');
  const koffi=createRequire(import.meta.url)('koffi');
  const user32=koffi.load('user32.dll');
  const Rect=koffi.struct('InteractionRect',{left:'int',top:'int',right:'int',bottom:'int'});
  const Point=koffi.struct('InteractionPoint',{x:'int',y:'int'});
  const rect=user32.func('GetWindowRect','bool',['uintptr_t',koffi.out(koffi.pointer(Rect))]);
  const at=user32.func('WindowFromPoint','uintptr_t',[Point]);
  const cursor=user32.func('bool __stdcall SetCursorPos(int x,int y)');
  const mouse=user32.func('void __stdcall mouse_event(uint32_t flags,uint32_t dx,uint32_t dy,uint32_t data,uintptr_t extra)');
  const handle=BigInt(await app.evaluate(({BrowserWindow})=>{
    const b=BrowserWindow.getAllWindows().find(w=>w.getTitle()==='Isolated interaction fixture').getNativeWindowHandle();
    return (b.length===8?b.readBigUInt64LE():BigInt(b.readUInt32LE())).toString();
  }));
  const movements=[];
  for(const maximized of [false,true]) {
    phase=maximized?'drag from maximized':'drag restored';
    await app.evaluate(({BrowserWindow},maximized)=>{
      const win=BrowserWindow.getAllWindows().find(w=>w.getTitle()==='Isolated interaction fixture');
      if(maximized)win.maximize();else{win.unmaximize();win.setBounds({x:80,y:150,width:800,height:600});}win.focus();
    },maximized);
    await pause(300);
    const before={};assert.ok(rect(handle,before));
    const start={x:before.left+150,y:Math.max(10,before.top+18)};
    assert.equal(BigInt(at(start)),handle,'Caption is covered by a different window');
    assert.ok(cursor(start.x,start.y));mouse(2,0,0,0,0);
    try{for(let step=1;step<=12;step++){assert.ok(cursor(start.x+step*9,start.y+step*7));await pause(35);}}
    finally{mouse(4,0,0,0,0);}
    await pause(500);const dropped={};assert.ok(rect(handle,dropped));
    assert.ok(Math.abs(dropped.left-before.left)>30||Math.abs(dropped.top-before.top)>30,'Native caption drag did not move the window');
    await pause(1200);const retained={};assert.ok(rect(handle,retained));
    assert.deepEqual(retained,dropped,'Window jumped after dropping it');
    assert.equal(await focused(),true,'Moving the window lost focus');
    movements.push({fromMaximized:maximized,positionRetained:true});
  }
  const receipt={passed:true,isolatedProfile:true,realAccount:false,nativePointerDrag:true,typingDuringUpdates:true,movements};
  await writeFile(path.join(output,'window-interaction-qualification.json'),JSON.stringify(receipt,null,2));
  console.log(JSON.stringify(receipt));
} catch(error) {
  await writeFile(path.join(output,'window-interaction-qualification.json'),JSON.stringify({passed:false,phase})).catch(()=>{});
  throw error;
} finally {await app?.close();await rm(temp,{recursive:true,force:true});}
