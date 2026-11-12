import { EventEmitter } from "node:events";
import { beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_DESKTOP_COMPANIONS, DesktopCompanionPreferencesSchema, DesktopCompanionSnapshotSchema } from "@rakazo/contracts";
const mocks = vi.hoisted(() => ({ cursor: { x: 0, y: 0 }, handlers: new Map<string, Function>(), listeners: new Map<string, Function>(), windows: [] as any[],
  write: vi.fn(async () => undefined), read: vi.fn(async () => null), displays: [{ id: 1, label: "Primary", size: { width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } }] }));
vi.mock("./setup-store.js", () => ({ readPrivateFile: mocks.read, writePrivateFile: mocks.write }));
vi.mock("electron", () => ({
  ipcMain: { handle: (key: string, fn: Function) => mocks.handlers.set(key, fn), on: (key: string, fn: Function) => mocks.listeners.set(key, fn), removeListener: vi.fn() },
  screen: { getAllDisplays: () => mocks.displays, getPrimaryDisplay: () => mocks.displays[0], getCursorScreenPoint: () => mocks.cursor, getDisplayMatching: () => mocks.displays[0], on: vi.fn(), off: vi.fn() },
  BrowserWindow: class extends EventEmitter {
    webContents = Object.assign(new EventEmitter(), { send: vi.fn(), setWindowOpenHandler: vi.fn(), setZoomFactor: vi.fn(), mainFrame: {} });
    destroyed = false; setAlwaysOnTop = vi.fn(); setHasShadow = vi.fn(); setFocusable = vi.fn(); focus = vi.fn(); setBounds = vi.fn(); showInactive = vi.fn(); setIgnoreMouseEvents = vi.fn();
    isFocused() { return false; }
    getBounds() { return this.options; }
    constructor(public options: any) { super(); mocks.windows.push(this); }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; this.emit("closed"); }
    async loadFile() { this.webContents.emit("did-finish-load"); }
  },
}));
import { companionBounds, installDesktopCompanions } from "./desktop-companions";
const good = { trusted: true };
const snapshot = { scope: "user:space", theme: "light", agents: [{ id: "bot-a", name: "Mico", color: "#3f9f78", status: "Working", result: "Private preview", working: true, unread: false }] };
const call = (key: string, value?: unknown, event = good) => mocks.handlers.get(`desktop.companions.${key}`)!(event, value);
beforeEach(() => { mocks.cursor = { x: 0, y: 0 }; mocks.windows.length = 0; mocks.handlers.clear(); mocks.listeners.clear(); mocks.write.mockClear(); mocks.read.mockResolvedValue(null); });
it("positions dock and island inside offset display work areas", () => {
  const area = { x: -1920, y: -200, width: 1920, height: 1040 };
  const bounds = companionBounds(area, "dock", DEFAULT_DESKTOP_COMPANIONS, 3);
  expect(bounds.x).toBe(-76); expect(bounds.y).toBeGreaterThanOrEqual(-200);
  const island = companionBounds(area, "island", DEFAULT_DESKTOP_COMPANIONS, 1);
  expect(island.x).toBe(-1070); expect(island.y).toBe(-198);
  expect(island.width).toBe(220); expect(island.height).toBe(40);
});
it("requires a trusted main frame, validates payloads and never exposes native capabilities to an external page", async () => {
  const host = await installDesktopCompanions({ profile: "test", allowed: e => e === good, reveal: vi.fn() });
  expect(() => call("state", undefined, {} as typeof good)).toThrow();
  expect(() => call("publish", { ...snapshot, agents: [{ ...snapshot.agents[0], color: "url(https://external)" }] })).toThrow();
  expect(DesktopCompanionSnapshotSchema.safeParse({ ...snapshot, agents: Array(101).fill(snapshot.agents[0]) }).success).toBe(false);
  expect(DesktopCompanionPreferencesSchema.safeParse({ ...DEFAULT_DESKTOP_COMPANIONS, island: { ...DEFAULT_DESKTOP_COMPANIONS.island, width: 0 } }).success).toBe(false);
  host.dispose();
});
it("publishes only opted-in previews and accepts selections only from its own windows", async () => {
  const reveal = vi.fn(); const host = await installDesktopCompanions({ profile: "test", allowed: e => e === good, reveal });
  await call("save", { ...DEFAULT_DESKTOP_COMPANIONS, dock: { ...DEFAULT_DESKTOP_COMPANIONS.dock, shown: true } });
  call("publish", snapshot);
  const window = mocks.windows[0]!;
  expect(window.options.webPreferences).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false });
  expect(window.webContents.send.mock.calls.at(-1)[1].snapshot.agents[0].result).toBe("");
  mocks.listeners.get("companion.select")!({ sender: {}, senderFrame: null }, "bot-a"); expect(reveal).not.toHaveBeenCalled();
  mocks.listeners.get("companion.select")!({ sender: window.webContents, senderFrame: window.webContents.mainFrame }, "not-owned"); expect(reveal).not.toHaveBeenCalled();
  mocks.listeners.get("companion.select")!({ sender: window.webContents, senderFrame: window.webContents.mainFrame }, "bot-a");
  expect(reveal).toHaveBeenCalledWith({ scope: "user:space", botId: "bot-a" });
  host.clear(); expect(window.destroyed).toBe(true); host.dispose();
});
it("keeps a failed save out of the active native state and creates no empty dock", async () => {
  const host = await installDesktopCompanions({ profile: "test", allowed: e => e === good, reveal: vi.fn() });
  mocks.write.mockRejectedValueOnce(new Error("disk"));
  await expect(call("save", { ...DEFAULT_DESKTOP_COMPANIONS, dock: { ...DEFAULT_DESKTOP_COMPANIONS.dock, shown: true } })).rejects.toThrow("disk");
  expect(call("state").dock.shown).toBe(false);
  await call("save", { ...DEFAULT_DESKTOP_COMPANIONS, dock: { ...DEFAULT_DESKTOP_COMPANIONS.dock, shown: true, agents: { "bot-a": false } } });
  call("publish", snapshot); expect(mocks.windows).toHaveLength(0); host.dispose();
});

