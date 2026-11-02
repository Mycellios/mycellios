import type { DesktopRuntimeBridge } from "../../src/contracts/desktop-runtime.js";

/** Same contribution flow; native installation is an optional platform capability. */
export function desktopRuntimeBridge(): DesktopRuntimeBridge | undefined {
  const native = (globalThis as { window?: { rakazoDesktop?: { platform?: string; runtime?: DesktopRuntimeBridge } } }).window?.rakazoDesktop;
  return native?.platform === "win32" || native?.platform === "linux" ? native.runtime : undefined;
}
