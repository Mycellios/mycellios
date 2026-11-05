import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ allowed: true, online: true, changed: () => {}, stopped: 0 }));
vi.mock("./account-computer.js", () => ({
  AccountComputerConnection: class {
    constructor(options: any) {
      state.changed = options.changed;
    }
    hasConsent() {
      return state.allowed;
    }
    online() {
      return state.online;
    }
    start() {
      state.changed();
    }
    stop() {
      state.stopped++;
      state.changed();
    }
    refresh() {
      return Promise.resolve();
    }
  },
}));
vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events");
  const app = Object.assign(new EventEmitter(), {
    isPackaged: true,
    getFileIcon: vi.fn(async () => ({})),
    setLoginItemSettings: vi.fn(),
    quit: vi.fn(),
  });
  class Tray extends EventEmitter {
    destroyed = false;
    isDestroyed = () => this.destroyed;
    setToolTip = vi.fn(() => { if (this.destroyed) throw new Error("Tray is destroyed"); });
    setContextMenu = vi.fn();
    destroy = vi.fn(() => { this.destroyed = true; });
  }
  return { app, Tray, Menu: { buildFromTemplate: vi.fn((x) => x) } };
});
import { app } from "electron";
import { installAccountComputerBackground } from "./account-computer-background.js";
afterEach(() => {
  app.emit("before-quit");
  app.removeAllListeners();
  vi.useRealTimers();
});
it("keeps a consented window and its draft alive in the background, with explicit quit and revocation", async () => {
  vi.useFakeTimers();
  state.allowed = true;
  state.online = true;
  state.stopped = 0;
  const window = Object.assign(new EventEmitter(), {
    hide: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
  });
  installAccountComputerBackground({
    profile: "fixture",
    host: {} as any,
    localUrl: "http://127.0.0.1",
    localToken: "fixture",
    context: async () => null,
    consentScope: () => "fixture",
    window: () => window as any,
  });
  const close = { preventDefault: vi.fn() };
  window.emit("close", close);
  expect(close.preventDefault).toHaveBeenCalledOnce();
  expect(window.hide).toHaveBeenCalledOnce();
  if (process.platform === "win32")
    expect(app.setLoginItemSettings).toHaveBeenLastCalledWith({
      openAtLogin: true,
      args: ["--background"],
    });
  state.allowed = false;
  state.changed();
  if (process.platform === "win32")
    expect(app.setLoginItemSettings).toHaveBeenLastCalledWith({
      openAtLogin: false,
      args: ["--background"],
    });
  const revokedClose = { preventDefault: vi.fn() };
  window.emit("close", revokedClose);
  expect(revokedClose.preventDefault).not.toHaveBeenCalled();
  state.allowed = true;
  app.emit("before-quit");
  const quitClose = { preventDefault: vi.fn() };
  window.emit("close", quitClose);
  expect(quitClose.preventDefault).not.toHaveBeenCalled();
  expect(state.stopped).toBeGreaterThan(0);
});

it("ignores synchronous and late connection changes after the tray has shut down", async () => {
  vi.useFakeTimers();
  const changed = vi.fn();
  const service = installAccountComputerBackground({
    profile: "shutdown-fixture", host: {} as any, localUrl: "http://127.0.0.1",
    localToken: "fixture", context: async () => null, consentScope: () => "fixture",
    window: () => null, changed,
  });
  await Promise.resolve();
  changed.mockClear();
  const startupCalls = vi.mocked(app.setLoginItemSettings).mock.calls.length;
  expect(() => app.emit("before-quit")).not.toThrow();
  state.allowed = !state.allowed;
  expect(() => service.stop()).not.toThrow();
  expect(() => state.changed()).not.toThrow();
  expect(changed).not.toHaveBeenCalled();
  expect(vi.mocked(app.setLoginItemSettings).mock.calls).toHaveLength(startupCalls);
});
