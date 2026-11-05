import { app, Menu, Tray } from "electron";
import type { BrowserWindow } from "electron";
import { AccountComputerConnection } from "./account-computer.js";

export function installAccountComputerBackground(
  options: ConstructorParameters<typeof AccountComputerConnection>[0] & {
    window(): BrowserWindow | null;
  },
) {
  let quitting = false,
    tray: Tray | undefined,
    login: boolean | undefined;
  const watched = new WeakSet<BrowserWindow>();
  const service = new AccountComputerConnection({
    ...options,
    changed: () => {
      if (quitting) return;
      const allowed = service.hasConsent();
      if (process.platform === "win32" && app.isPackaged && login !== allowed) {
        app.setLoginItemSettings({ openAtLogin: allowed, args: ["--background"] });
        login = allowed;
      }
      if (tray && !tray.isDestroyed())
        tray.setToolTip(
          service.online() ? "Mycellios — PC connected" : "Mycellios — PC disconnected",
        );
      options.changed?.();
    },
  });
  const show = () => {
    const win = options.window();
    if (win) {
      win.show();
      win.focus();
    } else app.emit("activate");
  };
  void app
    .getFileIcon(process.execPath, { size: "small" })
    .then((icon) => {
      if (quitting) return;
      tray = new Tray(icon);
      tray.setToolTip("Mycellios");
      tray.setContextMenu(
        Menu.buildFromTemplate([
          { label: "Open Mycellios", click: show },
          { type: "separator" },
          { label: "Quit (disconnect this PC)", click: () => app.quit() },
        ]),
      );
      tray.on("double-click", show);
    })
    .catch(() => undefined);
  const watch = () => {
    const win = options.window();
    if (!win || watched.has(win)) return;
    watched.add(win);
    win.on("close", (event) => {
      if (!quitting && service.hasConsent()) {
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
    const closingTray = tray;
    tray = undefined;
    if (closingTray && !closingTray.isDestroyed()) closingTray.destroy();
  });
  return service;
}
