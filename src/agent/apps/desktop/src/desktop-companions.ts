import { BrowserWindow, ipcMain, screen } from "electron";
import path from "node:path";
import { DEFAULT_DESKTOP_COMPANIONS, DesktopCompanionPreferencesSchema, DesktopCompanionSnapshotSchema,
  type DesktopCompanionPreferences, type DesktopCompanionSnapshot } from "@rakazo/contracts";
import { readPrivateFile, writePrivateFile } from "./setup-store.js";
import { validDesktopIcon } from "./appearance-settings.js";

export function companionBounds(area: { x: number; y: number; width: number; height: number }, kind: "dock" | "island", prefs: DesktopCompanionPreferences, count: number) {
  if (kind === "island") {
    const width = Math.min(area.width, Math.round(340 * prefs.island.width / 100));
    return { x: Math.round(area.x + (area.width - width) / 2), y: area.y + 8, width,
      height: Math.min(area.height, Math.round(64 * prefs.island.height / 100)) };
  }
  const horizontal = prefs.dock.edge === "bottom";
  const length = Math.min(horizontal ? area.width - 16 : area.height - 16, Math.max(72, Math.min(count, 8) * 58 + 16));
  const width = Math.max(1, Math.min(area.width, horizontal ? length : prefs.dock.results ? 270 : 72));
  const height = Math.max(1, Math.min(area.height, horizontal ? 72 : length));
  return { x: Math.round(prefs.dock.edge === "left" ? area.x + 4 : horizontal ? area.x + (area.width - width) / 2 : area.x + area.width - width - 4),
    y: Math.round(horizontal ? area.y + area.height - height - 4 : area.y + (area.height - height) / 2), width, height };
}

