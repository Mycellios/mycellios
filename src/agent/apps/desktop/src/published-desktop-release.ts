import { catalogManualRelease, newerRelease } from "./manual-update.js";
import type { ManualRelease, ManualPackageKind } from "./manual-update.js";

const REPOSITORY = "https://github.com/Mycellios/mycellios/releases/download/";
const API = "https://api.github.com/repos/Mycellios/mycellios/releases?per_page=20";
const MAX_BYTES = 2_000_000_000;
const VERSION = "(0|[1-9]\\d{0,5})\\.(0|[1-9]\\d{0,5})\\.(0|[1-9]\\d{0,5})";
const TAG = new RegExp(`^desktop-v${VERSION}-windows-preview$`);

/** Only the owned release URL may redirect, and only to GitHub's release-asset CDN. */
export async function fetchDesktopArtifact(fetcher: typeof fetch, url: string, signal: AbortSignal, expectedSha256?: string, range?: string): Promise<Response> {
  if (range !== undefined && !/^bytes=\d+-\d+$/.test(range)) throw Error("Invalid Desktop artifact range");
  if (url.includes("..") || url.includes("%")) throw Error("Invalid Desktop artifact path");
  const initial = new URL(url);
  const runtimePath = typeof expectedSha256 === "string" && /^[a-f0-9]{64}$/.test(expectedSha256) &&
    new RegExp(`^/Mycellios/mycellios/releases/download/desktop-runtime-${expectedSha256}/mycellios-runtime\\.(pkg|msi|deb)$`).test(initial.pathname);
  const github = initial.origin === "https://github.com" &&
    (runtimePath || /^\/Mycellios\/mycellios\/releases\/download\/desktop-v[0-9.]+-windows-preview\/[A-Za-z0-9._-]+$/.test(initial.pathname));
  const official = initial.origin === "https://www.mycellios.com" &&
    /^\/downloads\/desktop\/releases\/[0-9.]+\/[A-Za-z0-9._-]+$/.test(initial.pathname);
  const pinnedQuery = official && typeof expectedSha256 === "string" && /^[a-f0-9]{64}$/.test(expectedSha256) &&
    initial.search === `?sha256=${expectedSha256}`;
  if (initial.username || initial.password || (initial.search && !pinnedQuery) || initial.hash || (!github && !official))
    throw Error("Invalid Desktop artifact origin");
  let target = initial;
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetcher(target.href, {redirect: "manual", credentials: "omit", signal,
      headers: {"Accept-Encoding": "identity", ...(range ? {Range: range} : {})}});
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!github || !location) throw Error("Unexpected Desktop download redirect");
    const next = new URL(location, target);
    if (next.origin !== "https://release-assets.githubusercontent.com" || next.username || next.password || next.hash)
      throw Error("Untrusted Desktop download redirect");
    target = next;
  }
  throw Error("Too many Desktop download redirects");
}

async function json(response: Response, limit: number): Promise<unknown> {
  if (!response.ok || !response.body) throw Error("Desktop release feed unavailable");
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let size = 0, text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) throw Error("Desktop release metadata exceeds limit");
      text += decoder.decode(chunk.value, {stream: true});
    }
    return JSON.parse(text + decoder.decode());
  } finally { await reader.cancel().catch(() => undefined); }
}

export function publishedWindowsArtifact(manifest: unknown, version: string): ManualRelease {
  const m = manifest as Record<string, unknown> | null;
  const tag = `desktop-v${version}-windows-preview`;
  const a = m?.artifact as Record<string, unknown> | undefined;
  const fileName = `Mycellios-Desktop-${version}-windows-x64-pilot.exe`;
  if (!TAG.test(tag) || m?.schema !== "mycellios-desktop-release-package/1" || m.version !== version ||
      m.tag !== tag || m.platform !== "windows-x64" || m.automaticUpdates !== false ||
      m.qualifiedStartup !== true || m.signature !== "unsigned-preview" ||
      typeof m.revision !== "string" || !/^[a-f0-9]{40}$/.test(m.revision) ||
      typeof m.tree !== "string" || !/^[a-f0-9]{40}$/.test(m.tree) ||
      a?.fileName !== fileName || typeof a.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(a.sha256) ||
      typeof a.bytes !== "number" || !Number.isSafeInteger(a.bytes) || a.bytes <= 0 || a.bytes > MAX_BYTES)
    throw Error("Invalid published Windows package");
  return {version, fileName, bytes: a.bytes, sha256: a.sha256, url: REPOSITORY + tag + "/" + fileName};
}

/** Desktop tags are independent of the headless runtime's latest release and never read main. */
export async function publishedWindowsRelease(current: string, fetcher: typeof fetch = fetch): Promise<ManualRelease | null> {
  const signal = AbortSignal.timeout(30_000);
  const list = await json(await fetcher(API, {redirect: "error", credentials: "omit", signal,
    headers: {Accept: "application/vnd.github+json"}}), 512_000);
  if (!Array.isArray(list) || list.length > 20) throw Error("Invalid published release list");
  const releases = list.flatMap((r: {tag_name?: unknown; draft?: unknown; assets?: unknown}) => {
    if (!r || r.draft !== false || typeof r.tag_name !== "string" || !TAG.test(r.tag_name) || !Array.isArray(r.assets)) return [];
    const version = r.tag_name.slice(9, -16);
    // Exact metadata asset: legacy installers without qualification are not offered from this feed.
    return newerRelease(version, current) && r.assets.some(a => a?.name === "desktop-release.json") ? [{version, tag: r.tag_name}] : [];
  }).sort((a, b) => newerRelease(a.version, b.version) ? -1 : newerRelease(b.version, a.version) ? 1 : 0);
  const selected = releases[0];
  if (!selected) return null;
  const manifest = await json(await fetchDesktopArtifact(fetcher, REPOSITORY + selected.tag + "/desktop-release.json", signal), 32_000);
  return publishedWindowsArtifact(manifest, selected.version);
}


