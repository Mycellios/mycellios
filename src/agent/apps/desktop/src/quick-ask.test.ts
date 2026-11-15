import { EventEmitter } from "node:events";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ windows: [] as MockWindow[] }));

vi.mock("electron", () => ({
  BrowserWindow: class extends EventEmitter {
    destroyed = false;
    visible = false;
    webContents = Object.assign(new EventEmitter(), {
      session: { id: "server" },
      mainFrame: { id: "main" },
      setWindowOpenHandler: vi.fn(),
      getURL: () => "https://mycellios.example/agent/app/mico?secret=unused",
      focus: vi.fn(),
    });
    show = vi.fn(() => {
      this.visible = true;
    });
    hide = vi.fn(() => {
      this.visible = false;
    });
    focus = vi.fn();
    setBounds = vi.fn();
    setAlwaysOnTop = vi.fn();
    setVisibleOnAllWorkspaces = vi.fn();
    constructor(public options: MockWindow["options"]) {
      super();
      state.windows.push(this);
    }
    isDestroyed() {
      return this.destroyed;
    }
    isVisible() {
      return this.visible;
    }
    destroy() {
      this.destroyed = true;
      this.emit("closed");
    }
  },
}));

type MockWindow = {
  destroyed: boolean;
  visible: boolean;
  options: {
    webPreferences: {
      preload: string;
      session: object;
      sandbox: boolean;
      contextIsolation: boolean;
      nodeIntegration: boolean;
    };
  };
  webContents: EventEmitter & {
    session: object;
    mainFrame: object;
    getURL: () => string;
    focus: ReturnType<typeof vi.fn>;
    setWindowOpenHandler: ReturnType<typeof vi.fn>;
  };
  show: ReturnType<typeof vi.fn>;
  hide: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  setBounds: ReturnType<typeof vi.fn>;
  setAlwaysOnTop: ReturnType<typeof vi.fn>;
  isDestroyed: () => boolean;
  isVisible: () => boolean;
  destroy: () => void;
};

import { BrowserWindow } from "electron";
import {
  QuickAsk,
  quickAskConversationUrl,
  quickAskUrl,
  registerQuickAskShortcut,
} from "./quick-ask";

beforeEach(() => {
  state.windows.length = 0;
});

function host(url = "https://mycellios.example/agent/app/mico?secret=unused") {
  const main = new BrowserWindow({}) as unknown as MockWindow;
  main.webContents.getURL = () => url;
  const load = vi.fn(async () => undefined);
  const reveal = vi.fn();
  const external = vi.fn();
  const focusApp = vi.fn();
  let now = 1_000;
  const ask = new QuickAsk({
    main: () => main as never,
    load,
    reveal,
    external,
    focusApp,
    now: () => now,
    display: () => ({ x: 0, y: 0, width: 1440, height: 900 }),
  });
  return {
    ask,
    main,
    load,
    reveal,
    external,
    focusApp,
    setNow: (value: number) => {
      now = value;
    },
  };
}

it("keeps the server prefix and the open Mico without copying the page query", () => {
  expect(quickAskUrl("https://mycellios.example/agent/app/mico?secret=unused#part")).toBe(
    "https://mycellios.example/agent/quick-ask?bot=mico",
  );
  expect(quickAskUrl("https://mycellios.example/agent/app/artifacts")).toBe(
    "https://mycellios.example/agent/quick-ask",
  );
  expect(quickAskUrl("https://mycellios.example/app")).toBe("https://mycellios.example/quick-ask");
  expect(() => quickAskUrl("file:///tmp/app")).toThrow();
  expect(() => quickAskUrl("https://user:secret@mycellios.example/app")).toThrow();
});

