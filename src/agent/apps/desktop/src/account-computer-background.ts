import { app } from "electron";
import type { BrowserWindow } from "electron";
import { AccountComputerConnection } from "./account-computer.js";

export function installAccountComputerBackground(
  options: ConstructorParameters<typeof AccountComputerConnection>[0] & {
    window(): BrowserWindow | null;
    /** The user asked to keep the app alive in the background instead of quitting. */
    keepRunningInBackground?: () => boolean;
    /** AppBehavior owns the explicit OS startup choice in the current shell. */
    manageLoginPreference?: boolean;
  },
) {
  let quitting = false;
  let login: boolean | undefined;
  const watched = new WeakSet<BrowserWindow>();
  const service = new AccountComputerConnection({
    ...options,
    changed: () => {
      if (quitting) return;
      const allowed = service.hasConsent();
      if (options.manageLoginPreference !== false && process.platform === "win32" && app.isPackaged && !process.env.RAKAZO_PERFORMANCE_USER_DATA && login !== allowed) {
        app.setLoginItemSettings({ openAtLogin: allowed, args: ["--background"] });
        login = allowed;
      }
      options.changed?.();
    },
  });
  const watch = () => {
    const win = options.window();
    if (!win || watched.has(win)) return;
    watched.add(win);
    win.on("close", (event) => {
      if (!quitting && options.keepRunningInBackground?.() === true && service.hasConsent()) {
        event.preventDefault();
        win.hide();
      }
    });
  };
  const timer = setInterval(watch, 1000);
  timer.unref();
  watch();
  service.start();
  app.once("before-quit", () => {
    quitting = true;
    clearInterval(timer);
    service.stop();
  });
  return service;
}
