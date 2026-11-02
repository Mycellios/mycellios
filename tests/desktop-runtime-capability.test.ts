import { afterEach, expect, it, vi } from "vitest";
import { desktopRuntimeBridge } from "../landing/src/desktop-runtime.js";

afterEach(() => vi.unstubAllGlobals());
it("retains the browser contribution route without inventing native access", () => {
  vi.stubGlobal("window", {}); expect(desktopRuntimeBridge()).toBeUndefined();
});
it.each(["win32", "linux"])("uses the optional %s installer capability in the same web UI", platform => {
  const runtime = { status: vi.fn(), enroll: vi.fn() };
  vi.stubGlobal("window", { rakazoDesktop: { platform, runtime } });
  expect(desktopRuntimeBridge()).toBe(runtime);
});
it("does not offer an installer on an unsupported platform or an older desktop", () => {
  vi.stubGlobal("window", { rakazoDesktop: { platform: "darwin", runtime: {} } });
  expect(desktopRuntimeBridge()).toBeUndefined();
  vi.stubGlobal("window", { rakazoDesktop: { platform: "win32" } });
  expect(desktopRuntimeBridge()).toBeUndefined();
});
