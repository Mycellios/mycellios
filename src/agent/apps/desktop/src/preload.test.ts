import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import type { RakazoDesktop, RakazoSetup } from "@rakazo/contracts";
import { describe, expect, it, vi } from "vitest";

function runPreload(file: string, ipc: { invoke?: unknown; on?: unknown; off?: unknown } = {}) {
  const invoke =
    (ipc.invoke as ReturnType<typeof vi.fn>) ?? vi.fn(async (channel: string) => ({ channel }));
  const on = (ipc.on as ReturnType<typeof vi.fn>) ?? vi.fn();
  const off = (ipc.off as ReturnType<typeof vi.fn>) ?? vi.fn();
  const exposeInMainWorld = vi.fn();
  const source = readFileSync(path.join(import.meta.dirname, file), "utf8");

  vm.runInNewContext(source, {
    process: { platform: "linux" },
    require(moduleName: string) {
      if (moduleName !== "electron") throw new Error(`Unexpected preload import: ${moduleName}`);
      return { contextBridge: { exposeInMainWorld }, ipcRenderer: { invoke, on, off } };
    },
  });

  return { invoke, on, off, exposeInMainWorld };
}

describe("desktop preload bridge", () => {
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
      "computer",
      "localVoice",
      "nativeWindowFrame",
      "oauth",
      "passkeys",
      "platform",
      "preview",
      "projectRunner",
      "runtime",
      "update",
      "window",
    ]);
    expect(Object.keys(bridge.window).sort()).toEqual([
      "close",
      "minimize",
      "state",
      "toggleMaximize",
    ]);
    expect(Object.keys(bridge.update).sort()).toEqual(["check", "download", "install", "state"]);
    expect(Object.keys(bridge.runtime!).sort()).toEqual(["enroll", "identify", "status"]);

    expect(Object.keys(bridge.localVoice!).sort()).toEqual(["prepare", "speak", "status", "stop", "transcribe"]);
    await bridge.localVoice!.status();
    await bridge.localVoice!.prepare();
    await bridge.localVoice!.transcribe(new Float32Array([0, 0.1]));
    await bridge.localVoice!.speak({ text: "Hola", language: "es", speed: 1 });
    await bridge.localVoice!.stop();
    expect(invoke).toHaveBeenCalledWith("desktop.localVoice.status");
    expect(invoke).toHaveBeenCalledWith("desktop.localVoice.prepare");
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
    expect(invoke.mock.calls.map(([channel]) => channel)).toEqual([
      "desktop.localVoice.status",
      "desktop.localVoice.prepare",
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
      "openLink",
      "platform",
      "quit",
      "retry",
      "save",
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
