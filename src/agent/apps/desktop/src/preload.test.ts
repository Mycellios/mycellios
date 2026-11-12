import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import type { RakazoDesktop, RakazoSetup } from "@rakazo/contracts";
import { describe, expect, it, vi } from "vitest";

function runPreload(file: string, ipc: { invoke?: unknown; on?: unknown; off?: unknown; send?: unknown } = {}) {
  const invoke =
    (ipc.invoke as ReturnType<typeof vi.fn>) ?? vi.fn(async (channel: string) => ({ channel }));
  const on = (ipc.on as ReturnType<typeof vi.fn>) ?? vi.fn();
  const off = (ipc.off as ReturnType<typeof vi.fn>) ?? vi.fn();
  const send = (ipc.send as ReturnType<typeof vi.fn>) ?? vi.fn();
  const exposeInMainWorld = vi.fn();
  const source = readFileSync(path.join(import.meta.dirname, file), "utf8");

  vm.runInNewContext(source, {
    process: { platform: "linux", argv: ["--mycellios-chat-space=space-a"] },
    require(moduleName: string) {
      if (moduleName !== "electron") throw new Error(`Unexpected preload import: ${moduleName}`);
      return { contextBridge: { exposeInMainWorld }, ipcRenderer: { invoke, on, off, send } };
    },
  });

  return { invoke, on, off, send, exposeInMainWorld };
}

it("exposes bounded native notification operations and removes click listeners", async () => {
  const f = runPreload("preload.cjs");
  const bridge = f.exposeInMainWorld.mock.calls[0]![1] as RakazoDesktop;
  await bridge.notifications!.status(); await bridge.notifications!.openSettings(); await bridge.notifications!.clear();
  const input = { title: "Mycellios", body: "Test", url: "/app", tag: "test", silent: true };
  await bridge.notifications!.show(input);
  expect(f.invoke.mock.calls).toEqual([["desktop.notifications.status"], ["desktop.notifications.settings"], ["desktop.notifications.clear"], ["desktop.notifications.show", input]]);
  const listener = vi.fn(); const remove = bridge.notifications!.onOpen(listener);
  const handler = f.on.mock.calls.find(([name]) => name === "desktop.notifications.open")![1];
  handler({}, "/app/bot"); expect(listener).toHaveBeenCalledWith("/app/bot");
  remove(); expect(f.off).toHaveBeenCalledWith("desktop.notifications.open", handler);
});

