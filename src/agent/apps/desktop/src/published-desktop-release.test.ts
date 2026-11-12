import { describe, expect, it, vi } from "vitest";
import { fetchDesktopArtifact, publishedWindowsArtifact, publishedWindowsRelease } from "./published-desktop-release.js";
const version = "0.3.17";
const tag = `desktop-v${version}-windows-preview`;
const manifest = {schema: "mycellios-desktop-release-package/1", version, tag, platform: "windows-x64",
  revision: "a".repeat(40), tree: "b".repeat(40), automaticUpdates: false, qualifiedStartup: true,
  signature: "unsigned-preview", artifact: {fileName: `Mycellios-Desktop-${version}-windows-x64-pilot.exe`, bytes: 123, sha256: "c".repeat(64)}};
const release = (tag_name: string, draft = false) => ({tag_name, draft, assets: [{name: "desktop-release.json"}]});

describe("published Desktop packages", () => {
  it("accepts signed package metadata without weakening manual update or payload checks", () => {
    const signed = {...manifest, signature: "authenticode", publisher: "Verified publisher fixture", signatureReceiptSha256: "d".repeat(64)};
    expect(publishedWindowsArtifact(signed, version)).toEqual(publishedWindowsArtifact(manifest, version));
    for (const change of [{signature: "self-signed"}, {publisher: ""}, {publisher: "\nfixture"},
      {signatureReceiptSha256: undefined}, {signatureReceiptSha256: "invalid"}, {automaticUpdates: true},
      {artifact: {...manifest.artifact, sha256: "invalid"}}])
      expect(() => publishedWindowsArtifact({...signed, ...change}, version)).toThrow();
  });
  it("selects the newest qualified Desktop tag without reading main or the headless latest release", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify([release("v0.2.999"),
      release("desktop-v0.3.99-windows-preview", true), release("desktop-v0.3.16-windows-preview"), release(tag)])))
      .mockImplementationOnce(async () => new Response(JSON.stringify([release("v0.2.999"),
        release("desktop-v0.3.99-windows-preview", true), release("desktop-v0.3.16-windows-preview"), release(tag)])))
      .mockImplementationOnce(async () => new Response(JSON.stringify(manifest)));
    expect(await publishedWindowsRelease("0.3.15", fetcher)).toMatchObject({version, sha256: "c".repeat(64)});
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
      "https://api.github.com/repos/Mycellios/mycellios/releases?per_page=20",
      `https://github.com/Mycellios/mycellios/releases/download/${tag}/desktop-release.json`,
    ]);
    for (const [, init] of fetcher.mock.calls) expect(init?.credentials).toBe("omit");
  });
  it("ignores drafts, legacy artifacts, other platforms, equal versions and downgrades", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify([
      release(tag), release("desktop-v0.3.99-windows-preview", true), release("desktop-v0.4.0-macos-preview"),
      {tag_name: "desktop-v0.3.98-windows-preview", draft: false, assets: []},
    ])));
    expect(await publishedWindowsRelease(version, fetcher)).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("rejects mixed versions, unqualified packages and invalid identity or payload metadata", () => {
    for (const change of [{version: "0.3.16"}, {qualifiedStartup: false}, {automaticUpdates: true},
      {tag: "main"}, {revision: "unknown"}, {tree: ""}, {platform: "macos-arm64"},
      {artifact: {...manifest.artifact, bytes: MAX_SAFE_INTEGER}},
      {artifact: {...manifest.artifact, fileName: "../installer.exe"}},
      {artifact: {...manifest.artifact, sha256: "invalid"}}])
      expect(() => publishedWindowsArtifact({...manifest, ...change}, version)).toThrow();
  });
  it("accepts only the release CDN redirect and keeps credentials out of every request", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, {status: 302, headers: {location: "https://release-assets.githubusercontent.com/public/payload?signature=public-download"}}))
      .mockResolvedValueOnce(new Response("verified-by-caller"));
    const response = await fetchDesktopArtifact(fetcher, publishedWindowsArtifact(manifest, version).url, AbortSignal.timeout(1000));
    expect(await response.text()).toBe("verified-by-caller");
    for (const [, init] of fetcher.mock.calls) expect(init).toMatchObject({credentials: "omit", redirect: "manual"});
  });
  it("rejects arbitrary origins, credentials, traversal, insecure or foreign redirect targets", async () => {
    for (const target of ["http://release-assets.githubusercontent.com/payload", "https://evil.invalid/app.exe",
      "https://github.com.evil.invalid/app.exe", "https://user@release-assets.githubusercontent.com/a"]){
      const fetcher = vi.fn<typeof fetch>(async () => new Response(null, {status: 302, headers: {location: target}}));
      await expect(fetchDesktopArtifact(fetcher, publishedWindowsArtifact(manifest, version).url, AbortSignal.timeout(1000))).rejects.toThrow();
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
    const fetcher = vi.fn<typeof fetch>();
    for (const target of ["https://evil.invalid/app.exe", "https://user@github.com/Mycellios/mycellios/releases/download/main/app.exe",
      "https://github.com/Mycellios/mycellios/releases/download/main/app.exe"])
      await expect(fetchDesktopArtifact(fetcher, target, AbortSignal.timeout(1000))).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("bounds release metadata before parsing", async () => {
    await expect(publishedWindowsRelease("0.3.15", vi.fn<typeof fetch>(async () => new Response(" ".repeat(512_001))))).rejects.toThrow(/limit/);
  });
});

const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