/** Owned, sandboxed OS windows. Only the app main frame publishes their scoped data. */
export async function installDesktopCompanions(options: {
  profile: string; allowed: (event: Electron.IpcMainInvokeEvent) => boolean;
  reveal: (target: { scope: string; botId: string }) => void;
}) {
  let prefs = structuredClone(DEFAULT_DESKTOP_COMPANIONS);
  let snapshot: DesktopCompanionSnapshot = { scope: "", theme: "light", agents: [] };
  const windows = new Map<string, BrowserWindow>();
  const expanded = new Set<string>();
  let queue = Promise.resolve();
  const file = path.join(options.profile, "desktop-companions.json");
  try { prefs = DesktopCompanionPreferencesSchema.parse(JSON.parse(await readPrivateFile(file, 65_536) ?? "null")); } catch { /* Safe defaults. */ }
  const payload = (kind: "dock" | "island") => ({ kind, prefs, snapshot: { ...snapshot,
    agents: snapshot.agents.filter(agent => kind === "island" || prefs.dock.agents[agent.id] !== false)
      .map(agent => ({ ...agent, result: kind === "dock" && prefs.dock.results ? agent.result : "" })) } });
  function sync() {
    const visible = new Set<string>();
    const displays = screen.getAllDisplays();
    for (const kind of ["island", "dock"] as const) {
      if (!prefs[kind].shown || !snapshot.scope || snapshot.agents.length === 0) continue;
      if (kind === "dock" && !payload(kind).snapshot.agents.length) continue;
      if (kind === "island" && !prefs.island.idle && !snapshot.agents.some(agent => agent.working || agent.unread)) continue;
      const selected = kind === "island" && prefs.island.additionalDisplays ? displays : [kind === "dock" && typeof prefs.dock.display === "number"
        ? displays.find(display => display.id === prefs.dock.display) ?? screen.getPrimaryDisplay() : screen.getPrimaryDisplay()];
      for (const display of selected) {
        const key = `${kind}:${display.id}`; visible.add(key);
        let win = windows.get(key);
        const data = payload(kind);
        if (!win || win.isDestroyed()) {
          win = new BrowserWindow({ ...companionBounds(display.workArea, kind, prefs, data.snapshot.agents.length),
            frame: false, transparent: true, resizable: false, maximizable: false, minimizable: false,
            alwaysOnTop: true, skipTaskbar: true, show: false, title: kind === "island" ? "Mycellios · Island" : "Mycellios · Dock",
            webPreferences: { preload: path.join(import.meta.dirname, "companion-preload.cjs"), sandbox: true, contextIsolation: true, nodeIntegration: false } });
          windows.set(key, win);
          win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
          win.webContents.on("will-navigate", event => event.preventDefault());
          win.webContents.once("did-finish-load", () => { if (!win!.isDestroyed()) { win!.webContents.send("companion.state", payload(kind)); win!.showInactive(); } });
          win.on("closed", () => { if (windows.get(key) === win) windows.delete(key); });
          void win.loadFile(path.join(import.meta.dirname, "companion.html")).catch(() => { if (!win!.isDestroyed()) win!.destroy(); });
        } else {
          win.setBounds(companionBounds(display.workArea, kind, prefs, data.snapshot.agents.length));
          if (kind === "dock" && !prefs.dock.autoHide) { win.setIgnoreMouseEvents(false); expanded.delete(key); }
          win.webContents.send("companion.state", data);
        }
      }
    }
    for (const [key, win] of windows) if (!visible.has(key)) { windows.delete(key); win.destroy(); }
  }
  const check = (event: Electron.IpcMainInvokeEvent) => { if (!options.allowed(event)) throw new Error("Desktop companions require the main app window"); };
  ipcMain.handle("desktop.companions.state", event => { check(event); return structuredClone(prefs); });
  ipcMain.handle("desktop.companions.displays", event => { check(event); return screen.getAllDisplays().map(display => ({ id: display.id, label: display.label || `${display.size.width} × ${display.size.height}` })); });
  ipcMain.handle("desktop.companions.save", (event, value: unknown) => {
    check(event); const next = DesktopCompanionPreferencesSchema.parse(value);
    const save = queue.then(async () => { await writePrivateFile(file, JSON.stringify(next)); prefs = next; sync(); return structuredClone(prefs); });
    queue = save.then(() => undefined, () => undefined); return save;
  });
  ipcMain.handle("desktop.companions.publish", (event, value: unknown) => {
    check(event); const next = DesktopCompanionSnapshotSchema.parse(value);
    if (next.agents.some(agent => agent.avatar && !validDesktopIcon(agent.avatar))) throw new Error("Invalid companion avatar");
    snapshot = next; sync();
  });
  const select = (event: Electron.IpcMainEvent, id: unknown) => {
    if (![...windows.values()].some(win => win.webContents === event.sender && event.senderFrame === event.sender.mainFrame)) return;
    if (typeof id !== "string" || !snapshot.agents.some(agent => agent.id === id)) return;
    options.reveal({ scope: snapshot.scope, botId: id });
  };
  ipcMain.on("companion.select", select);
  screen.on("display-added", sync); screen.on("display-removed", sync); screen.on("display-metrics-changed", sync);
  // Hidden transparent parts must not steal clicks from the application underneath.
  const hoverTimer = setInterval(() => {
    if (!prefs.dock.autoHide || !prefs.dock.shown) return;
    const point = screen.getCursorScreenPoint();
    for (const [key, win] of windows) {
      if (!key.startsWith("dock:") || win.isDestroyed()) continue;
      const b = win.getBounds();
      const inside = point.x >= b.x && point.x < b.x + b.width && point.y >= b.y && point.y < b.y + b.height;
      const atEdge = prefs.dock.edge === "left" ? point.x < b.x + 20 : prefs.dock.edge === "right" ? point.x > b.x + b.width - 20 : point.y > b.y + b.height - 20;
      const shown = inside && (expanded.has(key) || atEdge);
      win.setIgnoreMouseEvents(!shown, { forward: true });
      if (shown !== expanded.has(key)) {
        if (shown) expanded.add(key); else expanded.delete(key);
        win.webContents.send("companion.hover", shown);
      }
    }
  }, 120);
  hoverTimer.unref();
  return { clear: () => { snapshot = { scope: "", theme: "light", agents: [] }; sync(); },
    dispose: () => { clearInterval(hoverTimer); for (const win of windows.values()) win.destroy(); windows.clear();
      screen.off("display-added", sync); screen.off("display-removed", sync); screen.off("display-metrics-changed", sync);
      ipcMain.removeListener("companion.select", select); } };
}
