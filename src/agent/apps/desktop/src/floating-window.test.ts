import { expect, it, vi } from "vitest";
import { keepCompanionAbove } from "./floating-window";
it("recovers only its own HWND without focus, movement or resize", () => {
  const handle = Buffer.alloc(8); handle.writeBigUInt64LE(123n);
  const native = vi.fn(() => 1);
  const win = { setAlwaysOnTop: vi.fn(), isAlwaysOnTop: () => false, getNativeWindowHandle: () => handle };
  keepCompanionAbove(win, "win32", native);
  expect(native).toHaveBeenCalledExactlyOnceWith(123n, -1, 0, 0, 0, 0, 0x13);
});
it("keeps native placement out of other platforms and already-floating windows", () => {
  const native = vi.fn(() => 1), getNativeWindowHandle = vi.fn(() => Buffer.alloc(8));
  const win = { setAlwaysOnTop: vi.fn(), isAlwaysOnTop: () => true, getNativeWindowHandle };
  for (const platform of ["win32", "darwin", "linux"] as const) keepCompanionAbove(win, platform, native);
  expect(native).not.toHaveBeenCalled(); expect(getNativeWindowHandle).not.toHaveBeenCalled();
});
