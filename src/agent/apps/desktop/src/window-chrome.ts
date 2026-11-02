import path from "node:path";
import { pathToFileURL } from "node:url";
import { type BrowserWindow, View, WebContentsView } from "electron";

export const WINDOW_CHROME_HEIGHT = 28;
export const WINDOW_CHROME_WIDTH = 88;
const WINDOWS_CAPTION_BUTTONS_WIDTH = 138;

function hasStandaloneCaption(url: string) {
  try {
    const { pathname } = new URL(url);
    return pathname === "/oauth/consent" ||
      /^\/(?:agent\/)?(?:sign-in|sign-up|forgot-password|reset-password|onboarding)(?:\/|$)/.test(pathname);
  } catch {
    return false;
  }
}

/** The page may navigate or crash without removing the window controls. */
export function installWindowChrome(win: BrowserWindow, platform: NodeJS.Platform) {
  if (platform === "darwin") return;
  if (platform === "win32") { installNativeWindowsChrome(win); return; }
  const page = win.contentView;
  const container = new View();
  win.setContentView(container);
  container.addChildView(page);
  const strip = new WebContentsView({
    webPreferences: {
      preload: path.join(import.meta.dirname, "window-chrome-preload.cjs"),
      partition: "mycellios-window-chrome",
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  const document = path.join(import.meta.dirname, "window-chrome.html");
  const documentUrl = pathToFileURL(document).href;
  strip.setBackgroundColor("#00000000");
  container.addChildView(strip);
  strip.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  strip.webContents.session.setPermissionCheckHandler(() => false);
  strip.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  strip.webContents.on("will-navigate", (event, url) => {
    if (url !== documentUrl) event.preventDefault();
  });
  strip.webContents.on("ipc-message", (event, channel, action: unknown) => {
    if (channel !== "desktop.chrome.action" || event.senderFrame !== strip.webContents.mainFrame ||
        event.senderFrame.url !== documentUrl || win.isDestroyed()) return;
    if (action === "close") win.close();
    else if (action === "minimize") win.minimize();
    else if (action === "maximize") {
      if (win.isFullScreen()) win.setFullScreen(false);
      else if (win.isMaximized()) win.unmaximize();
      else win.maximize();
    }
  });
  const layout = () => {
    const { width, height } = win.getContentBounds();
    const controlHeight = Math.min(height, WINDOW_CHROME_HEIGHT);
    const left = Math.min(width, 8);
    strip.setBounds({ x: left, y: Math.min(16, Math.max(0, height - controlHeight)), width: Math.min(width - left, WINDOW_CHROME_WIDTH), height: controlHeight });
    page.setBounds({ x: 0, y: 0, width, height });
  };
  win.on("resize", layout);
  win.once("closed", () => {
    win.removeListener("resize", layout);
    if (!strip.webContents.isDestroyed()) strip.webContents.close();
  });
  layout();
  // Only bundled local content is loaded. No account, model or OS-access bridge.
  void strip.webContents.loadFile(document);
}

/** Native Windows caption: never replace or reposition BrowserWindow's own content view. */
function installNativeWindowsChrome(win: BrowserWindow) {
  const strip = new WebContentsView({webPreferences:{partition:"mycellios-native-caption",sandbox:true,contextIsolation:true,nodeIntegration:false}});
  strip.setBackgroundColor("#00000000");
  win.contentView.addChildView(strip);
  strip.webContents.setWindowOpenHandler(()=>({action:"deny"}));
  strip.webContents.session.setPermissionCheckHandler(()=>false);
  strip.webContents.session.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  strip.webContents.on("will-navigate",event=>event.preventDefault());
  const layout=()=>{
    if(win.isDestroyed()) return;
    const {width,height}=win.getContentBounds();
    // Authentication pages have no draggable app header. Keep this transparent
    // native-owned hit region across their empty caption row, clear of OS buttons.
    const dragWidth = hasStandaloneCaption(win.webContents.getURL())
      ? Math.max(0, width - WINDOWS_CAPTION_BUTTONS_WIDTH)
      : Math.min(width, WINDOW_CHROME_WIDTH);
    strip.setVisible(!win.isFullScreen());
    strip.setBounds({x:0,y:0,width:dragWidth,height:Math.min(height,51)});
  };
  const syncSurface = async () => {
    if (win.isDestroyed()) return;
    try {
      const color = await win.webContents.executeJavaScript(`(() => {
        let node = document.elementFromPoint(Math.max(1, innerWidth - 180), 30) || document.body;
        let color;
        while (node) {
          color = getComputedStyle(node).backgroundColor;
          if (color && color !== "transparent" && color !== "rgba(0, 0, 0, 0)") break;
          node = node.parentElement;
        }
        const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
        const ctx = canvas.getContext("2d"); ctx.fillStyle = color || "transparent";
        ctx.fillRect(0, 0, 1, 1);
        const [r,g,b,a] = ctx.getImageData(0,0,1,1).data;
        return a ? "rgb("+r+", "+g+", "+b+")" : "";
      })()`);
      if (!win.isDestroyed() && /^rgb\([\d.,\s]+\)$/.test(color)) {
        const rgb = color.match(/[\d.]+/g)!.map(Number);
        win.setBackgroundColor(color);
        win.setTitleBarOverlay({color: "#00000000", symbolColor: rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722>140 ? "#1e2a22" : "#ffffff", height:51});
      }
    } catch { /* Keep the current surface while navigating or after a renderer failure. */ }
  };

  const reserveCaption = () => {
    if (win.isDestroyed()) return;
    // The right panel reaches the window edge independently of the chat header.
    // Reserve the caption row on the panel itself, outside its scrolling content.
    void win.webContents.insertCSS(`
      main[data-space-switch="main"] .pointer-events-none.absolute.inset-x-0.top-0.grid {
        padding-inline-end: 162px !important; background: transparent; border-bottom: 0;
      }
      aside[data-testid="side-panel"] {
        box-sizing: border-box;
        padding-top: 51px;
      }
    `).catch(()=>{});
  };
  win.webContents.on("dom-ready",reserveCaption);
  win.webContents.on("did-navigate",layout);
  win.webContents.on("did-navigate-in-page",layout);
  win.webContents.on("dom-ready",syncSurface); win.webContents.on("did-finish-load",syncSurface);
  win.on("resize",layout); win.on("enter-full-screen",layout); win.on("leave-full-screen",layout);
  const contents = win.webContents;
  win.once("closed",()=>{
    contents.removeListener("dom-ready",reserveCaption);
    contents.removeListener("did-navigate",layout);
    contents.removeListener("did-navigate-in-page",layout);
    contents.removeListener("dom-ready",syncSurface); contents.removeListener("did-finish-load",syncSurface);
    win.removeListener("resize",layout);win.removeListener("enter-full-screen",layout);win.removeListener("leave-full-screen",layout);
    if(!strip.webContents.isDestroyed())strip.webContents.close();
  });
  layout();
  void strip.webContents.loadFile(path.join(import.meta.dirname,"window-native-chrome.html")).catch(()=>{});
}
