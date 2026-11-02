import { EventEmitter } from "node:events";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ views: [] as any[] }));
vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events");
  class View {
    children: any[] = [];
    bounds: unknown;
    addChildView(view: any) { this.children.push(view); }
    setBounds(bounds: unknown) { this.bounds = bounds; }
    setBackgroundColor() {}
    setVisible() {}
  }
  class WebContentsView extends View {
    constructor(public options: unknown) { super(); state.views.push(this); }
    webContents = Object.assign(new EventEmitter(), {
      mainFrame: { url: "" },
      session: { setPermissionCheckHandler: vi.fn(), setPermissionRequestHandler: vi.fn() },
      setWindowOpenHandler: vi.fn(),
      loadFile: vi.fn(async () => undefined),
      isDestroyed: vi.fn(() => false),
      close: vi.fn(),
    });
  }
  return { View, WebContentsView };
});
import { installWindowChrome, WINDOW_CHROME_HEIGHT } from "./window-chrome.js";

function fixture(platform: NodeJS.Platform = "linux") {
  const page = { setBounds: vi.fn() };
  const win = Object.assign(new EventEmitter(), {
    contentView: page as any, getContentBounds: vi.fn(() => ({ width: 720, height: 560 })),
    setContentView: vi.fn(function(this: any, view: unknown) { this.contentView = view; }),
    isDestroyed: vi.fn(() => false), isMaximized: vi.fn(() => false), isFullScreen: vi.fn(() => false),
    webContents: Object.assign(new EventEmitter(), {getURL:vi.fn(()=>"https://www.mycellios.com/agent/app/mico"),executeJavaScript:vi.fn(async()=>"rgb(247, 245, 240)"),insertCSS:vi.fn(async()=>"caption-style")}),
    setBackgroundColor:vi.fn(),setTitleBarOverlay:vi.fn(),
    close: vi.fn(), minimize: vi.fn(), maximize: vi.fn(), unmaximize: vi.fn(), setFullScreen: vi.fn(),
  });
  if(platform === "win32") win.contentView = {children:[],addChildView:vi.fn()} as any;
  installWindowChrome(win as any, platform);
  return { win, page, strip: state.views.at(-1) };
}
describe("persistent host window controls", () => {
  it("keeps only a compact overlay and gives the page its full height", () => {
    const { win, page, strip } = fixture();
    expect(win.contentView.children).toEqual([page, strip]);
    expect(strip.bounds).toEqual({ x: 8, y: 16, width: 88, height: 28 });
    expect(page.setBounds).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 720, height: 560 });
    win.getContentBounds.mockReturnValue({ width: 320, height: 20 }); win.emit("resize");
    expect(strip.bounds).toEqual({ x: 8, y: 0, width: 88, height: 20 });
    expect(page.setBounds).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 320, height: 20 });
  });
  it("trusts only the local strip main frame, never the page or a foreign URL", () => {
    const { win, strip } = fixture(); const wc = strip.webContents;
    const url = pathToFileURL(path.join(import.meta.dirname, "window-chrome.html")).href;
    wc.mainFrame.url = url;
    wc.emit("ipc-message", { senderFrame: { url } }, "desktop.chrome.action", "close");
    wc.emit("ipc-message", { senderFrame: wc.mainFrame }, "other", "close");
    wc.mainFrame.url = "https://www.mycellios.com/oauth/consent";
    wc.emit("ipc-message", { senderFrame: wc.mainFrame }, "desktop.chrome.action", "close");
    expect(win.close).not.toHaveBeenCalled();
    wc.mainFrame.url = url;
    for (const action of ["minimize", "maximize", "unknown", "close"]) {
      wc.emit("ipc-message", { senderFrame: wc.mainFrame }, "desktop.chrome.action", action);
    }
    expect(win.minimize).toHaveBeenCalledOnce(); expect(win.maximize).toHaveBeenCalledOnce(); expect(win.close).toHaveBeenCalledOnce();
  });
  it("blocks navigation, popups and permission requests and disposes the strip", () => {
    const { win, strip } = fixture(); const wc = strip.webContents;
    expect(strip.options.webPreferences).toMatchObject({ nodeIntegration: false, contextIsolation: true, sandbox: true });
    expect(wc.setWindowOpenHandler.mock.calls[0][0]()).toEqual({ action: "deny" });
    const event = { preventDefault: vi.fn() }; wc.emit("will-navigate", event, "https://example.com");
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(wc.session.setPermissionCheckHandler.mock.calls[0][0]()).toBe(false);
    const callback = vi.fn(); wc.session.setPermissionRequestHandler.mock.calls[0][0](null, "media", callback);
    expect(callback).toHaveBeenCalledWith(false);
    win.emit("closed"); expect(wc.close).toHaveBeenCalledOnce(); expect(win.listenerCount("resize")).toBe(0);
  });
  it("uses native Windows actions over a matching surface", async () => {
    const {win,page,strip}=fixture("win32");
    expect(page.setBounds).not.toHaveBeenCalled();
    expect(win.setContentView).not.toHaveBeenCalled();
    expect(strip.bounds).toEqual({x:0,y:0,width:88,height:51});
    win.webContents.emit("dom-ready");
    expect(win.webContents.insertCSS.mock.calls[0][0]).toContain('aside[data-testid="side-panel"]');
    expect(win.webContents.insertCSS.mock.calls[0][0]).toContain("padding-top: 51px");
    expect(win.webContents.insertCSS.mock.calls[0][0]).toContain("background: transparent");
    expect(win.webContents.insertCSS.mock.calls[0][0]).not.toContain("border-bottom: 1px");
    expect(win.webContents.insertCSS.mock.calls[0][0]).toContain("padding-inline-end: 162px");
    win.webContents.emit("did-finish-load"); await new Promise(resolve=>setTimeout(resolve,0));
    expect(win.setTitleBarOverlay).toHaveBeenCalledWith({color:"#00000000",symbolColor:"#1e2a22",height:51});
  });
  it("preserves the existing native macOS traffic lights", () => {
    const { win } = fixture("darwin"); expect(win.setContentView).not.toHaveBeenCalled();
  });
  it("keeps login draggable after redirects without covering native controls or the app header", () => {
    const {win,strip}=fixture("win32");
    win.webContents.getURL.mockReturnValue("https://www.mycellios.com/oauth/consent?authorization_id=example");
    win.webContents.emit("did-navigate");
    expect(strip.bounds).toEqual({x:0,y:0,width:582,height:51});
    win.getContentBounds.mockReturnValue({width:460,height:560});win.emit("resize");
    expect(strip.bounds).toEqual({x:0,y:0,width:322,height:51});
    win.webContents.getURL.mockReturnValue("https://www.mycellios.com/agent/sign-in");
    win.webContents.emit("did-navigate-in-page");
    expect(strip.bounds).toEqual({x:0,y:0,width:322,height:51});
    win.webContents.getURL.mockReturnValue("https://www.mycellios.com/agent/app/mico?settings=models");
    win.webContents.emit("did-navigate");
    expect(strip.bounds).toEqual({x:0,y:0,width:88,height:51});
    win.emit("closed");
    expect(win.webContents.listenerCount("did-navigate")).toBe(0);
    expect(win.webContents.listenerCount("did-navigate-in-page")).toBe(0);
  });
});
