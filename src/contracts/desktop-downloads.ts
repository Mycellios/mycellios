/** Desktop and headless runtime releases have separate identities and channels. */
export interface DesktopDownloadCatalog {
  schema: "mycellios-desktop-downloads/1";
  version: string;
  runtimeVersion: string;
  channel: "preview";
  automaticUpdates: false;
  packages: Array<{
    id: "windows-x64" | "linux-x64" | "macos-arm64" | "macos-x64";
    format: "EXE" | "DEB" | "DMG";
    fileName: string;
    path: string;
    sha256: string;
    bytes: number;
    version?: string;
    source?: { path: string; sha256: string };
  }>;
  fedora?: {
    id: "fedora-x64";
    format: "RPM";
    fileName: string;
    path: string;
    sha256: string;
    bytes: number;
    version: string;
    source: { path: string; sha256: string };
  };
  source: { path: string; sha256: string };
}

export function isDesktopDownloadCatalog(value: unknown): value is DesktopDownloadCatalog {
  if (!value || typeof value !== "object") return false;
  const c = value as Record<string, unknown>;
  if (c.schema !== "mycellios-desktop-downloads/1" || typeof c.version !== "string" || !/^\d+\.\d+\.\d+$/.test(c.version)
    || typeof c.runtimeVersion !== "string" || !/^\d+\.\d+\.\d+$/.test(c.runtimeVersion)
    || c.channel !== "preview" || c.automaticUpdates !== false || !Array.isArray(c.packages) || c.packages.length < 2 || c.packages.length > 4) return false;
  const version = c.version;
  const safePath = (p: unknown, release = version) => typeof p === "string" && new RegExp(`^/downloads/desktop/releases/${release.replaceAll(".", "\\.")}/[A-Za-z0-9._-]+$`).test(p) && !p.includes("..");
  const safeSource = (value: unknown, release: string) => {
    if (!value || typeof value !== "object") return false;
    const source = value as Record<string, unknown>;
    return safePath(source.path, release) && typeof source.sha256 === "string" && /^[a-f0-9]{64}$/.test(source.sha256);
  };
  const safeInstaller = (p: Record<string, unknown>, extension: string, release: string) =>
    typeof p.fileName === "string" && p.fileName.endsWith(extension)
    && typeof p.path === "string"
    && (() => {
      // The publisher pins the cache key to these exact immutable installer bytes.
      // Accept only that checksum query, never arbitrary parameters or redirects.
      const path = p.path as string;
      const suffix = `?sha256=${p.sha256}`;
      const installerPath = path.endsWith(suffix) ? path.slice(0, -suffix.length) : path;
      return safePath(installerPath, release) && installerPath.endsWith("/" + p.fileName);
    })()
    && typeof p.sha256 === "string" && /^[a-f0-9]{64}$/.test(p.sha256)
    && typeof p.bytes === "number" && Number.isSafeInteger(p.bytes) && p.bytes > 0;
  if (c.fedora !== undefined) {
    if (!c.fedora || typeof c.fedora !== "object") return false;
    const fedora = c.fedora as Record<string, unknown>;
    if (fedora.id !== "fedora-x64" || fedora.format !== "RPM"
      || typeof fedora.version !== "string" || !/^\d+\.\d+\.\d+$/.test(fedora.version)
      || !safeInstaller(fedora, ".rpm", fedora.version) || !safeSource(fedora.source, fedora.version)) return false;
  }
  const ids = new Set<string>();
  for (const item of c.packages) {
    if (!item || typeof item !== "object") return false;
    const p = item as Record<string, unknown>;
    const release = p.version === undefined ? version : p.version;
    if (typeof release !== "string" || !/^\d+\.\d+\.\d+$/.test(release)
      || (p.source !== undefined && !safeSource(p.source, release))
      || (release !== version && !safeSource(p.source, release))) return false;
    const extension = p.id === "windows-x64" && p.format === "EXE" ? ".exe" : p.id === "linux-x64" && p.format === "DEB" ? ".deb" : ["macos-arm64","macos-x64"].includes(String(p.id)) && p.format === "DMG" ? ".dmg" : null;
    if (!extension || ids.has(String(p.id)) || !safeInstaller(p, extension, release)) return false;
    ids.add(String(p.id));
  }
  if (!ids.has("windows-x64") || !ids.has("linux-x64")) return false;
  if (!c.source || typeof c.source !== "object") return false;
  const source = c.source as Record<string, unknown>;
  return safePath(source.path) && typeof source.sha256 === "string" && /^[a-f0-9]{64}$/.test(source.sha256);
}
