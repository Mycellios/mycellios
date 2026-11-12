import { BrowserWindow, ipcMain, screen } from "electron";
import path from "node:path";
import { DEFAULT_DESKTOP_COMPANIONS, DesktopCompanionPreferencesSchema, DesktopCompanionSnapshotSchema,
  DesktopQuestionAnswerSchema, desktopQuestionAnswerText,
  type DesktopQuestionRequest, type DesktopQuestionResult,
  type DesktopCompanionPreferences, type DesktopCompanionSnapshot } from "@rakazo/contracts";
import { readPrivateFile, writePrivateFile } from "./setup-store.js";
import { validDesktopIcon } from "./appearance-settings.js";

export function companionBounds(area: { x: number; y: number; width: number; height: number }, kind: "dock" | "island", prefs: DesktopCompanionPreferences, count: number, expanded = false) {
  if (kind === "island") {
    // Four transparent pixels on each side leave a 212 x 32 detached capsule.
    const width = Math.min(area.width, Math.round((expanded ? 560 : 220) * prefs.island.width / 100));
    return { x: Math.round(area.x + (area.width - width) / 2), y: area.y + 2, width,
      height: Math.min(area.height, Math.round((expanded ? 400 : 40) * prefs.island.height / 100)) };
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
  reveal: (target: { scope: string; botId: string; respond?: boolean }) => void;
  requestReply?: (request: DesktopQuestionRequest) => void;
  openChat?: (target: { scope: string; botId: string }) => Promise<void>;
  scopeChanged?: (scope: string) => void;
}) {
  let prefs = structuredClone(DEFAULT_DESKTOP_COMPANIONS);
  let snapshot: DesktopCompanionSnapshot = { scope: "", theme: "light", agents: [] };
  const windows = new Map<string, BrowserWindow>();
  const expanded = new Set<string>();
  const islandExpanded = new Set<string>();
  const resolved = new Set<string>();
  const replies = new Map<string, { signature: string; settled: boolean; promise: Promise<DesktopQuestionResult["outcome"]>;
    finish: (outcome: DesktopQuestionResult["outcome"]) => void }>();
  function resetQuestions() {
    for (const reply of replies.values()) reply.finish("stale");
    replies.clear(); resolved.clear(); islandExpanded.clear();
  }
  const companionWindow = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) =>
    [...windows].find(([, win]) => win.webContents === event.sender && event.senderFrame === event.sender.mainFrame);

  let queue = Promise.resolve();
  const file = path.join(options.profile, "desktop-companions.json");
  try { prefs = DesktopCompanionPreferencesSchema.parse(JSON.parse(await readPrivateFile(file, 65_536) ?? "null")); } catch { /* Safe defaults. */ }
  const payload = (kind: "dock" | "island") => ({ kind, prefs, snapshot: { ...snapshot,
    questions: kind === "island" ? snapshot.questions?.filter(prompt => !resolved.has(prompt.id)) : [],
    agents: snapshot.agents.filter(agent => kind === "island" || prefs.dock.agents[agent.id] !== false)
      .map(agent => ({ ...agent, result: kind === "dock" && prefs.dock.results ? agent.result : "" })) } });
  function sync() {
    const visible = new Set<string>();
    const displays = screen.getAllDisplays();
    for (const kind of ["island", "dock"] as const) {
      if (!prefs[kind].shown || !snapshot.scope || snapshot.agents.length === 0) continue;
      if (kind === "dock" && !payload(kind).snapshot.agents.length) continue;
      if (kind === "island" && !prefs.island.idle && !payload(kind).snapshot.questions?.length && !snapshot.agents.some(agent => agent.working || agent.unread)) continue;
      const selected = kind === "island" && prefs.island.additionalDisplays ? displays : [kind === "dock" && typeof prefs.dock.display === "number"
        ? displays.find(display => display.id === prefs.dock.display) ?? screen.getPrimaryDisplay() : screen.getPrimaryDisplay()];
      for (const display of selected) {
        const key = `${kind}:${display.id}`; visible.add(key);
        let win = windows.get(key);
        const data = payload(kind);
        if (!win || win.isDestroyed()) {
          win = new BrowserWindow({ ...companionBounds(display.workArea, kind, prefs, data.snapshot.agents.length, islandExpanded.has(key)),
            frame: false, transparent: true, resizable: false, maximizable: false, minimizable: false,
            alwaysOnTop: true, skipTaskbar: true, show: false, focusable: kind !== "island", title: kind === "island" ? "Mycellios · Island" : "Mycellios · Dock",
            webPreferences: { preload: path.join(import.meta.dirname, "companion-preload.cjs"), sandbox: true, contextIsolation: true, nodeIntegration: false } });
          if (kind === "island") { win.setAlwaysOnTop(true, "status"); win.setHasShadow(false); }
          windows.set(key, win);
          win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
          win.webContents.on("will-navigate", event => event.preventDefault());
          win.webContents.once("did-finish-load", () => { if (!win!.isDestroyed()) { win!.webContents.send("companion.state", { ...payload(kind), expanded: islandExpanded.has(key) }); win!.showInactive(); } });
          win.on("closed", () => { if (windows.get(key) === win) windows.delete(key); });
          void win.loadFile(path.join(import.meta.dirname, "companion.html")).catch(() => { if (!win!.isDestroyed()) win!.destroy(); });
        } else {
          if (kind === "island") win.setFocusable(islandExpanded.has(key));
          win.setBounds(companionBounds(display.workArea, kind, prefs, data.snapshot.agents.length, islandExpanded.has(key)));
          if (kind === "dock" && !prefs.dock.autoHide) { win.setIgnoreMouseEvents(false); expanded.delete(key); }
          win.webContents.send("companion.state", { ...data, expanded: islandExpanded.has(key) });
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
    if (next.questions?.some(prompt => !next.agents.some(agent => agent.id === prompt.botId))) throw new Error("Question owner is unavailable");
    if (next.scope !== snapshot.scope) resetQuestions();
    options.scopeChanged?.(next.scope);
    snapshot = next; sync();
  });
  const expandIsland = (event: Electron.IpcMainEvent, open: unknown) => {
    const owned = companionWindow(event);
    if (!owned?.[0].startsWith("island:") || typeof open !== "boolean") return;
    open ? islandExpanded.add(owned[0]) : islandExpanded.delete(owned[0]);
    sync();
    if (open) owned[1].focus();
  };
  ipcMain.on("companion.expand", expandIsland);
  const openQuestion = (event: Electron.IpcMainEvent, id: unknown) => {
    if (!companionWindow(event)?.[0].startsWith("island:") || typeof id !== "string") return;
    const prompt = snapshot.questions?.find(prompt => prompt.id === id && !resolved.has(id));
    if (!prompt) return;
    islandExpanded.clear(); sync();
    options.reveal({ scope: snapshot.scope, botId: prompt.botId, respond: true });
  };
  ipcMain.on("companion.question.open", openQuestion);
  ipcMain.handle("companion.answer", (event, value: unknown) => {
    if (!companionWindow(event)?.[0].startsWith("island:") || !options.requestReply) throw new Error("Unavailable");
    const reply = DesktopQuestionAnswerSchema.parse(value);
    if (reply.scope !== snapshot.scope) throw new Error("The account changed");
    const prompt = snapshot.questions?.find(prompt => prompt.id === reply.promptId && !resolved.has(prompt.id));
    if (!prompt) return "stale";
    desktopQuestionAnswerText(prompt, reply);
    const signature = JSON.stringify(reply);
    const previous = replies.get(reply.nonce);
    if (previous) {
      if (previous.signature !== signature) throw new Error("The answer changed");
      return previous.promise;
    }
    if (replies.size >= 64) for (const [nonce, cached] of replies) { if (cached.settled) replies.delete(nonce); }
    if ([...replies.values()].filter(reply => !reply.settled).length >= 8) throw new Error("An answer is already being processed");
    let finish!: (outcome: DesktopQuestionResult["outcome"]) => void;
    const promise = new Promise<DesktopQuestionResult["outcome"]>(resolve => {
      const timer = setTimeout(() => finish("error"), 20_000); timer.unref();
      finish = outcome => { clearTimeout(timer); const cached = replies.get(reply.nonce); if (cached) cached.settled = true; resolve(outcome); };
    });
    replies.set(reply.nonce, { signature, promise, finish, settled: false });
    try { options.requestReply({ ...reply, prompt }); } catch { finish("error"); }
    return promise;
  });
  ipcMain.handle("desktop.companions.questionResult", (event, value: unknown) => {
    check(event);
    const result = value as DesktopQuestionResult | null;
    if (!result || result.scope !== snapshot.scope || typeof result.nonce !== "string" || !["ok", "stale", "error"].includes(result.outcome)) return;
    const reply = replies.get(result.nonce);
    if (!reply) return;
    if (result.outcome === "ok" || result.outcome === "stale") {
      const original = JSON.parse(reply.signature) as { promptId: string };
      resolved.add(original.promptId); if (resolved.size > 512) resolved.delete(resolved.values().next().value!); sync();
    }
    reply.finish(result.outcome);
  });
  ipcMain.handle("desktop.companions.openChat", (event, value: unknown) => {
    check(event);
    const target = value as { scope?: unknown; botId?: unknown } | null;
    if (!target || target.scope !== snapshot.scope || typeof target.botId !== "string" ||
        !snapshot.agents.some(agent => agent.id === target.botId) || !options.openChat) {
      throw new Error("This Mico is unavailable in the current Space");
    }
    return options.openChat({ scope: snapshot.scope, botId: target.botId });
  });
  const select = (event: Electron.IpcMainEvent, id: unknown) => {
    if (![...windows.values()].some(win => win.webContents === event.sender && event.senderFrame === event.sender.mainFrame)) return;
    if (typeof id !== "string" || !snapshot.agents.some(agent => agent.id === id)) return;
    const target = { scope: snapshot.scope, botId: id };
    if (prefs.dock.chatAction === "floating" && options.openChat) {
      void options.openChat(target).catch(() => options.reveal(target));
    } else options.reveal(target);
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
  return { clear: () => { resetQuestions(); options.scopeChanged?.(""); snapshot = { scope: "", theme: "light", agents: [] }; sync(); },
    dispose: () => { resetQuestions(); clearInterval(hoverTimer); for (const win of windows.values()) win.destroy(); windows.clear();
      screen.off("display-added", sync); screen.off("display-removed", sync); screen.off("display-metrics-changed", sync);
      ipcMain.removeListener("companion.select", select);
      ipcMain.removeListener("companion.expand", expandIsland);
      ipcMain.removeListener("companion.question.open", openQuestion);
      ipcMain.removeHandler?.("companion.answer"); ipcMain.removeHandler?.("desktop.companions.questionResult"); } };
}