describe("desktop preload bridge", () => {
  it("keeps floating chat access limited to its pinned Space and update acknowledgement", async () => {
    const { invoke, exposeInMainWorld } = runPreload("floating-chat-preload.cjs");
    const bridge = exposeInMainWorld.mock.calls[0]![1] as RakazoDesktop;
    expect(Object.keys(bridge).sort()).toEqual(["chatWindow", "nativeWindowFrame", "platform"]);
    expect(bridge.chatWindow?.spaceId).toBe("space-a");
    await bridge.chatWindow!.returnToMain();
    expect(invoke).toHaveBeenCalledWith("desktop.chat.return");
  });
  it("exposes settings as named IPC methods without a raw IPC capability", async () => {
    const { invoke, exposeInMainWorld } = runPreload("preload.cjs");
    const bridge = exposeInMainWorld.mock.calls[0]![1] as RakazoDesktop;
    await bridge.settings!.state(); await bridge.settings!.update({ keepAwake: true });
    expect(invoke.mock.calls).toEqual([["desktop.settings.state"], ["desktop.settings.update", { keepAwake: true }]]);
    expect((bridge as unknown as Record<string, unknown>).ipcRenderer).toBeUndefined();
  });
  it("acknowledges only bounded native update requests without exposing IPC events", async () => {
    const { on, off, send, exposeInMainWorld } = runPreload("preload.cjs");
    const bridge = exposeInMainWorld.mock.calls[0]![1] as RakazoDesktop;
    const listener = vi.fn(() => true), unsubscribe = bridge.update.onPrepare!(listener);
    const handler = on.mock.calls.find(([channel]) => channel === "desktop.update.prepare")![1];
    await handler({ privateEvent: true }, "invalid"); expect(send).not.toHaveBeenCalled();
    await handler({ privateEvent: true }, "a".repeat(32));
    expect(listener).toHaveBeenCalledWith();
    expect(send).toHaveBeenCalledWith("desktop.update.prepared", { nonce: "a".repeat(32), ready: true });
    unsubscribe(); expect(off).toHaveBeenCalledWith("desktop.update.prepare", handler);
  });
  it("exposes a bounded preview bridge without the Mycellios development launcher", async () => {
    const { invoke, on, off, exposeInMainWorld } = runPreload("preload.cjs");
    const bridge = exposeInMainWorld.mock.calls[0]![1] as RakazoDesktop;
    expect(bridge.development).toBeUndefined();
    const request = { id: "page", url: "http://localhost:3000", bounds: {x:600,y:100,width:500,height:500} };
    await bridge.preview!.show(request);
    await bridge.preview!.layout({ id: "page", bounds: null });
    await bridge.preview!.command({ id: "page", action: "select", enabled: true });
    await bridge.preview!.close("page");
    expect(invoke.mock.calls.map(([channel]) => channel)).toEqual(["desktop.preview.show", "desktop.preview.layout", "desktop.preview.command", "desktop.preview.close"]);
    const listener = vi.fn();
    const stop = bridge.preview!.onChanged(listener);
    const handler = on.mock.calls.find(([channel]) => channel === "desktop.preview.changed")![1];
    handler({ secret: "native-only" }, { id: "page", url: request.url });
    expect(listener).toHaveBeenCalledWith({ id: "page", url: request.url });
    stop();
    expect(off).toHaveBeenCalledWith("desktop.preview.changed", handler);
  });
  it("exposes the scoped desktop bridges", async () => {
    const { invoke, exposeInMainWorld } = runPreload("preload.cjs");

    expect(exposeInMainWorld).toHaveBeenCalledTimes(1);
    const [globalName, bridge] = exposeInMainWorld.mock.calls[0] as [string, RakazoDesktop];
    expect(globalName).toBe("rakazoDesktop");
    expect(bridge.platform).toBe("linux");
    expect(bridge.nativeWindowFrame).toBe(true);
    expect(Object.keys(bridge).sort()).toEqual([
      "appsStudio",
      "badge",
      "companions",
      "computer",
      "localVoice",
      "nativeWindowFrame",
      "notifications",
      "oauth",
      "passkeys",
      "platform",
      "preview",
      "projectRunner",
      "runtime",
      "servers",
      "settings",
      "update",
      "videoEdit",
      "window",
    ]);
    expect(Object.keys(bridge.window).sort()).toEqual([
      "close",
      "minimize",
      "state",
      "toggleMaximize",
    ]);
    expect(Object.keys(bridge.update).sort()).toEqual(["cancelInstall", "cancelRestart", "check", "download", "forceInstall", "install", "onPrepare", "preferences", "restartWhenIdle", "savePreferences", "state"]);
    expect(Object.keys(bridge.runtime!).sort()).toEqual(["enroll", "identify", "status"]);

    expect(Object.keys(bridge.localVoice!).sort()).toEqual(["prepare", "prepareModel", "removeModel", "speak", "status", "stop", "transcribe"]);
    await bridge.localVoice!.status();
    await bridge.localVoice!.prepare();
    await bridge.localVoice!.prepareModel!("asr");
    await bridge.localVoice!.removeModel!("tts");
    await bridge.localVoice!.transcribe(new Float32Array([0, 0.1]));
    await bridge.localVoice!.speak({ text: "Hola", language: "es", speed: 1 });
    await bridge.localVoice!.stop();
    expect(invoke).toHaveBeenCalledWith("desktop.localVoice.status");
    expect(invoke).toHaveBeenCalledWith("desktop.localVoice.prepare");
    expect(invoke).toHaveBeenCalledWith("desktop.localVoice.prepareModel", "asr");
    expect(invoke).toHaveBeenCalledWith("desktop.localVoice.removeModel", "tts");
    expect(invoke).toHaveBeenCalledWith("desktop.localVoice.speak", { text: "Hola", language: "es", speed: 1 });
    expect(invoke).toHaveBeenCalledWith("desktop.localVoice.stop");

    expect(Object.keys(bridge.badge!)).toEqual(["set"]);
    await bridge.badge!.set(7);
    expect(invoke).toHaveBeenCalledWith("desktop.badge.set", 7);

    await bridge.oauth.open?.("https://provider.example.com/authorize");
    await bridge.oauth.cancel?.("https://provider.example.com/authorize");
    await bridge.passkeys?.rpIds();
    await bridge.window.close();
    await bridge.window.minimize();
    await bridge.window.toggleMaximize();
    await bridge.window.state();
    await bridge.update.state();
    await bridge.update.check();
    await bridge.update.download();
    await bridge.update.install();
    await bridge.update.forceInstall?.();
    expect(invoke.mock.calls.map(([channel]) => channel)).toEqual([
      "desktop.localVoice.status",
      "desktop.localVoice.prepare",
      "desktop.localVoice.prepareModel",
      "desktop.localVoice.removeModel",
      "desktop.localVoice.transcribe",
      "desktop.localVoice.speak",
      "desktop.localVoice.stop",
      "desktop.badge.set",
      "desktop.oauth.open",
      "desktop.oauth.cancel",
      "desktop.passkeys.rpIds",
      "desktop.window.close",
      "desktop.window.minimize",
      "desktop.window.toggleMaximize",
      "desktop.window.state",
      "desktop.update.state",
      "desktop.update.check",
      "desktop.update.download",
      "desktop.update.install",
      "desktop.update.forceInstall",
    ]);
  });

  it("exposes update choices and idle-restart commands without a general IPC escape hatch", async () => {
    const { invoke, exposeInMainWorld } = runPreload("preload.cjs");
    const bridge = exposeInMainWorld.mock.calls[0]![1] as RakazoDesktop;
    await bridge.update.preferences!();
    await bridge.update.savePreferences!({ autoDownload: false });
    await bridge.update.restartWhenIdle!(); await bridge.update.cancelRestart!();
    expect(invoke.mock.calls).toEqual([
      ["desktop.update.preferences"], ["desktop.update.savePreferences", { autoDownload: false }],
      ["desktop.update.restartWhenIdle"], ["desktop.update.cancelRestart"],
    ]);
  });

  it("forwards captured codes without leaking the IPC event to the renderer", () => {
    const listeners: Array<(event: unknown, callback: unknown) => void> = [];
    const on = vi.fn((channel: string, handler: (event: unknown, callback: unknown) => void) => {
      if (channel === "desktop.oauth.callback") listeners.push(handler);
    });
    const off = vi.fn();
    const { exposeInMainWorld } = runPreload("preload.cjs", { on, off });

    const [, bridge] = exposeInMainWorld.mock.calls[0] as [string, RakazoDesktop];
    const received: unknown[] = [];
    const unsubscribe = bridge.oauth.onCallback((callback) => received.push(callback));

    expect(on).toHaveBeenCalledWith("desktop.oauth.callback", expect.any(Function));
    listeners[0]?.({ sender: "ipc-event" }, { code: "ac_123", state: "verifier_456" });
    expect(received).toEqual([{ code: "ac_123", state: "verifier_456" }]);

    unsubscribe();
    expect(off).toHaveBeenCalledWith("desktop.oauth.callback", expect.any(Function));
  });
});