it("opens only an owned conversation on the same server", () => {
  expect(quickAskConversationUrl("https://mycellios.example/agent/app/old", "/app/mico")).toBe(
    "https://mycellios.example/agent/app/mico",
  );
  expect(quickAskConversationUrl("https://mycellios.example/agent/app/old", "/app")).toBe(
    "https://mycellios.example/agent/app",
  );
  expect(() =>
    quickAskConversationUrl("https://mycellios.example/agent/app", "https://other.example/app"),
  ).toThrow();
  expect(() =>
    quickAskConversationUrl("https://mycellios.example/agent/app", "//other.example"),
  ).toThrow();
  expect(() =>
    quickAskConversationUrl("https://mycellios.example/agent/app", "/app/../admin"),
  ).toThrow();
  expect(() =>
    quickAskConversationUrl("https://mycellios.example/agent/app", "/app/mico?next=/admin"),
  ).toThrow();
});

it("registers one global shortcut and replaces a previous registration", () => {
  const shortcuts = { register: vi.fn(() => true), unregister: vi.fn() };
  const onPress = vi.fn();
  expect(registerQuickAskShortcut(shortcuts, onPress)).toBe(true);
  expect(shortcuts.unregister).toHaveBeenCalledWith("CommandOrControl+Shift+Space");
  expect(shortcuts.register).toHaveBeenCalledWith("CommandOrControl+Shift+Space", onPress);
});

it("opens one always-on-top window over the current server and hides it when focus leaves", async () => {
  const { ask, main, load, focusApp, setNow } = host();
  ask.toggle();
  const win = state.windows[1]!;
  await vi.waitFor(() => expect(win.show).toHaveBeenCalled());
  expect(load).toHaveBeenCalledWith(win, "https://mycellios.example/agent/quick-ask?bot=mico");
  expect(win.options.webPreferences).toMatchObject({
    session: main.webContents.session,
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
  });
  expect(String((win.options.webPreferences as { preload: string }).preload)).toContain(
    "quick-ask-preload.cjs",
  );
  expect(focusApp).toHaveBeenCalled();
  expect(win.setAlwaysOnTop).toHaveBeenCalledWith(true, "floating");
  expect(win.setBounds).toHaveBeenCalledWith({ x: 400, y: 225, width: 640, height: 220 });
  setNow(1_200);
  win.emit("blur");
  expect(win.hide).not.toHaveBeenCalled();
  setNow(1_800);
  win.emit("blur");
  expect(win.hide).toHaveBeenCalled();
  ask.toggle();
  await vi.waitFor(() => expect(win.show).toHaveBeenCalledTimes(2));
  expect(load).toHaveBeenCalledTimes(2);
  expect(state.windows).toHaveLength(2);
  ask.toggle();
  expect(win.hide).toHaveBeenCalledTimes(2);
});

it("accepts a conversation only from the quick ask window and replaces another server", async () => {
  const { ask, main, load, reveal, external } = host();
  ask.toggle();
  const win = state.windows[1]!;
  await vi.waitFor(() => expect(win.show).toHaveBeenCalled());
  expect(() => ask.closeFrom({} as never, null)).toThrow("Untrusted");
  ask.closeFrom(win.webContents as never, win.webContents.mainFrame as never);
  expect(win.hide).toHaveBeenCalled();
  await ask.sent(win.webContents as never, win.webContents.mainFrame as never, "/app/mico");
  expect(reveal).toHaveBeenCalled();
  expect(load).toHaveBeenCalledWith(state.windows[0], "https://mycellios.example/agent/app/mico");
  const preventDefault = vi.fn();
  win.webContents.emit("will-navigate", { preventDefault }, "https://other.example/phish");
  expect(preventDefault).toHaveBeenCalled();
  expect(external).toHaveBeenCalledWith("https://other.example/phish");
  main.webContents.getURL = () => "https://other.example/app/other";
  ask.toggle();
  await vi.waitFor(() => expect(state.windows).toHaveLength(3));
  expect(win.destroyed).toBe(true);
  expect(load).toHaveBeenCalledWith(state.windows[2], "https://other.example/quick-ask?bot=other");
});