it("opens only a Mico in the current snapshot and supports the floating dock preference", async () => {
  const openChat = vi.fn(async () => undefined);
  const host = await installDesktopCompanions({ profile: "test", allowed: event => event === good, reveal: vi.fn(), openChat });
  call("publish", snapshot);
  await call("openChat", { scope: snapshot.scope, botId: "bot-a" });
  expect(openChat).toHaveBeenCalledWith({ scope: snapshot.scope, botId: "bot-a" });
  expect(() => call("openChat", { scope: "another-user", botId: "bot-a" })).toThrow();
  expect(() => call("openChat", { scope: snapshot.scope, botId: "other-bot" })).toThrow();
  expect(DesktopCompanionPreferencesSchema.parse({
    ...DEFAULT_DESKTOP_COMPANIONS,
    dock: { shown: false, edge: "right", display: "primary", autoHide: false, edgeStrip: true, results: false, agents: {} },
  }).dock.chatAction).toBe("main");
  host.dispose();
});

const question = { id: "run:message:0", botId: "bot-a", runId: "run", messageId: "message", legacy: true,
  questions: [{ id: "q", question: "Which city?", options: [{ id: "a", label: "Paris" }, { id: "b", label: "London" }] }] };
const answer = { scope: snapshot.scope, promptId: question.id, nonce: "reply-1", answers: [{ questionId: "q", optionIds: ["a"], text: "" }] };
async function islandHost() {
  const requestReply = vi.fn(); const reveal = vi.fn();
  const host = await installDesktopCompanions({ profile: "test", allowed: e => e === good, reveal, requestReply });
  await call("save", { ...DEFAULT_DESKTOP_COMPANIONS, island: { ...DEFAULT_DESKTOP_COMPANIONS.island, shown: true } });
  call("publish", { ...snapshot, questions: [question] });
  const window = mocks.windows[0]!;
  const event = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
  return { host, requestReply, reveal, window, event };
}
it("answers only from its own island, validates scope/options and resolves through the trusted app", async () => {
  const test = await islandHost(); const reply = mocks.handlers.get("companion.answer")!;
  try {
    expect(() => reply({ sender: {}, senderFrame: null }, answer)).toThrow();
    expect(() => reply(test.event, { ...answer, scope: "foreign" })).toThrow();
    expect(() => reply(test.event, { ...answer, answers: [{ questionId: "q", optionIds: ["admin"], text: "" }] })).toThrow();
    const pending = reply(test.event, answer);
    expect(test.requestReply).toHaveBeenCalledExactlyOnceWith({ ...answer, prompt: question });
    expect(reply(test.event, answer)).toBe(pending);
    expect(() => reply(test.event, { ...answer, answers: [{ questionId: "q", optionIds: ["b"], text: "" }] })).toThrow();
    expect(() => call("questionResult", { nonce: answer.nonce, scope: snapshot.scope, outcome: "ok" }, {} as typeof good)).toThrow();
    call("questionResult", { nonce: answer.nonce, scope: snapshot.scope, outcome: "ok" });
    expect(await pending).toBe("ok");
    expect(test.window.webContents.send.mock.calls.at(-1)[1].snapshot.questions).toEqual([]);
  } finally { test.host.dispose(); }
});
it("collapses with Later without discarding the question and opens the correct chat", async () => {
  const test = await islandHost();
  try {
    mocks.listeners.get("companion.expand")!(test.event, true);
    expect(test.window.setBounds.mock.calls.at(-1)[0]).toMatchObject({ width: 560, height: 400 });
    mocks.listeners.get("companion.expand")!(test.event, false);
    expect(test.window.setBounds.mock.calls.at(-1)[0]).toMatchObject({ width: 220, height: 40 });
    expect(test.window.webContents.send.mock.calls.at(-1)[1].snapshot.questions).toHaveLength(1);
    expect(test.requestReply).not.toHaveBeenCalled();
    mocks.listeners.get("companion.question.open")!(test.event, question.id);
    expect(test.reveal).toHaveBeenCalledWith({ scope: snapshot.scope, botId: "bot-a", respond: true });
  } finally { test.host.dispose(); }
});
it("revokes in-flight replies on account exit and rejects foreign question owners", async () => {
  const test = await islandHost();
  try {
    expect(() => call("publish", { ...snapshot, questions: [{ ...question, botId: "foreign" }] })).toThrow();
    const pending = mocks.handlers.get("companion.answer")!(test.event, answer);
    test.host.clear(); expect(await pending).toBe("stale");
    call("questionResult", { nonce: answer.nonce, scope: snapshot.scope, outcome: "ok" });
    expect(test.window.destroyed).toBe(true);
  } finally { test.host.dispose(); }
});

