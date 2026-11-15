import path from "node:path";
import { BrowserWindow, type WebContents, type WebFrameMain } from "electron";

export const QUICK_ASK_ACCELERATOR = "CommandOrControl+Shift+Space";
const WIDTH = 640;
const HEIGHT = 220;
const BLUR_GRACE_MS = 500;
const BOT_ID = /^[a-zA-Z0-9_-]{1,160}$/;
const RESERVED_APP_SEGMENTS = new Set(["artifacts", "board", "g"]);

export function quickAskUrl(base: string): string {
  const url = new URL(base);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Invalid chat server");
  }
  const app = /\/app(?:\/|$)/.exec(url.pathname);
  const prefix = app ? url.pathname.slice(0, app.index) : url.pathname.replace(/\/$/, "");
  const segment = /\/app\/([^/]+)\/?$/.exec(url.pathname)?.[1];
  const botId =
    segment && !RESERVED_APP_SEGMENTS.has(segment) && BOT_ID.test(segment) ? segment : "";
  url.pathname = `${prefix}/quick-ask`;
  url.search = botId ? `bot=${botId}` : "";
  url.hash = "";
  return url.href;
}

export function quickAskConversationUrl(base: string, requested: string): string {
  const current = new URL(base);
  if (!["https:", "http:"].includes(current.protocol) || current.username || current.password) {
    throw new Error("Invalid chat server");
  }
  if (
    requested.length > 300 ||
    !requested.startsWith("/") ||
    requested.startsWith("//") ||
    requested.includes("\\") ||
    requested.includes("?") ||
    requested.includes("#") ||
    requested.includes("..")
  ) {
    throw new Error("Invalid conversation");
  }
  const app = /\/app(?:\/|$)/.exec(current.pathname);
  const prefix = app ? current.pathname.slice(0, app.index) : current.pathname.replace(/\/$/, "");
  const route =
    requested === prefix || requested.startsWith(`${prefix}/`)
      ? requested.slice(prefix.length) || "/"
      : requested;
  if (!/^\/app(?:\/[a-zA-Z0-9_-]{1,160})?$/.test(route)) throw new Error("Invalid conversation");
  const url = new URL(current.origin);
  url.pathname = `${prefix}${route}`;
  return url.href;
}

export function registerQuickAskShortcut(
  shortcuts: {
    register: (accelerator: string, callback: () => void) => boolean;
    unregister: (accelerator: string) => void;
  },
  onPress: () => void,
): boolean {
  shortcuts.unregister(QUICK_ASK_ACCELERATOR);
  return shortcuts.register(QUICK_ASK_ACCELERATOR, onPress);
}

export class QuickAsk {
  private window: BrowserWindow | null = null;
  private shownAt = 0;
  private origin = "";

  constructor(
    private readonly options: {
      main: () => BrowserWindow | null;
      load: (win: BrowserWindow, url: string) => Promise<unknown>;
      reveal: (win: BrowserWindow) => void;
      external: (url: string) => void;
      focusApp: () => void;
      now: () => number;
      display: () => { x: number; y: number; width: number; height: number };
    },
  ) {}

  toggle(): void {
    const current = this.window;
    if (current && !current.isDestroyed() && current.isVisible()) {
      current.hide();
      return;
    }
    void this.open().catch(() => {
      const main = this.options.main();
      if (main && !main.isDestroyed()) this.options.reveal(main);
    });
  }

  private async open(): Promise<void> {
    const main = this.options.main();
    if (!main || main.isDestroyed()) return;
    const target = quickAskUrl(main.webContents.getURL());
    const origin = new URL(target).origin;
    if (this.origin && this.origin !== origin) this.reset();
    if (!this.window || this.window.isDestroyed()) {
      this.window = this.create(main, target);
    }
    const win = this.window;
    this.origin = origin;
    this.place(win);
    try {
      await this.options.load(win, target);
    } catch (error) {
      if (!win.isDestroyed()) win.destroy();
      throw error;
    }
    if (win.isDestroyed() || this.window !== win) return;
    this.shownAt = this.options.now();
    this.options.focusApp();
    win.show();
    win.focus();
    win.webContents.focus();
  }

  private create(main: BrowserWindow, target: string): BrowserWindow {
    const win = new BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
      show: false,
      frame: false,
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      title: "Quick ask",
      webPreferences: {
        preload: path.join(import.meta.dirname, "quick-ask-preload.cjs"),
        session: main.webContents.session,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    win.setAlwaysOnTop(true, "floating");
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.on("blur", () => {
      if (
        this.shownAt === 0 ||
        this.options.now() - this.shownAt <= BLUR_GRACE_MS ||
        win.isDestroyed()
      )
        return;
      win.hide();
    });
    win.webContents.setWindowOpenHandler(({ url }) => {
      this.options.external(url);
      return { action: "deny" };
    });
    win.webContents.on("will-navigate", (event, destination) => {
      let sameOrigin = false;
      try {
        sameOrigin = new URL(destination).origin === new URL(target).origin;
      } catch {
        sameOrigin = false;
      }
      if (sameOrigin) return;
      event.preventDefault();
      this.options.external(destination);
    });
    win.on("closed", () => {
      if (this.window === win) this.window = null;
    });
    return win;
  }

  private place(win: BrowserWindow): void {
    const area = this.options.display();
    win.setBounds({
      x: Math.round(area.x + (area.width - WIDTH) / 2),
      y: Math.round(area.y + area.height / 4),
      width: WIDTH,
      height: HEIGHT,
    });
  }

  private owned(sender: WebContents, frame: WebFrameMain | null): BrowserWindow {
    const win = this.window;
    if (
      !win ||
      win.isDestroyed() ||
      win.webContents !== sender ||
      frame !== win.webContents.mainFrame
    ) {
      throw new Error("Untrusted quick ask window");
    }
    return win;
  }

  closeFrom(sender: WebContents, frame: WebFrameMain | null): void {
    const win = this.owned(sender, frame);
    if (!win.isDestroyed()) win.hide();
  }

  async sent(sender: WebContents, frame: WebFrameMain | null, requested: unknown): Promise<void> {
    this.owned(sender, frame);
    const main = this.options.main();
    if (!main || main.isDestroyed()) throw new Error("Open the main Mycellios window first");
    if (typeof requested !== "string") throw new Error("Invalid conversation");
    const destination = quickAskConversationUrl(main.webContents.getURL(), requested);
    if (!this.window?.isDestroyed()) this.window?.hide();
    this.options.reveal(main);
    await this.options.load(main, destination);
  }

  reset(): void {
    const win = this.window;
    this.window = null;
    this.origin = "";
    if (win && !win.isDestroyed()) win.destroy();
  }
}
