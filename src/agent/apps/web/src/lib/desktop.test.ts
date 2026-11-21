import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defaultComputerMode,
  desktopDragClass,
  desktopOAuthCode,
  oauthStateOf,
  onDesktopOAuthCallback,
  type RakazoDesktop,
  type RakazoDesktopOAuthCallback,
  windowChromeKind,
} from "./desktop.js";

function desktop(platform: string): RakazoDesktop {
  const updateState = {
    phase: "unsupported" as const,
    currentVersion: "0.1.0",
    availableVersion: null,
    percent: null,
    message: "Automatic updates only run in an installed build.",
    checkedAt: null,
  };
  return {
    platform,
    window: {
      close: async () => undefined,
      minimize: async () => undefined,
      toggleMaximize: async () => undefined,
      state: async () => ({ minimized: false, maximized: false, fullScreen: false }),
    },
    update: {
      state: async () => updateState,
      check: async () => updateState,
      download: async () => updateState,
      install: async () => updateState,
    },
    oauth: { onCallback: () => () => undefined },
  };
}

describe("window chrome", () => {
  it("does not paint fake traffic lights in the browser", () => {
    expect(windowChromeKind(undefined)).toBe("spacer");
  });
  it("defaults new Micos to this PC in Desktop and to isolation elsewhere", () => {
    expect(defaultComputerMode(undefined)).toBe("isolated");
    const host = { connect: async () => undefined } as unknown as NonNullable<RakazoDesktop["computer"]>;
    for (const platform of ["linux", "win32", "darwin"]) {
      expect(defaultComputerMode({ ...desktop(platform), computer: host })).toBe("dedicated");
      // A Desktop build without local computer access cannot host the Mico.
      expect(defaultComputerMode(desktop(platform))).toBe("isolated");
    }
  });
  it("preserves the computer route when the user explicitly selects an installed account", () => {
    expect(defaultComputerMode(undefined, true)).toBe("team");
    expect(defaultComputerMode(desktop("win32"), true)).toBe("dedicated");
  });

  it("leaves macOS traffic lights to Electron", () => {
    expect(windowChromeKind(desktop("darwin"))).toBe("darwin");
  });

  it("uses real window-control buttons on Windows and Linux", () => {
    expect(windowChromeKind(desktop("win32"))).toBe("controls");
    expect(windowChromeKind(desktop("linux"))).toBe("controls");
  });

  it("does not duplicate caption buttons supplied by newer native windows", () => {
    for (const platform of ["win32", "linux"]) {
      expect(windowChromeKind({ ...desktop(platform), nativeWindowFrame: true })).toBe("native");
    }
  });

  it("drags from the page only where macOS hides the title bar", () => {
    expect(desktopDragClass()).toBe("");
    expect(desktopDragClass(desktop("win32"))).toBe("");
    expect(desktopDragClass(desktop("linux"))).toBe("");
    expect(desktopDragClass(desktop("darwin"))).toBe("app-drag");
  });
});

describe("captured OAuth callbacks", () => {
  it("sends the code and state as the compact form the paste flow accepts", () => {
    expect(desktopOAuthCode({ code: "ac_123", state: "verifier_456" })).toBe("ac_123#verifier_456");
  });

  it("sends a bare code when the provider redirects without state", () => {
    expect(desktopOAuthCode({ code: "ac_123" })).toBe("ac_123");
  });
});

describe("attempt correlation", () => {
  afterEach(() => vi.unstubAllGlobals());

  function bridgeEmitting() {
    let emit: (callback: RakazoDesktopOAuthCallback) => void = () => undefined;
    const unsubscribe = vi.fn();
    vi.stubGlobal("window", {
      rakazoDesktop: {
        ...desktop("linux"),
        oauth: {
          onCallback: (listener: (callback: RakazoDesktopOAuthCallback) => void) => {
            emit = listener;
            return unsubscribe;
          },
        },
      },
    });
    return { emit: (c: RakazoDesktopOAuthCallback) => emit(c), unsubscribe };
  }

  it("reads the attempt state out of the authorize URL", () => {
    expect(oauthStateOf("https://claude.ai/oauth/authorize?code=true&state=verifier_456")).toBe(
      "verifier_456",
    );
    expect(oauthStateOf("https://claude.ai/oauth/authorize?code=true")).toBeUndefined();
    expect(oauthStateOf("not a url")).toBeUndefined();
  });

  it("ignores a code captured for a different attempt", () => {
    const { emit } = bridgeEmitting();
    const received: string[] = [];
    onDesktopOAuthCallback((code) => received.push(code), "verifier_456");

    emit({ code: "stale", state: "verifier_000" });
    expect(received).toEqual([]);

    emit({ code: "ac_123", state: "verifier_456" });
    expect(received).toEqual(["ac_123#verifier_456"]);
  });

  it("accepts any code when the provider carries no state to correlate on", () => {
    const { emit } = bridgeEmitting();
    const received: string[] = [];
    onDesktopOAuthCallback((code) => received.push(code));

    emit({ code: "ac_123" });
    expect(received).toEqual(["ac_123"]);
  });

  it("no-ops in a browser without the desktop bridge", () => {
    vi.stubGlobal("window", {});
    const received: string[] = [];
    expect(() => onDesktopOAuthCallback((code) => received.push(code))()).not.toThrow();
    expect(received).toEqual([]);
  });
});
