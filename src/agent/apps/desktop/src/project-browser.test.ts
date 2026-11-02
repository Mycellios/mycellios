import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ handlers: new Map<string, any>(), views: [] as any[], sessions: [] as any[] }));
vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    ipcMain: { handle: (name: string, handler: unknown) => native.handlers.set(name, handler) },
    session: { fromPartition: vi.fn((partition: string) => {
      const value = Object.assign(new EventEmitter(), { partition, setPermissionCheckHandler: vi.fn(), setPermissionRequestHandler: vi.fn() });
      native.sessions.push(value); return value;
    }) },
    WebContentsView: class {
      options: any;
      bounds: any = {};
      webContents = Object.assign(new EventEmitter(), {
        mainFrame: {}, url: "", title: "Fixture", send: vi.fn(), close: vi.fn(),
        isDestroyed: () => false, isLoading: () => false, getZoomFactor: () => 1,
        navigationHistory: { canGoBack: () => false, canGoForward: () => false, goBack: vi.fn(), goForward: vi.fn() },
        setWindowOpenHandler: vi.fn(),
        capturePage: vi.fn(async () => ({ toPNG: () => Buffer.from("captured-selected-element") })),
        getURL: () => this.webContents.url, getTitle: () => this.webContents.title,
        loadURL: vi.fn(async (url: string) => { this.webContents.url = url; }), reload: vi.fn(),
      });
      constructor(options: any) { this.options = options; native.views.push(this); }
      setVisible = vi.fn();
      setBounds(bounds: any) { this.bounds = bounds; }
      getBounds() { return this.bounds; }
    },
  };
});
import { installProjectBrowser, projectBrowserBounds, projectBrowserUrl } from "./project-browser.js";

function setup() {
  const win = Object.assign(new EventEmitter(), {
    isDestroyed: () => false, getContentSize: () => [1200, 800],
    contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
    webContents: Object.assign(new EventEmitter(), { getZoomFactor: () => 1, send: vi.fn(), session: { cookies: new EventEmitter() } }),
  });
  let scope = "space-a:bot-a";
  const api = installProjectBrowser({ getWindow: () => win as any, authorize: event => (event as any).trusted === true, scope: async () => scope });
  const request = (channel: string, value: unknown, trusted = true) => native.handlers.get(`desktop.preview.${channel}`)({ trusted }, value);
  const show = (id = "page", url = "http://localhost:3000") => request("show", { id, url, bounds: { x: 650, y: 110, width: 500, height: 500 } });
  return { win, api, request, show, switchScope: () => { scope = "space-b:bot-b"; } };
}
beforeEach(() => { native.handlers.clear(); native.views.length = 0; native.sessions.length = 0; });

