import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { isDesktopDownloadCatalog } from "../../src/contracts/desktop-downloads";
import { DesktopDownloads } from "./DesktopDownloads";
import { FEDORA_DESKTOP_DOWNLOAD } from "./desktop-fedora-download";

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
  it("exposes the published Fedora RPM independently of the legacy catalog", () => {
    const html = renderToStaticMarkup(<DesktopDownloads />);
    expect(html).toContain(`href="${FEDORA_DESKTOP_DOWNLOAD.path}"`);
    expect(html).toContain('aria-label="Download for Fedora"');
    expect(html).not.toContain("Download RPM");
    expect(html).toContain(`sudo dnf install ./${FEDORA_DESKTOP_DOWNLOAD.fileName}`);
    expect(html).toContain(FEDORA_DESKTOP_DOWNLOAD.sha256);
    expect(FEDORA_DESKTOP_DOWNLOAD.path).toBe(`https://github.com/Mycellios/mycellios/releases/download/desktop-v${FEDORA_DESKTOP_DOWNLOAD.version}-fedora-preview/${FEDORA_DESKTOP_DOWNLOAD.fileName}`);
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
});
