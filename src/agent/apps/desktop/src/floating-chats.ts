import { BrowserWindow, type WebContents } from "electron";
import path from "node:path";

export type FloatingChatTarget = { scope: string; botId: string };

export function chatScope(scope: string): { userId: string; spaceId: string } {
  const parsed: unknown = JSON.parse(scope);
  if (!Array.isArray(parsed) || parsed.length !== 2 ||
      !parsed.every(value => typeof value === "string" && /^[a-zA-Z0-9_-]{1,160}$/.test(value))) {
    throw new Error("Invalid chat account and space");
  }
  return { userId: parsed[0], spaceId: parsed[1] };
}

export function floatingChatUrl(base: string, botId: string) {
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(botId)) throw new Error("Invalid Mico");
  const url = new URL(base);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Invalid chat server");
  }
  const app = /\/app(?:\/|$)/.exec(url.pathname);
  const prefix = app ? url.pathname.slice(0, app.index) : url.pathname.replace(/\/$/, "");
  url.pathname = prefix + "/app/" + encodeURIComponent(botId);
  url.search = "";
  url.hash = "";
  return url.href;
}

/** Chat-only windows share the server session while their Space stays pinned. */
export class FloatingChats {
  private readonly windows = new Map<string, { win: BrowserWindow; target: FloatingChatTarget }>();
  private userId = "";
  constructor(private options: {
    main: () => BrowserWindow | null;
    load: (win: BrowserWindow, url: string) => Promise<unknown>;
    external: (url: string) => void;
    reveal: (target: FloatingChatTarget) => void;
    onEmpty?: () => void;
  }) {}

  account(scope: string) {
    let userId = "";
    if (scope) {
      const parsed: unknown = JSON.parse(scope);
      if (!Array.isArray(parsed) || parsed.length !== 2 ||
          typeof parsed[0] !== "string" || !/^[a-zA-Z0-9_-]{1,160}$/.test(parsed[0]) ||
          (parsed[1] !== null && (typeof parsed[1] !== "string" || !/^[a-zA-Z0-9_-]{1,160}$/.test(parsed[1])))) {
        throw new Error("Invalid chat account");
      }
      userId = parsed[0];
    }
    if (userId !== this.userId) this.clear();
    this.userId = userId;
  }

  async open(target: FloatingChatTarget) {
    const { userId, spaceId } = chatScope(target.scope);
    if (userId !== this.userId) throw new Error("The account changed");
    const main = this.options.main();
    if (!main || main.isDestroyed()) throw new Error("Open the main Mycellios window first");
    const url = floatingChatUrl(main.webContents.getURL(), target.botId);
    const key = JSON.stringify([new URL(url).origin, target.scope, target.botId]);
    const existing = this.windows.get(key);
    if (existing && !existing.win.isDestroyed()) {
      if (existing.win.isMinimized()) existing.win.restore();
      existing.win.show();
      existing.win.focus();
      return;
    }
    if (this.windows.size >= 6) throw new Error("Close a floating chat before opening another");
    const win = new BrowserWindow({
      width: 520, height: 760, minWidth: 380, minHeight: 420,
      title: "Mycellios · Chat", show: false,
      webPreferences: {
        preload: path.join(import.meta.dirname, "floating-chat-preload.cjs"),
        session: main.webContents.session,
        sandbox: true, contextIsolation: true, nodeIntegration: false,
        additionalArguments: ["--mycellios-chat-space=" + spaceId],
      },
    });
    const record = { win, target };
    this.windows.set(key, record);
    win.on("closed", () => {
      if (this.windows.get(key) !== record) return;
      this.windows.delete(key);
      if (!this.windows.size) this.options.onEmpty?.();
    });
    win.webContents.on("render-process-gone", () => { if (!win.isDestroyed()) win.destroy(); });
    win.webContents.setWindowOpenHandler(({ url: destination }) => {
      this.options.external(destination);
      return { action: "deny" };
    });
    win.webContents.on("will-navigate", (event, destination) => {
      if (new URL(destination).origin === new URL(url).origin) return;
      event.preventDefault();
      this.options.external(destination);
    });
    try {
      await this.options.load(win, url);
      if (!win.isDestroyed()) { win.show(); win.focus(); }
    } catch (error) {
      if (!win.isDestroyed()) win.destroy();
      throw error;
    }
  }

  returnToMain(sender: WebContents, frame: Electron.WebFrameMain | null) {
    const record = [...this.windows.values()].find(item =>
      !item.win.isDestroyed() && item.win.webContents === sender && frame === sender.mainFrame);
    if (!record) throw new Error("Untrusted chat window");
    this.options.reveal(record.target);
  }

  liveWindows() {
    return [...this.windows.values()].map(item => item.win).filter(win => !win.isDestroyed());
  }

  clear() {
    const windows = this.liveWindows();
    this.windows.clear();
    for (const win of windows) win.destroy();
  }
}