describe("project browser", () => {
  it("rejects executable and credential-bearing URLs and clamps content below window controls", () => {
    expect(projectBrowserUrl("http://[::1]:3000/app")).toBe("http://[::1]:3000/app");
    for (const url of ["file:///private", "data:text/html,x", "javascript:alert(1)", "https://user:secret@example.test", {}, ""]) expect(() => projectBrowserUrl(url)).toThrow();
    expect(projectBrowserBounds({x:-1,y:0,width:9999,height:9999}, 1200,800)).toEqual({x:0,y:51,width:1200,height:749});
    expect(() => projectBrowserBounds({x:NaN,y:50,width:100,height:100},1200,800)).toThrow();
  });
  it("admits only the owning frame and isolates page cookies, preload and navigation", async () => {
    const app = setup();
    await expect(app.request("show", { id:"page",url:"http://localhost:3000",bounds:{} },false)).rejects.toThrow();
    expect(native.views).toHaveLength(0);
    await app.show();
    const page = native.views[0];
    expect(page.options.webPreferences).toMatchObject({ sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true });
    expect(page.options.webPreferences.preload).toMatch(/project-browser-preload\.cjs$/);
    expect(page.options.webPreferences.session.partition).not.toContain("persist:");
    expect(page.webContents.setWindowOpenHandler.mock.calls[0][0]()).toEqual({action:"deny"});
    const event = {preventDefault:vi.fn()};
    page.webContents.emit("will-navigate",event,"file:///private");
    expect(event.preventDefault).toHaveBeenCalled();
    app.win.webContents.session.cookies.emit("changed");
    expect(page.webContents.close).not.toHaveBeenCalled();
    app.switchScope(); await app.show("new-owner");
    expect(page.webContents.close).toHaveBeenCalled();
  });
  it("binds selection capture to the current page, native frame and inspector token", async () => {
    const app = setup(); await app.show();
    const page = native.views[0], wc = page.webContents;
    await app.request("command", {id:"page",action:"select",enabled:true});
    const token = wc.send.mock.lastCall[1].token;
    const selection = {token,selector:"button#save",text:"Save",rect:{x:10,y:20,width:80,height:40}};
    const receive = wc.listeners("ipc-message")[0];
    await receive({senderFrame:{}},"desktop.preview.selection",selection);
    await receive({senderFrame:wc.mainFrame},"desktop.preview.selection",{...selection,token:"stale"});
    expect(wc.capturePage).not.toHaveBeenCalled();
    await receive({senderFrame:wc.mainFrame},"desktop.preview.selection",selection);
    expect(wc.capturePage).toHaveBeenCalledWith({x:10,y:20,width:80,height:40});
    expect(app.win.webContents.send.mock.lastCall?.[1]).toMatchObject({id:"page",selecting:false,selection:{selector:"button#save",text:"Save",screenshot:expect.stringMatching(/^data:image\/png;base64,/)}});
  });
  it("discards capture results after navigation and closes pages on chat/Space switch", async () => {
    const app = setup(); await app.show();
    const wc = native.views[0].webContents;
    let finish: (value: unknown) => void = () => {};
    wc.capturePage.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await app.request("command",{id:"page",action:"select",enabled:true});
    const token = wc.send.mock.lastCall[1].token;
    const promise = wc.listeners("ipc-message")[0]({senderFrame:wc.mainFrame},"desktop.preview.selection",{token,selector:"h1",text:"Old page",rect:{x:1,y:1,width:100,height:30}});
    await Promise.resolve();
    wc.emit("did-start-navigation",{},"http://localhost:3000/next",false,true);
    finish({toPNG:()=>Buffer.from("stale")}); await promise;
    expect(app.win.webContents.send.mock.calls.some(([,state]) => state.selection)).toBe(false);
    app.switchScope(); await app.show("other");
    expect(wc.close).toHaveBeenCalled();
    expect(native.views[1].options.webPreferences.session.partition).not.toBe(native.views[0].options.webPreferences.session.partition);
    app.api.dispose(); expect(native.views[1].webContents.close).toHaveBeenCalled();
  });
  it("bounds retained browser processes while leaving tab management in the renderer", async () => {
    const app = setup();
    for (let index=0;index<5;index++) await app.show(`page-${index}`);
    expect(native.views[0].webContents.close).toHaveBeenCalled();
    expect(native.views[4].setVisible).toHaveBeenLastCalledWith(true);
    expect(native.views[3].setVisible).toHaveBeenLastCalledWith(false);
    await app.request("layout", {id:"page-4",bounds:null});
    expect(native.views[4].setVisible).toHaveBeenLastCalledWith(false);
  });
  it.each(["cancel", "spa"])("discards a delayed capture after %s", async action => {
    const app=setup(); await app.show(); const wc=native.views[0].webContents;
    let finish:(value:unknown)=>void=()=>{};
    wc.capturePage.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    await app.request("command",{id:"page",action:"select",enabled:true});
    const token=wc.send.mock.lastCall[1].token;
    const pending=wc.listeners("ipc-message")[0]({senderFrame:wc.mainFrame},"desktop.preview.selection",{token,selector:"h1",text:"Previous selection",rect:{x:1,y:1,width:100,height:30}});
    await Promise.resolve();
    if(action==="cancel") await app.request("command",{id:"page",action:"select",enabled:false});
    else wc.emit("did-navigate-in-page");
    finish({toPNG:()=>Buffer.from("stale")});await pending;
    expect(app.win.webContents.send.mock.calls.some(([,state])=>state.selection)).toBe(false);
  });
});
