import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { isDesktopDownloadCatalog } from "../../src/contracts/desktop-downloads";
import { DesktopDownloads, detectInstaller } from "./DesktopDownloads";

const catalog = () => ({
  schema: "mycellios-desktop-downloads/1", version: "0.3.9", runtimeVersion: "0.2.95",
  channel: "preview", automaticUpdates: false,
  packages: [
    { id: "windows-x64", format: "EXE", fileName: "Desktop.exe", path: "/downloads/desktop/releases/0.3.9/Desktop.exe", sha256: "a".repeat(64), bytes: 100 },
    { id: "linux-x64", format: "DEB", fileName: "Desktop.deb", path: "/downloads/desktop/releases/0.3.9/Desktop.deb", sha256: "b".repeat(64), bytes: 200 },
  ],
  source: { path: "/downloads/desktop/releases/0.3.9/source.tar.gz", sha256: "c".repeat(64) },
});

describe("Desktop downloads", () => {
  it("distinguishes Intel and Apple Silicon without removing supported downloads", () => {
    const html=renderToStaticMarkup(<DesktopDownloads />);
    expect(html).toContain('Download for macOS · Intel');expect(html).toContain('Download for macOS · Apple silicon');expect(html).toContain('macOS 13 or later');
    expect(html).not.toContain('Intel Macs are not supported');
  });
  it("recommends the visitor's installer without jargon-only Mac choices", async () => {
    const nav = (userAgent: string, extra: Record<string, unknown> = {}) => ({ userAgent, platform: "", maxTouchPoints: 0, ...extra }) as unknown as Navigator;
    const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";
    expect(await detectInstaller(nav("Mozilla/5.0 (Windows NT 10.0; Win64; x64)"))).toBe("windows-x64");
    expect(await detectInstaller(nav(mac, { userAgentData: { platform: "macOS", getHighEntropyValues: async () => ({ architecture: "arm" }) } }))).toBe("macos-arm64");
    expect(await detectInstaller(nav(mac, { userAgentData: { platform: "macOS", getHighEntropyValues: async () => ({ architecture: "x86" }) } }))).toBe("macos-x64");
    expect(await detectInstaller(nav(mac, { platform: "MacIntel" }))).toBe("macos-arm64");
    expect(await detectInstaller(nav(mac, { platform: "MacIntel", maxTouchPoints: 5 }))).toBe("");
    expect(await detectInstaller(nav("Mozilla/5.0 (Linux; Android 14)"))).toBe("");
    expect(await detectInstaller(nav("Mozilla/5.0 (X11; Fedora; Linux x86_64)"))).toBe("fedora-x64");
    const html = renderToStaticMarkup(<DesktopDownloads />);
    expect(html).toContain(">Apple silicon<"); expect(html).toContain("About This Mac");
    expect(html).not.toMatch(/<details[^>]* open/);
  });
  it("waits for the release catalog before offering the Fedora download", () => {
    const html = renderToStaticMarkup(<DesktopDownloads />);
    expect(html).toMatch(/<button(?=[^>]*disabled)(?=[^>]*aria-label="Download for Fedora")/);
    expect(html).not.toContain("dnf install");
  });

  it("retains the existing two-package catalog contract", () => {
    expect(isDesktopDownloadCatalog(catalog())).toBe(true);
  });

  it("rejects duplicate platforms and untrusted installer paths", () => {
    const duplicate = catalog();
    duplicate.packages[1] = { ...duplicate.packages[0]! };
    expect(isDesktopDownloadCatalog(duplicate)).toBe(false);
    for (const path of ["https://example.com/Desktop.exe", "/downloads/desktop/releases/0.3.9/../Desktop.exe", "/downloads/desktop/releases/0.3.8/Desktop.exe"]) {
      const invalid = catalog();
      invalid.packages[0]!.path = path;
      expect(isDesktopDownloadCatalog(invalid)).toBe(false);
    }
  });
  it("accepts the published checksum query only when it matches the installer", () => {
    const release = catalog();
    const original = release.packages[0]!.path;
    release.packages[0]!.path = `${original}?sha256=${release.packages[0]!.sha256}`;
    expect(isDesktopDownloadCatalog(release)).toBe(true);
    for (const query of [`sha256=${"b".repeat(64)}`, "redirect=https://example.com", `sha256=${"a".repeat(64)}&extra=1`, `sha256=${"a".repeat(64)}#fragment`]) {
      release.packages[0]!.path = `${original}?${query}`;
      expect(isDesktopDownloadCatalog(release)).toBe(false);
    }
  });
});
