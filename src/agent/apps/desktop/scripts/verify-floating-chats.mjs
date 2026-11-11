import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// Isolated native windows and session fixture; no account, model, microphone or computer tools.
const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(process.argv[2] ?? 'floating-chat-proof');
const temp = await mkdtemp(path.join(tmpdir(), 'mycellios-floating-proof-'));
const require = createRequire(import.meta.url);
const electron = require('electron');
try {
  await copyFile(path.join(desktop, 'dist/floating-chat-preload.cjs'), path.join(temp, 'floating-chat-preload.cjs'));
  const source = `
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
import { app, BrowserWindow, ipcMain } from 'electron';
import { FloatingChats } from ${JSON.stringify(path.join(desktop, 'src/floating-chats.ts'))};
app.setPath('userData', ${JSON.stringify(path.join(temp, 'profile'))});
app.on('window-all-closed', () => {});
const server = createServer((_req,res) => { res.setHeader('content-type','text/html'); res.end('<!doctype html><title>Isolated chat fixture</title><main>Chat fixture</main>'); });
let main, chats;
try {
 await app.whenReady();
 await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
 const url = 'http://127.0.0.1:'+server.address().port+'/agent/app/main';
 main = new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
 await main.loadURL(url);
 await main.webContents.session.cookies.set({url, name:'fixture_session',value:'synthetic-only',path:'/'});
 let returned = false, empty = 0;
 chats = new FloatingChats({ main:()=>main,load:(win,url)=>win.loadURL(url),external:()=>{},reveal:()=>{returned=true;},onEmpty:()=>{empty++;} });
 const scope=JSON.stringify(['fixture-owner','fixture-space']);
 chats.account(scope);
 ipcMain.handle('desktop.chat.return',event=>chats.returnToMain(event.sender,event.senderFrame));
 await chats.open({scope,botId:'fixture-mico'});
 const win = chats.liveWindows()[0];
 assert.equal(win.webContents.getURL(),url.replace('/main','/fixture-mico'));
 assert.equal(win.webContents.session,main.webContents.session);
 const bridge=await win.webContents.executeJavaScript('({keys:Object.keys(window.rakazoDesktop).sort(),space:window.rakazoDesktop.chatWindow.spaceId,cookie:document.cookie})');
 assert.deepEqual(bridge.keys,['chatWindow','nativeWindowFrame','platform']);
 assert.equal(bridge.space,'fixture-space');
 assert.equal(bridge.cookie,'fixture_session=synthetic-only');
 await win.webContents.executeJavaScript('window.rakazoDesktop.chatWindow.returnToMain()');
 assert.equal(returned,true);
 await chats.open({scope,botId:'fixture-mico'});
 assert.equal(chats.liveWindows().length,1);
 chats.account(JSON.stringify(['fixture-owner','another-space']));
 assert.equal(win.isDestroyed(),false);
 chats.account(JSON.stringify(['another-owner','another-space']));
 assert.equal(win.isDestroyed(),true);
 assert.equal(empty,0);
 chats.account(scope);
 await chats.open({scope,botId:'fixture-mico'});
 const closed=new Promise(resolve=>chats.liveWindows()[0].once('closed',resolve));
 chats.liveWindows()[0].close();await closed;
 assert.equal(empty,1);
 writeFileSync(${JSON.stringify(path.join(temp, 'result.json'))},JSON.stringify({passed:true,realAccount:false,checks:['real native preload sandbox','shared session cookie','pinned Space','return to main IPC','window reuse','account-change cleanup','last-window close']}));
 app.exit(0);
} catch(error) { console.error(error); app.exit(1); }
finally { chats?.clear(); if(main&&!main.isDestroyed())main.destroy(); server.close(); }
`;
  const entry = path.join(temp, 'main.mjs');
  await build({ stdin: { contents: source, resolveDir: desktop, sourcefile: 'floating-proof.mjs' }, outfile: entry,
    bundle: true, platform: 'node', format: 'esm', target: 'node24', external: ['electron'] });
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  await promisify(execFile)(electron, [entry], { env, windowsHide: true, timeout: 60_000, maxBuffer: 1024 * 1024 });
  const receipt = JSON.parse(await readFile(path.join(temp, 'result.json'), 'utf8'));
  assert.equal(receipt.passed, true);
  const { mkdir } = await import('node:fs/promises');
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, 'floating-chats-qualification.json'), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt));
} finally { await rm(temp, { recursive: true, force: true }); }
