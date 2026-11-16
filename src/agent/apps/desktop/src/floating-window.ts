import { createRequire } from "node:module";

type FloatingWindow = {
  setAlwaysOnTop: (flag: boolean, level?: string) => void;
  isAlwaysOnTop: () => boolean;
  getNativeWindowHandle: () => Buffer;
};
type Placement = (handle: bigint | number, insertAfter: number, x: number, y: number, width: number, height: number, flags: number) => number;
let placement: Placement | undefined;

/** Only owned companion windows; never moves, resizes or activates another app. */
export function keepCompanionAbove(win: FloatingWindow, platform = process.platform, nativePlacement?: Placement) {
  if (platform === "darwin") win.setAlwaysOnTop(true, "status");
  else win.setAlwaysOnTop(true);
  if (platform !== "win32" || win.isAlwaysOnTop()) return;
  try {
    if (!nativePlacement && !placement) {
      const koffi = createRequire(import.meta.url)("koffi");
      placement = koffi.load("user32.dll").func("int __stdcall SetWindowPos(uintptr_t window, intptr_t after, int x, int y, int width, int height, uint32_t flags)");
    }
    const handle = win.getNativeWindowHandle();
    if (handle.length !== 4 && handle.length !== 8) return;
    const address = handle.length === 8 ? handle.readBigUInt64LE() : handle.readUInt32LE();
    if (!address) return;
    // HWND_TOPMOST; SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE.
    (nativePlacement ?? placement)!(address, -1, 0, 0, 0, 0, 0x13);
  } catch { /* Keep the ordinary Electron path when native placement is unavailable. */ }
}