it("does not exhaust the in-flight limit after successive completed answers", async () => {
  const test = await islandHost();
  try {
    for (let index = 0; index < 12; index++) {
      const nextQuestion = { ...question, id: `question-${index}` };
      call("publish", { ...snapshot, questions: [nextQuestion] });
      const nextAnswer = { ...answer, nonce: `nonce-${index}`, promptId: nextQuestion.id };
      const pending = mocks.handlers.get("companion.answer")!(test.event, nextAnswer);
      call("questionResult", { nonce: nextAnswer.nonce, scope: snapshot.scope, outcome: "ok" });
      expect(await pending).toBe("ok");
    }
  } finally { test.host.dispose(); }
});

it("upgrades old island preferences without losing size or behavior", () => {
  const legacy = { ...DEFAULT_DESKTOP_COMPANIONS, island: { shown: true, idle: false, additionalDisplays: true, width: 125, height: 90 } };
  expect(DesktopCompanionPreferencesSchema.parse(legacy).island).toEqual({ ...legacy.island, scopes: {}, futureScopes: true });
});
it("honors scope filters without hiding the dock or admitting another scope's Micos", async () => {
  const host = await installDesktopCompanions({ profile: "test", allowed: event => event === good, reveal: vi.fn() });
  try {
    const prefs = { ...DEFAULT_DESKTOP_COMPANIONS, island: { ...DEFAULT_DESKTOP_COMPANIONS.island, shown: true, scopes: { [snapshot.scope]: false } }, dock: { ...DEFAULT_DESKTOP_COMPANIONS.dock, shown: true } };
    await call("save", prefs); call("publish", snapshot);
    expect(mocks.windows.filter(w => !w.destroyed).map(w => w.options.title)).toEqual(["Mycellios · Dock"]);
    await call("save", { ...prefs, island: { ...prefs.island, scopes: { [snapshot.scope]: true }, futureScopes: false } });
    expect(mocks.windows.filter(w => !w.destroyed)).toHaveLength(2);
    call("publish", { ...snapshot, scope: "owner:new-space" });
    expect(mocks.windows.filter(w => !w.destroyed).map(w => w.options.title)).toEqual(["Mycellios · Dock"]);
  } finally { host.dispose(); }
});
it("keeps an idle branded island without Micos and closes it on sign-out", async () => {
  const host = await installDesktopCompanions({ profile: "test", allowed: event => event === good, reveal: vi.fn() });
  try {
    await call("save", { ...DEFAULT_DESKTOP_COMPANIONS, island: { ...DEFAULT_DESKTOP_COMPANIONS.island, shown: true } });
    call("publish", { ...snapshot, agents: [] }); expect(mocks.windows.filter(w => !w.destroyed)).toHaveLength(1);
    call("publish", { ...snapshot, scope: "", agents: [] }); expect(mocks.windows.filter(w => !w.destroyed)).toHaveLength(0);
  } finally { host.dispose(); }
});

