/** Anonymous native IPC/process/browser acceptance; never uses the installed profile. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { app, BrowserWindow, webContents } from "electron";
import { installProjectRunner } from "../src/project-runner-ipc.js";
import { installProjectBrowser } from "../src/project-browser.js";
const output = process.env.MYCELLIOS_RUNNER_FIXTURE_OUTPUT!;
app.setPath("userData", path.join(output, "native-profile"));
app.commandLine.appendSwitch("disable-gpu");
async function until<T>(read: () => Promise<T>, accepts: (value: T) => boolean, label: string) {
  const end = Date.now() + 20000;
  while (Date.now() < end) { const result = await read(); if (accepts(result)) return result; await pause(100); }
  throw new Error("Timed out: " + label);
}
void app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1200, height: 850, webPreferences: { preload: path.join(import.meta.dirname, "preload.cjs"), sandbox: true, contextIsolation: true, nodeIntegration: false } });
  const sandbox = path.join(output, "native-runs", randomUUID());
  const workspace = path.join(sandbox, "project"), storage = path.join(sandbox, "bindings");
  await mkdir(workspace, { recursive: true });
  const server = createServer((_q, response) => response.end('<!doctype html><h1>Anonymous native runner owner</h1>'));
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  let allowed = true;
  const runner = installProjectRunner({ storage, leaseValid: () => allowed,
    context: async (event, botId) => {
      assert(allowed && botId === "bot" && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame && win.webContents.getURL() === origin + "/bot", "Untrusted project caller");
      return { key: "fixture-owner:bot", workspace };
    },
  });
  const browser = installProjectBrowser({ getWindow: () => win, authorize: event => event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame, scope: async () => "fixture-owner:bot" });
  try {
    await win.loadURL(origin + "/bot");
    const first = await win.webContents.executeJavaScript('window.rakazoDesktop.projectRunner.play({botId:"bot"})');
    assert.equal(first.phase, "preparing");
    await assert.rejects(win.webContents.executeJavaScript('window.rakazoDesktop.projectRunner.play({botId:"other-bot"})'));
    const reserve = createServer(); await new Promise<void>(resolve => reserve.listen(0, "127.0.0.1", resolve));
    const port = reserve.address(); assert(port && typeof port !== "string"); await new Promise<void>(resolve => reserve.close(() => resolve()));
    const url = `http://127.0.0.1:${port.port}/`;
    const service = path.join(workspace, "server.cjs");
    await writeFile(service, `require('node:http').createServer((q,r)=>r.end('<h1>Native local project</h1>')).listen(${port.port},'127.0.0.1');`);
    const node = process.env.MYCELLIOS_RUNNER_FIXTURE_NODE!;
    const command = `& '${node.replaceAll("'", "''")}' '${service.replaceAll("'", "''")}'`;
    await mkdir(path.join(workspace, ".mycellios"), { recursive: true });
    await writeFile(path.join(workspace, ".mycellios/run.json"), JSON.stringify({ version: 1, services: [{ id: "web", command, ready: { url, timeoutMs: 10000 } }], profiles: [{ id: "web", name: "Web", services: ["web"], url }] }));
    const binding = path.join(storage, createHash("sha256").update("fixture-owner:bot").digest("hex"), "project.json");
    await writeFile(binding, JSON.stringify({ path: workspace, preparationId: first.preparation.id }));
    await win.webContents.executeJavaScript(`window.rakazoDesktop.projectRunner.play({botId:"bot",preparationId:${JSON.stringify(first.preparation.id)}})`);
    const running = await until(() => win.webContents.executeJavaScript('window.rakazoDesktop.projectRunner.state("bot")'), state => state.phase === "running", "native services");
    assert.equal(running.urls[0].url, url);
    await win.webContents.executeJavaScript(`window.rakazoDesktop.preview.show(${JSON.stringify({ id: "run:bot", url, bounds: { x: 610, y: 120, width: 550, height: 600 } })})`);
    const page = await until(async () => webContents.getAllWebContents().find(content => content !== win.webContents && content.getURL() === url), Boolean, "embedded native page");
    assert(page); assert.equal(await page.executeJavaScript("typeof window.rakazoDesktop"), "undefined");
    assert.equal(await page.executeJavaScript("location.href"), url);
    await win.webContents.executeJavaScript('window.rakazoDesktop.projectRunner.stop("bot")');
    await until(() => win.webContents.executeJavaScript('window.rakazoDesktop.projectRunner.state("bot")'), state => state.phase === "configured", "explicit Stop");
    await until(async () => { try { await fetch(url, { signal: AbortSignal.timeout(500) }); return false; } catch { return true; } }, Boolean, "stopped service port");
    await win.webContents.executeJavaScript('window.rakazoDesktop.projectRunner.play({botId:"bot"})');
    await until(() => win.webContents.executeJavaScript('window.rakazoDesktop.projectRunner.state("bot")'), state => state.phase === "running", "Play after Stop");
    assert.equal((await fetch(url)).status, 200);
    // Losing authorization closes only the process tree that this runner owns.
    allowed = false;
    await until(async () => { try { await fetch(url, { signal: AbortSignal.timeout(500) }); return false; } catch { return true; } }, Boolean, "revoked services stopped");
    allowed = true;
    assert.equal((await win.webContents.executeJavaScript('window.rakazoDesktop.projectRunner.state("bot")')).phase, "configured");
    await writeFile(path.join(output, "native-proof.json"), JSON.stringify({ passed: true, realElectron: true, nativeProcessTree: true, scopedIpc: true, embeddedBrowser: true, noPageBridge: true, explicitStopPlay: true, revokedServicesStopped: true, realModel: false, realAccount: false }, null, 2));
    app.exit(0);
  } catch (error) {
    await writeFile(path.join(output, "native-proof.json"), JSON.stringify({ passed: false, error: String(error), stack: error instanceof Error ? error.stack : undefined }, null, 2)); app.exit(1);
  } finally { runner.dispose(); browser.dispose(); if (!win.isDestroyed()) win.destroy(); server.close(); }
});
