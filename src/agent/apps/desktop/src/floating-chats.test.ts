import { EventEmitter } from "node:events";
import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ windows: [] as any[] }));
vi.mock("electron", () => ({
  BrowserWindow: class extends EventEmitter {
    destroyed = false;
    webContents = Object.assign(new EventEmitter(), {
      session: {}, mainFrame: {}, setWindowOpenHandler: vi.fn(), getURL: () => "https://mycellios.example/agent/app/mico",
    });
    show = vi.fn(); focus = vi.fn(); restore = vi.fn();
    constructor(public options: any) { super(); state.windows.push(this); }
    isDestroyed() { return this.destroyed; }
    isMinimized() { return false; }
    destroy() { this.destroyed = true; this.emit("closed"); }
  },
}));
import { BrowserWindow } from "electron";
import { chatScope, FloatingChats, floatingChatUrl } from "./floating-chats";
beforeEach(() => { state.windows.length = 0; });
const scope = JSON.stringify(["owner", "space-a"]);
function fixture() {
  const main = new BrowserWindow();
  const reveal = vi.fn();
  const onEmpty = vi.fn();
  const load = vi.fn<(win: BrowserWindow, url: string) => Promise<unknown>>(async () => undefined);
  const chats = new FloatingChats({ main: () => main, load, reveal, onEmpty, external: vi.fn() });
  chats.account(scope);
  return { chats, main, reveal, load, onEmpty };
}
it("keeps server prefixes and rejects unsafe chat identifiers", () => {
  expect(floatingChatUrl("https://mycellios.example/agent/app/old?secret=unused", "mico"))
    .toBe("https://mycellios.example/agent/app/mico");
  expect(() => floatingChatUrl("https://mycellios.example", "../other")).toThrow();
  expect(() => floatingChatUrl("file:///tmp", "mico")).toThrow();
  expect(() => chatScope(JSON.stringify(["owner", null]))).toThrow();
});
it("reuses a chat, shares its native session and closes it on account change", async () => {
  const { chats, main, reveal } = fixture();
  await chats.open({ scope, botId: "mico" });
  await chats.open({ scope, botId: "mico" });
  const win = state.windows[1];
  expect(state.windows).toHaveLength(2);
  expect(win.options.webPreferences).toMatchObject({
    session: main.webContents.session, sandbox: true, contextIsolation: true, nodeIntegration: false,
    additionalArguments: ["--mycellios-chat-space=space-a"],
  });
  expect(() => chats.returnToMain({} as any, null)).toThrow();
  chats.returnToMain(win.webContents, win.webContents.mainFrame);
  expect(reveal).toHaveBeenCalledWith({ scope, botId: "mico" });
  chats.account(JSON.stringify(["owner", "space-b"]));
  expect(win.destroyed).toBe(false);
  chats.account(JSON.stringify(["another-owner", "space-a"]));
  expect(win.destroyed).toBe(true);
  await expect(chats.open({ scope, botId: "mico" })).rejects.toThrow("account changed");
});
it("discards a loading window when the account closes and recovers from load failure", async () => {
  const { chats, load, onEmpty } = fixture();
  let finish!: () => void;
  load.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const opening = chats.open({ scope, botId: "mico" });
  const win = state.windows[1];
  chats.account("");
  finish();
  await opening;
  expect(win.show).not.toHaveBeenCalled();
  expect(onEmpty).not.toHaveBeenCalled();
  chats.account(scope);
  load.mockRejectedValueOnce(new Error("offline"));
  await expect(chats.open({ scope, botId: "mico" })).rejects.toThrow("offline");
  expect(chats.liveWindows()).toHaveLength(0);
});
it("reveals the main application after the last floating chat closes", async () => {
  const { chats, onEmpty } = fixture();
  await chats.open({ scope, botId: "one" });
  await chats.open({ scope, botId: "two" });
  state.windows[1].destroy();
  expect(onEmpty).not.toHaveBeenCalled();
  state.windows[2].destroy();
  expect(onEmpty).toHaveBeenCalledOnce();
});
