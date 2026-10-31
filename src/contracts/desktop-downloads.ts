/** Desktop and headless runtime releases have separate identities and channels. */
export interface DesktopDownloadCatalog {
  schema: "mycellios-desktop-downloads/1";
  version: string;
  runtimeVersion: string;
  channel: "preview";
  automaticUpdates: false;
  packages: Array<{
    id: "windows-x64" | "linux-x64";
    format: "EXE" | "DEB";
    fileName: string;
    path: string;
    sha256: string;
    bytes: number;
  }>;
  source: { path: string; sha256: string };
}

export function isDesktopDownloadCatalog(value: unknown): value is DesktopDownloadCatalog {
  if (!value || typeof value !== "object") return false;
  const c = value as Record<string, unknown>;
  if (c.schema !== "mycellios-desktop-downloads/1" || typeof c.version !== "string" || !/^\d+\.\d+\.\d+$/.test(c.version)
    || typeof c.runtimeVersion !== "string" || !/^\d+\.\d+\.\d+$/.test(c.runtimeVersion)
    || c.channel !== "preview" || c.automaticUpdates !== false || !Array.isArray(c.packages) || c.packages.length !== 2) return false;
  const version = c.version;
  const safePath = (p: unknown) => typeof p === "string" && new RegExp(`^/downloads/desktop/releases/${version.replaceAll(".", "\\.")}/[A-Za-z0-9._-]+$`).test(p) && !p.includes("..");
  const ids = new Set<string>();
  for (const item of c.packages) {
    if (!item || typeof item !== "object") return false;
    const p = item as Record<string, unknown>;
    const extension = p.id === "windows-x64" && p.format === "EXE" ? ".exe" : p.id === "linux-x64" && p.format === "DEB" ? ".deb" : null;
    if (!extension || ids.has(String(p.id)) || typeof p.fileName !== "string" || !p.fileName.endsWith(extension)
      || !safePath(p.path) || !(p.path as string).endsWith("/" + p.fileName)
      || typeof p.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(p.sha256)
      || typeof p.bytes !== "number" || !Number.isSafeInteger(p.bytes) || p.bytes <= 0) return false;
    ids.add(String(p.id));
  }
  if (!c.source || typeof c.source !== "object") return false;
  const source = c.source as Record<string, unknown>;
  return safePath(source.path) && typeof source.sha256 === "string" && /^[a-f0-9]{64}$/.test(source.sha256);
}
