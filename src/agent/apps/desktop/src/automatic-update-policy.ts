type Environment = { packaged: boolean; platform: string; arch: string; appImage?: string; disabled?: boolean };
export type AutomaticUpdatePolicy = { enabled: boolean; feedUrl?: string };

/** Packaged release policy, never a renderer preference or a remote feature flag. */
export function automaticUpdatePolicy(raw: unknown, env: Environment): AutomaticUpdatePolicy {
  const off = { enabled: false };
  if (!env.packaged || env.disabled || !raw || typeof raw !== "object") return off;
  const p = raw as Record<string, unknown>;
  if (p.schema !== "mycellios-desktop-update-policy/1" || p.automaticUpdates !== true || p.platform !== env.platform || p.arch !== env.arch) return off;
  if (["win32", "darwin"].includes(env.platform) ? p.trust !== "signed" : env.platform !== "linux" || !env.appImage || p.trust !== "appimage") return off;
  const channel = env.platform === "win32" ? "windows" : env.platform === "darwin" ? "macos" : "linux";
  const feedUrl = `https://www.mycellios.com/downloads/desktop/updates/${channel}/${env.arch}`;
  if (p.feedUrl !== feedUrl || !["x64", "arm64"].includes(env.arch)) return off;
  return { enabled: true, feedUrl };
}