it("creates and removes island windows for additional displays without leaving stale overlays", async () => {
  const { screen } = await import("electron");
  const second = { ...mocks.displays[0]!, id: 2, label: "External", workArea: { x: 1920, y: 0, width: 1280, height: 900 } };
  mocks.displays.push(second);
  const host = await installDesktopCompanions({ profile: "test", allowed: event => event === good, reveal: vi.fn() });
  try {
    await call("save", { ...DEFAULT_DESKTOP_COMPANIONS, island: { ...DEFAULT_DESKTOP_COMPANIONS.island, shown: true, additionalDisplays: true } });
    call("publish", snapshot); expect(mocks.windows.filter(w => !w.destroyed)).toHaveLength(2);
    mocks.displays.pop();
    const removed = (screen.on as any).mock.calls.filter(([name]: [string]) => name === "display-removed").at(-1)[1]; removed();
    expect(mocks.windows.filter(w => !w.destroyed)).toHaveLength(1);
  } finally { if (mocks.displays.some(display => display.id === 2)) mocks.displays.pop(); host.dispose(); }
});

it("defaults legacy dock controls and rejects out-of-range size and position", () => {
  const { layer, size, offset, ...legacy } = DEFAULT_DESKTOP_COMPANIONS.dock;
  expect(DesktopCompanionPreferencesSchema.parse({ ...DEFAULT_DESKTOP_COMPANIONS, dock: legacy }).dock).toMatchObject({ layer: "always", size: 100, offset: 50 });
  for (const dock of [{ size: 151 }, { offset: -1 }, { layer: "external" }]) expect(DesktopCompanionPreferencesSchema.safeParse({ ...DEFAULT_DESKTOP_COMPANIONS, dock: { ...legacy, ...dock } }).success).toBe(false);
});
it("scales dock bounds to integer pixels and clamps both ends to the work area", () => {
  const area = { x: -1000, y: 200, width: 1000, height: 700 };
  for (const edge of ["left", "right", "bottom"] as const) for (const offset of [0, 100]) {
    const b = companionBounds(area, "dock", { ...DEFAULT_DESKTOP_COMPANIONS, dock: { ...DEFAULT_DESKTOP_COMPANIONS.dock, size: 101, edge, offset } }, 8);
    expect(Object.values(b).every(Number.isInteger)).toBe(true);
    expect(b.x).toBeGreaterThanOrEqual(area.x); expect(b.y).toBeGreaterThanOrEqual(area.y);
    expect(b.x + b.width).toBeLessThanOrEqual(area.x + area.width); expect(b.y + b.height).toBeLessThanOrEqual(area.y + area.height);
  }
});
it("follows the main window display and hides app-only docks when another app is active", async () => {
  vi.useFakeTimers(); let focused = true;
  const main = { isDestroyed: () => false, isVisible: () => true, isMinimized: () => false, isFocused: () => focused, getBounds: () => ({ x: 10, y: 10, width: 800, height: 600 }) };
  const host = await installDesktopCompanions({ profile: "test", allowed: e => e === good, reveal: vi.fn(), mainWindow: () => main as any });
  try {
    await call("save", { ...DEFAULT_DESKTOP_COMPANIONS, dock: { ...DEFAULT_DESKTOP_COMPANIONS.dock, shown: true, display: "window", layer: "app" } }); call("publish", snapshot);
    expect(mocks.windows.at(-1).options.alwaysOnTop).toBe(true);
    expect(mocks.windows.at(-1).webContents.setZoomFactor).toHaveBeenCalledWith(1);
    focused = false; await vi.advanceTimersByTimeAsync(120); expect(mocks.windows.every(w => w.destroyed)).toBe(true);
    await call("save", { ...call("state"), dock: { ...call("state").dock, layer: "always", display: 999 } });
    expect(mocks.windows.at(-1).destroyed).toBe(false); expect(mocks.windows.at(-1).options.x).toBeGreaterThan(0);
  } finally { host.dispose(); vi.useRealTimers(); }
});
it("rejects foreign drag events and persists keyboard movement without losing other preferences", async () => {
  const host = await installDesktopCompanions({ profile: "test", allowed: e => e === good, reveal: vi.fn() });
  try {
    await call("save", { ...DEFAULT_DESKTOP_COMPANIONS, dock: { ...DEFAULT_DESKTOP_COMPANIONS.dock, shown: true, size: 125 } }); call("publish", snapshot);
    const win = mocks.windows.at(-1), event = { sender: win.webContents, senderFrame: win.webContents.mainFrame };
    const drag = mocks.listeners.get("companion.dock.drag")!; mocks.write.mockClear();
    drag({ sender: {}, senderFrame: null }, "next"); await Promise.resolve(); expect(mocks.write).not.toHaveBeenCalled();
    drag(event, "next"); await new Promise(resolve => setTimeout(resolve, 0));
    expect(call("state").dock).toMatchObject({ offset: 55, size: 125 });
    await call("save", { ...call("state"), dock: { ...call("state").dock, offset: 50, size: 126 } });
    expect(call("state").dock).toMatchObject({ offset: 55, size: 126 });
    mocks.write.mockRejectedValueOnce(Error("disk")); drag(event, "next"); await new Promise(resolve => setTimeout(resolve, 0));
    expect(call("state").dock.offset).toBe(55); expect(win.webContents.send).toHaveBeenCalledWith("companion.dock.saved", false);
    mocks.cursor = { x: win.options.x, y: win.options.y }; drag(event, "start"); mocks.cursor.y += 100; drag(event, "move");
    expect(call("state").dock.offset).toBe(55); drag(event, "end"); await new Promise(resolve => setTimeout(resolve, 0));
    expect(call("state").dock.offset).toBeGreaterThan(55);
  } finally { host.dispose(); }
});
it("shows only newly completed results briefly and never replays old results after a scope change", async () => {
  vi.useFakeTimers(); const host = await installDesktopCompanions({ profile: "test", allowed: e => e === good, reveal: vi.fn() });
  try {
    await call("save", { ...DEFAULT_DESKTOP_COMPANIONS, dock: { ...DEFAULT_DESKTOP_COMPANIONS.dock, shown: true, results: true } });
    const done = { ...snapshot, agents: [{ ...snapshot.agents[0]!, working: false }] }; call("publish", done);
    const win = mocks.windows.at(-1), last = () => win.webContents.send.mock.calls.filter(([channel]: [string]) => channel === "companion.state").at(-1)[1];
    expect(last().snapshot.agents[0].result).toBe(""); call("publish", snapshot); call("publish", done);
    expect(last().snapshot.agents[0].result).toBe("Private preview");
    await vi.advanceTimersByTimeAsync(8200); expect(last().snapshot.agents[0].result).toBe("");
    call("publish", { ...done, scope: "other:space" }); expect(last().snapshot.agents[0].result).toBe("");
  } finally { host.dispose(); vi.useRealTimers(); }
});

it("rejects hidden Mico selections while retaining other dock entries", async () => {
  const reveal = vi.fn(), host = await installDesktopCompanions({ profile: "test", allowed: e => e === good, reveal });
  try {
    await call("save", { ...DEFAULT_DESKTOP_COMPANIONS, dock: { ...DEFAULT_DESKTOP_COMPANIONS.dock, shown: true, agents: { "bot-a": false } } });
    call("publish", { ...snapshot, agents: [...snapshot.agents, { ...snapshot.agents[0]!, id: "bot-b" }] });
    const win = mocks.windows.at(-1), event = { sender: win.webContents, senderFrame: win.webContents.mainFrame };
    mocks.listeners.get("companion.select")!(event, "bot-a"); expect(reveal).not.toHaveBeenCalled();
    mocks.listeners.get("companion.select")!(event, "bot-b"); expect(reveal).toHaveBeenCalledWith({ scope: snapshot.scope, botId: "bot-b" });
  } finally { host.dispose(); }
});
