import type { IpcMainInvokeEvent, WebContents } from "electron";

type Target = { webContents: WebContents; url: string };
type Notice = {
  on(name: "click" | "close" | "failed" | "show", callback: () => void): unknown;
  show(): void;
  close(): void;
};
export type SystemNotificationInput = { title: string; body: string; tag: string; url: string; silent: boolean };

export function notificationSettingsUrl(platform: string): string | null {
  if (platform === "win32") return "ms-settings:notifications";
  if (platform === "darwin") return "x-apple.systempreferences:com.apple.Notifications-Settings.extension";
  return null;
}

function appBase(url: URL) {
  const index = url.pathname.search(/\/app(?:\/|$)/);
  return index < 0 ? url.pathname.replace(/\/$/, "") : url.pathname.slice(0, index);
}
export function notificationDestination(value: unknown, appUrl: string): string | null {
  if (typeof value !== "string" || value.length > 800) return null;
  try {
    const app = new URL(appUrl), url = new URL(value, app);
    const base = appBase(app);
    if (url.origin !== app.origin || url.username || url.password || url.hash ||
      !/^\/app(?:\/(?:g\/)?[a-zA-Z0-9_-]{1,160})?$/.test(url.pathname.slice(base.length)) ||
      !url.pathname.startsWith(`${base}/app`)) return null;
    for (const [key, id] of url.searchParams) {
      if (!["task", "noticeSpace", "m"].includes(key) || !/^[a-zA-Z0-9_-]{1,160}$/.test(id) || url.searchParams.getAll(key).length !== 1) return null;
    }
    return url.href;
  } catch { return null; }
}

/** Only the current app's main frame can show alerts or open a fixed OS settings page. */
export function createSystemNotifications(deps: {
  getTarget: () => Target | null; platform: string; supported: () => boolean;
  create: (input: SystemNotificationInput) => Notice;
  openSettings: (url: string) => Promise<unknown>;
  focus: (contents: WebContents) => void;
}) {
  const retained = new Map<string, Notice>();
  let owner: Target | null = null;
  const watched = new WeakSet<WebContents>();
  const clear = () => { const notices = [...retained.values()]; retained.clear(); for (const notice of notices) notice.close(); };
  function trusted(event: Pick<IpcMainInvokeEvent, "sender" | "senderFrame">): Target | null {
    try {
      const target = deps.getTarget();
      if (!target || target.webContents.isDestroyed() || event.sender !== target.webContents ||
        !event.senderFrame || event.senderFrame !== event.sender.mainFrame) return null;
      const app = new URL(target.url), sender = new URL(event.senderFrame.url);
      const safeTransport = app.protocol === "https:" || (app.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(app.hostname));
      if (!safeTransport || sender.origin !== app.origin ||
        !(sender.pathname === `${appBase(app)}/app` || sender.pathname.startsWith(`${appBase(app)}/app/`))) return null;
      return target;
    } catch { return null; }
  }
  return {
    clear(event: IpcMainInvokeEvent) {
      if (!trusted(event)) return;
      clear();
    },
    status(event: IpcMainInvokeEvent) {
      if (!trusted(event)) throw new Error("Notification access denied");
      return { supported: deps.supported(), settingsAvailable: notificationSettingsUrl(deps.platform) !== null };
    },
    async openSettings(event: IpcMainInvokeEvent) {
      if (!trusted(event)) return false;
      const url = notificationSettingsUrl(deps.platform);
      if (!url) return false;
      await deps.openSettings(url);
      return true;
    },
    async show(event: IpcMainInvokeEvent, value: unknown): Promise<void> {
      const target = trusted(event);
      if (!target || !deps.supported() || !value || typeof value !== "object") throw new Error("Notifications unavailable");
      const input = value as SystemNotificationInput;
      if (typeof input.title !== "string" || !input.title.trim() || input.title.length > 160 ||
        typeof input.body !== "string" || input.body.length > 280 || typeof input.tag !== "string" ||
        !input.tag || input.tag.length > 240 || typeof input.silent !== "boolean") throw new Error("Invalid notification");
      const url = notificationDestination(input.url, target.url);
      if (!url) throw new Error("Invalid notification destination");
      if (owner && (owner.webContents !== target.webContents || owner.url !== target.url)) clear();
      owner = target;
      if (!watched.has(target.webContents)) {
        watched.add(target.webContents);
        target.webContents.once("destroyed", () => { if (owner?.webContents === target.webContents) { clear(); owner = null; } });
      }
      const notice = deps.create({ ...input, url });
      retained.get(input.tag)?.close();
      retained.set(input.tag, notice);
      for (const [tag, old] of retained) {
        if (retained.size <= 50) break;
        retained.delete(tag);
        old.close();
      }
      const release = () => { if (retained.get(input.tag) === notice) retained.delete(input.tag); };
      notice.on("close", release);
      notice.on("click", () => {
        if (retained.get(input.tag) !== notice) return;
        release();
        const current = deps.getTarget();
        // Never navigate a replacement server/window using an old alert.
        if (current?.webContents !== target.webContents || current.url !== target.url || !trusted(event)) return;
        deps.focus(target.webContents);
        target.webContents.send("desktop.notifications.open", url);
        notice.close();
      });
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { release(); notice.close(); reject(new Error("Notification was not accepted by the system")); }, 5000);
        notice.on("show", () => { clearTimeout(timer); resolve(); });
        notice.on("failed", () => { clearTimeout(timer); release(); reject(new Error("The system could not show the notification")); });
        try { notice.show(); } catch (error) { clearTimeout(timer); release(); reject(error); }
      });
    },
  };
}
