export type InstallerId = "windows-x64" | "macos-arm64" | "macos-x64" | "linux-x64" | "fedora-x64";
type HintNavigator = Navigator & { userAgentData?: { platform?: string; getHighEntropyValues?: (hints: string[]) => Promise<{ architecture?: string }> } };

/**
 * Best-effort guess of this visitor's desktop installer. Callers must keep every
 * installer reachable: Safari hides the Mac CPU, so an Intel Mac without a
 * renderer hint is reported as Apple silicon (every Mac sold since 2021).
 */
export async function detectInstaller(nav: HintNavigator = navigator): Promise<InstallerId | ""> {
  const ua = nav.userAgent, platform = nav.userAgentData?.platform ?? nav.platform ?? "";
  if (/Android|iPhone|iPad/i.test(ua)) return "";
  if (/Win/i.test(platform) || /Windows/.test(ua)) return "windows-x64";
  if (/Linux/i.test(platform) || /Linux/.test(ua)) return /Fedora/i.test(ua) ? "fedora-x64" : "linux-x64";
  if (!/Mac/i.test(platform) && !/Macintosh/.test(ua)) return "";
  if (nav.maxTouchPoints > 1) return ""; // iPadOS reports a Mac user agent.
  try {
    const architecture = (await nav.userAgentData?.getHighEntropyValues?.(["architecture"]))?.architecture;
    if (architecture === "arm") return "macos-arm64";
    if (architecture === "x86") return "macos-x64";
  } catch { /* Fall through to the renderer hint. */ }
  try {
    const gl = document.createElement("canvas").getContext("webgl");
    const info = gl?.getExtension("WEBGL_debug_renderer_info");
    const renderer = gl && info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "";
    if (/Intel|AMD|Radeon|NVIDIA/i.test(renderer)) return "macos-x64";
  } catch { /* Renderer hints are optional. */ }
  return "macos-arm64";
}
