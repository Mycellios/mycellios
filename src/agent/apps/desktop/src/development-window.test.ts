import { EventEmitter } from "node:events";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  handlers: new Map<string, any>(),
  windows: [] as any[],
  children: [] as any[],
  protocol: null as any,
}));
vi.mock("node:fs/promises", () => ({
  realpath: async (value: string) => path.resolve(value),
  readFile: async (file: string) =>
    file.endsWith("development-workspace.json")
      ? '{"workspace":"/fixture"}'
      : file.endsWith("package.json")
        ? '{"name":"mycellios-agent"}'
        : "// source",
  writeFile: vi.fn(async () => {}),
}));
vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      kill: vi.fn(),
    });
    state.children.push(child);
    queueMicrotask(() => child.stdout.emit("data", 'MYCELLIOS_DEVELOPMENT_READY {"port":12345}'));
    return child;
  }),
}));
vi.mock("electron", () => ({
  app: Object.assign(new EventEmitter(), { getPath: () => "/profile" }),
  BrowserWindow: class extends EventEmitter {
    webContents = Object.assign(new EventEmitter(), { setWindowOpenHandler: vi.fn() });
    loadURL = vi.fn(async () => {});
    isDestroyed = () => false;
    show = vi.fn();
    focus = vi.fn();
    close = vi.fn();
    constructor(public options: unknown) {
      super();
      state.windows.push(this);
    }
  },
  dialog: {},
  ipcMain: { handle: (name: string, handler: unknown) => state.handlers.set(name, handler) },
  session: {
    fromPartition: () => ({
      setPermissionRequestHandler: vi.fn(),
      protocol: {
        unhandle: vi.fn(),
        handle: async (_name: string, handler: unknown) => {
          state.protocol = handler;
        },
      },
    }),
  },
}));
vi.mock("./window-chrome.js", () => ({ installWindowChrome: vi.fn() }));

import {
  installDevelopmentWindow,
  isDevelopmentAsset,
  mayOpenDevelopment,
} from "./development-window.js";

describe("development boundary", () => {
  it("keeps APIs, identity and computer traffic away from Vite", () => {
    for (const pathname of [
      "api/auth/get-session",
      "rpc/bots.list",
      "auth/callback",
      "novnc/session/control/a",
    ])
      expect(
        isDevelopmentAsset(
          `https://www.mycellios.com/agent/${pathname}`,
          "https://www.mycellios.com/agent",
        ),
      ).toBe(false);
    for (const pathname of [
      "app/demo",
      "src/main.tsx",
      "@vite/client",
      "@fs/workspace/component.tsx",
    ])
      expect(
        isDevelopmentAsset(
          `https://www.mycellios.com/agent/${pathname}`,
          "https://www.mycellios.com/agent",
        ),
      ).toBe(true);
    expect(
      isDevelopmentAsset(
        "https://foreign.test/agent/src/main.tsx",
        "https://www.mycellios.com/agent",
      ),
    ).toBe(false);
    expect(
      isDevelopmentAsset(
        "https://www.mycellios.com/api/auth/get-session",
        "https://www.mycellios.com/agent",
      ),
    ).toBe(false);
  });
  it("requires the stable main frame, not another window or iframe", () => {
    const frame = { url: "https://www.mycellios.com/agent/app/demo" };
    const contents = { mainFrame: frame };
    const stable = { webContents: contents } as any;
    const event = { sender: contents, senderFrame: frame } as any;
    expect(mayOpenDevelopment(event, stable, "https://www.mycellios.com/agent")).toBe(true);
    expect(mayOpenDevelopment(event, null, "https://www.mycellios.com/agent")).toBe(false);
    expect(
      mayOpenDevelopment(
        { ...event, sender: { mainFrame: frame } },
        stable,
        "https://www.mycellios.com/agent",
      ),
    ).toBe(false);
    expect(
      mayOpenDevelopment(
        { ...event, senderFrame: { ...frame } },
        stable,
        "https://www.mycellios.com/agent",
      ),
    ).toBe(false);
    frame.url = "https://www.mycellios.com.evil.test/agent/";
    expect(mayOpenDevelopment(event, stable, "https://www.mycellios.com/agent")).toBe(false);
    frame.url = "https://www.mycellios.com/oauth/consent";
    expect(mayOpenDevelopment(event, stable, "https://www.mycellios.com/agent")).toBe(false);
  });
  it("deduplicates launches, isolates asset credentials and closes only its own watcher", async () => {
    const frame = { url: "https://www.mycellios.com/agent/app/demo" };
    const fetchAccount = vi.fn(async () => new Response("{}"));
    const contents = {
      mainFrame: frame,
      getURL: () => frame.url,
      executeJavaScript: async()=>({locale:"es",appearance:"light",spaceId:"fixture-space"}),
      session: { fetch: fetchAccount },
    };
    const stable = Object.assign(new EventEmitter(), {
      webContents: contents,
      isDestroyed: () => false,
      close: vi.fn(),
    });
    installDevelopmentWindow(() => stable as any, {
      authorize: (event) =>
        mayOpenDevelopment(event, stable as any, "https://www.mycellios.com/agent"),
      state: () => ({active:true}),
      connect: async()=>{},
      development: async () => ({
        key: "fixture",
        root: path.resolve("/fixture"),
        workspace: path.resolve("/fixture"),
        server: "https://www.mycellios.com/agent",
        project: { id: "fixture", name: "Fixture" },
        validate: async () => {},
      }),
    });
    const launch = state.handlers.get("desktop.development.open");
    const event = { sender: contents, senderFrame: frame };
    const before = state.windows.length;
    const results = await Promise.all([launch(event), launch(event)]);
    expect(results).toEqual([{ opened: true }, { opened: true }]);
    expect(state.windows.length - before).toBe(1);
    await expect(launch({ ...event, senderFrame: { ...frame } })).rejects.toThrow();
    const fetchAsset = vi.fn(async () => new Response("export const x=1"));
    vi.stubGlobal("fetch", fetchAsset);
    try {
      await state.protocol(
        new Request("https://www.mycellios.com/agent/src/demo.tsx", {
          headers: { cookie: "private-fixture" },
        }),
      );
      expect(new Headers(fetchAsset.mock.calls[0]?.[1]?.headers).get("cookie")).toBeNull();
      await state.protocol(
        new Request("https://www.mycellios.com/agent/api/auth/get-session", {
          headers: { cookie: "untrusted-fixture" },
        }),
      );
      expect(fetchAccount.mock.calls[0]?.[1].headers.get("cookie")).toBeNull();
      expect(fetchAccount.mock.calls[0]?.[1].credentials).toBe("include");
      fetchAsset.mockResolvedValueOnce(new Response("<head></head><body></body>",{headers:{"content-type":"text/html"}}));
      const html=await (await state.protocol(new Request("https://www.mycellios.com/agent/app/demo"))).text();
      expect(html).toContain('"fixture-space"');expect(html).toContain('localStorage.setItem("rakazo:space-id",p.spaceId)');
    } finally {
      vi.unstubAllGlobals();
    }
    state.windows.at(-1).emit("closed");
    expect(state.children.at(-1).kill).toHaveBeenCalledOnce();
    expect(stable.close).not.toHaveBeenCalled();
  });
});
