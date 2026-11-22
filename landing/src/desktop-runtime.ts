import type { DesktopRuntimeBridge } from "../../src/contracts/desktop-runtime.js";

/** Same contribution flow; native installation is an optional platform capability. */
export function desktopRuntimeBridge(): DesktopRuntimeBridge | undefined {
  type NativeHost = { platform?: string; runtime?: DesktopRuntimeBridge };
  const host = (globalThis as { window?: { mycelliosDesktop?: NativeHost; rakazoDesktop?: NativeHost } }).window;
  const native = host?.mycelliosDesktop ?? host?.rakazoDesktop;
  return native?.platform === "win32" || native?.platform === "linux" ? native.runtime : undefined;
}