describe("setup preload bridge", () => {
  it("exposes only the first-run setup operations", async () => {
    const { invoke, on, exposeInMainWorld } = runPreload("setup-preload.cjs");

    expect(exposeInMainWorld).toHaveBeenCalledTimes(1);
    const [globalName, bridge] = exposeInMainWorld.mock.calls[0] as [string, RakazoSetup];
    expect(globalName).toBe("rakazoSetup");
    expect(bridge.platform).toBe("linux");
    expect(Object.keys(bridge).sort()).toEqual([
      "forgetServer",
      "openLink",
      "platform",
      "quit",
      "retry",
      "save",
      "servers",
      "stack",
      "state",
      "test",
    ]);
    expect(Object.keys(bridge.stack).sort()).toEqual(["onChange", "start", "state"]);

    await bridge.state();
    await bridge.test("http://127.0.0.1:5173");
    await bridge.save({ mode: "new", serverUrl: "http://127.0.0.1:5173" });
    await bridge.quit();
    await bridge.openLink("orbstack");
    await bridge.stack.state();
    await bridge.stack.start();
    expect(invoke.mock.calls.map(([channel]) => channel)).toEqual([
      "desktop.setup.state",
      "desktop.setup.test",
      "desktop.setup.save",
      "desktop.setup.quit",
      "desktop.setup.openLink",
      "desktop.setup.stack.state",
      "desktop.setup.stack.start",
    ]);
    expect(invoke).toHaveBeenCalledWith("desktop.setup.openLink", "orbstack");

    const listener = vi.fn();
    bridge.stack.onChange(listener);
    const [channel, handler] = on.mock.calls.at(-1) as [string, (...args: unknown[]) => void];
    expect(channel).toBe("desktop.setup.stack.changed");
    handler({}, { phase: "pulling" });
    expect(listener).toHaveBeenCalledWith({ phase: "pulling" });
  });
});