/** All native platform checks finish before this integrated receipt is exposed. */
export function publishedDesktopArtifact(manifest: unknown, version: string, kind: ManualPackageKind): ManualRelease {
  const m = manifest as Record<string, unknown> | null;
  const platforms = m?.platforms as Record<string, unknown>[] | undefined;
  const expected = ["windows-x64", "linux-x64", "fedora-x64", "macos-arm64", "macos-x64"];
  if (m?.schema !== "mycellios-installer-release/1" || m.version !== version || m.automaticUpdates !== false ||
      typeof m.revision !== "string" || !/^[a-f0-9]{40}$/.test(m.revision) ||
      typeof m.tree !== "string" || !/^[a-f0-9]{40}$/.test(m.tree) ||
      !Number.isSafeInteger(m.workflowRun) || (m.workflowRun as number) <= 0 ||
      !Array.isArray(platforms) || platforms.length !== expected.length ||
      expected.some(id => platforms.filter(p => p?.id === id).length !== 1))
    throw Error("Invalid integrated Desktop release");
  for (const id of expected as ManualPackageKind[]) {
    const p = platforms.find(p => p.id === id)!;
    const e = { ...p, path: `/downloads/desktop/releases/${version}/${p.fileName}` };
    const validated = catalogManualRelease(id === "fedora-x64" ? { fedora: e } : { packages: [e] }, "0.0.0", id);
    if (validated?.version !== version) throw Error("Mixed integrated Desktop release");
  }
  const entry = platforms.find(p => p.id === kind)!;
  // Reuse the catalog's exact version/architecture/name/hash/size contract.
  const fileName = entry.fileName;
  const catalogEntry = { ...entry, path: `/downloads/desktop/releases/${version}/${fileName}` };
  const catalog = kind === "fedora-x64" ? { fedora: catalogEntry } : { packages: [catalogEntry] };
  const release = catalogManualRelease(catalog, "0.0.0", kind);
  if (!release || release.version !== version) throw Error("Invalid integrated platform artifact");
  return { ...release, url: REPOSITORY + `desktop-v${version}-windows-preview/` + release.fileName };
}

export async function publishedDesktopRelease(current: string, kind: ManualPackageKind, fetcher: typeof fetch = fetch): Promise<ManualRelease | null> {
  const signal = AbortSignal.timeout(30_000);
  const list = await json(await fetcher(API, { redirect: "error", credentials: "omit", signal,
    headers: { Accept: "application/vnd.github+json" } }), 512_000);
  if (!Array.isArray(list) || list.length > 20) throw Error("Invalid published release list");
  const candidates = list.filter(r => r && r.draft === false && r.author?.login === "github-actions[bot]" &&
    typeof r.tag_name === "string" && TAG.test(r.tag_name) && Array.isArray(r.assets) &&
    r.assets.some((a: { name?: string }) => a?.name === "installer-release.json") &&
    newerRelease(r.tag_name.slice(9, -16), current))
    .sort((a, b) => newerRelease(a.tag_name.slice(9, -16), b.tag_name.slice(9, -16)) ? -1 : 1);
  const selected = candidates[0];
  if (!selected) return kind === "windows-x64" ? publishedWindowsRelease(current, fetcher) : null;
  const version = selected.tag_name.slice(9, -16);
  const manifest = await json(await fetchDesktopArtifact(fetcher, REPOSITORY + selected.tag_name + "/installer-release.json", signal), 128_000) as Record<string, unknown>;
  const release = publishedDesktopArtifact(manifest, version, kind);
  const receiptName = kind === "windows-x64" ? "desktop-release.json"
    : `platform-release-${kind === "linux-x64" || kind === "fedora-x64" ? "linux" : kind}.json`;
  const receipts = selected.assets.filter((a: { name?: string }) => a?.name === receiptName);
  if (receipts.length !== 1) throw Error("Missing native release receipt");
  const receipt = await json(await fetchDesktopArtifact(fetcher, REPOSITORY + selected.tag_name + "/" + receiptName, signal), 128_000) as Record<string, unknown> | null;
  if (receipt?.revision !== manifest.revision || receipt?.tree !== manifest.tree || receipt?.version !== version ||
      receipt?.qualifiedStartup !== true || receipt?.automaticUpdates !== false) throw Error("Native release source differs");
  if (kind === "windows-x64") {
    const native = publishedWindowsArtifact(receipt, version);
    if (receipt.qualifiedInstallation !== true || native.fileName !== release.fileName || native.sha256 !== release.sha256 || native.bytes !== release.bytes)
      throw Error("Native Windows qualification differs");
  } else {
    const platform = kind === "linux-x64" || kind === "fedora-x64" ? "linux" : kind;
    const files = receipt.files;
    const native = Array.isArray(files) ? files.filter((f: { id?: string }) => f?.id === kind) : [];
    if (receipt.schema !== "mycellios-platform-release/1" || receipt.platform !== platform || native.length !== 1 ||
        native[0].fileName !== release.fileName || native[0].sha256 !== release.sha256 || native[0].bytes !== release.bytes)
      throw Error("Native platform qualification differs");
  }
  const assets = selected.assets.filter((a: { name?: string }) => a?.name === release.fileName);
  if (assets.length !== 1 || assets[0].size !== release.bytes || assets[0].digest !== "sha256:" + release.sha256)
    throw Error("Published Desktop asset differs from its receipt");
  return release;
}
