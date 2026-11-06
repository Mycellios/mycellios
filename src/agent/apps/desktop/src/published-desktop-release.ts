import { newerRelease, type ManualRelease } from "./manual-update.js";

const REPOSITORY = "https://github.com/Mycellios/mycellios/releases/download/";
const API = "https://api.github.com/repos/Mycellios/mycellios/releases?per_page=20";
const MAX_BYTES = 2_000_000_000;
const VERSION = "(0|[1-9]\\d{0,5})\\.(0|[1-9]\\d{0,5})\\.(0|[1-9]\\d{0,5})";
const TAG = new RegExp(`^desktop-v${VERSION}-windows-preview$`);

/** Only the owned release URL may redirect, and only to GitHub's release-asset CDN. */
export async function fetchDesktopArtifact(fetcher: typeof fetch, url: string, signal: AbortSignal): Promise<Response> {
  if (url.includes("..") || url.includes("%")) throw Error("Invalid Desktop artifact path");
  const initial = new URL(url);
  const github = initial.origin === "https://github.com" &&
    /^\/Mycellios\/mycellios\/releases\/download\/desktop-v[0-9.]+-windows-preview\/[A-Za-z0-9._-]+$/.test(initial.pathname);
  const official = initial.origin === "https://www.mycellios.com" &&
    /^\/downloads\/desktop\/releases\/[0-9.]+\/[A-Za-z0-9._-]+$/.test(initial.pathname);
  if (initial.username || initial.password || initial.search || initial.hash || (!github && !official))
    throw Error("Invalid Desktop artifact origin");
  let target = initial;
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetcher(target.href, {redirect: "manual", credentials: "omit", signal,
      headers: {"Accept-Encoding": "identity"}});
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
