import { EventEmitter } from "node:events";
import { beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_DESKTOP_COMPANIONS, DesktopCompanionPreferencesSchema, DesktopCompanionSnapshotSchema } from "@rakazo/contracts";
const mocks = vi.hoisted(() => ({ handlers: new Map<string, Function>(), listeners: new Map<string, Function>(), windows: [] as any[],
  write: vi.fn(async () => undefined), read: vi.fn(async () => null), displays: [{ id: 1, label: "Primary", size: { width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } }] }));
vi.mock("./setup-store.js", () => ({ readPrivateFile: mocks.read, writePrivateFile: mocks.write }));
vi.mock("electron", () => ({
  ipcMain: { handle: (key: string, fn: Function) => mocks.handlers.set(key, fn), on: (key: string, fn: Function) => mocks.listeners.set(key, fn), removeListener: vi.fn() },
  screen: { getAllDisplays: () => mocks.displays, getPrimaryDisplay: () => mocks.displays[0], getCursorScreenPoint: () => ({ x: 0, y: 0 }), on: vi.fn(), off: vi.fn() },
  BrowserWindow: class extends EventEmitter {
    webContents = Object.assign(new EventEmitter(), { send: vi.fn(), setWindowOpenHandler: vi.fn(), mainFrame: {} });
    destroyed = false; setBounds = vi.fn(); showInactive = vi.fn(); setIgnoreMouseEvents = vi.fn();
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
beforeEach(() => { mocks.windows.length = 0; mocks.handlers.clear(); mocks.listeners.clear(); mocks.write.mockClear(); mocks.read.mockResolvedValue(null); });
it("positions dock and island inside offset display work areas", () => {
  const area = { x: -1920, y: -200, width: 1920, height: 1040 };
  const bounds = companionBounds(area, "dock", DEFAULT_DESKTOP_COMPANIONS, 3);
  expect(bounds.x).toBe(-76); expect(bounds.y).toBeGreaterThanOrEqual(-200);
  const island = companionBounds(area, "island", DEFAULT_DESKTOP_COMPANIONS, 1);
  expect(island.x).toBe(-1130); expect(island.y).toBe(-192);
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
