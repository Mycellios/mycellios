import { describe, expect, it } from "vitest";
import { isDesktopDownloadCatalog } from "../src/contracts/desktop-downloads.js";

it('retains both Mac architectures alongside the required Windows and Linux packages',()=>{
 const c=catalog();c.packages.push({id:'macos-arm64',format:'DMG',fileName:'Mac-arm.dmg',path:'/downloads/desktop/releases/0.3.9/Mac-arm.dmg',sha256:'c'.repeat(64),bytes:300},{id:'macos-x64',format:'DMG',fileName:'Mac-intel.dmg',path:'/downloads/desktop/releases/0.3.9/Mac-intel.dmg',sha256:'d'.repeat(64),bytes:400});
 expect(isDesktopDownloadCatalog(c)).toBe(true);c.packages[3]!.format='EXE';expect(isDesktopDownloadCatalog(c)).toBe(false);
});

const catalog = () => ({ schema: "mycellios-desktop-downloads/1", version: "0.3.9", runtimeVersion: "0.2.95", channel: "preview", automaticUpdates: false,
  packages: [{ id: "windows-x64", format: "EXE", fileName: "desktop.exe", path: "/downloads/desktop/releases/0.3.9/desktop.exe", bytes: 442140381, sha256: "a".repeat(64) },
    { id: "linux-x64", format: "DEB", fileName: "desktop.deb", path: "/downloads/desktop/releases/0.3.9/desktop.deb", bytes: 601542764, sha256: "b".repeat(64) }],
  source: { path: "/downloads/desktop/releases/0.3.9/source.tar.gz", sha256: "c".repeat(64) } });
describe("Desktop release identity and download safety", () => {
  it("accepts the separately published preview without automatic unsigned updates", () => expect(isDesktopDownloadCatalog(catalog())).toBe(true));
  it.each(["https://elsewhere.test/a.exe", "//elsewhere.test/a.exe", "/downloads/windows", "/downloads/desktop/releases/0.3.8/desktop.exe", "/downloads/desktop/releases/0.3.9/../a.exe", "/downloads/desktop/releases/0.3.9/%2e%2e/a.exe"])("rejects another origin, runtime route or release: %s", path => { const c = catalog(); c.packages[0]!.path = path; expect(isDesktopDownloadCatalog(c)).toBe(false); });
  it("rejects duplicate platforms and a missing platform", () => { const c = catalog(); c.packages[1] = c.packages[0]!; expect(isDesktopDownloadCatalog(c)).toBe(false); c.packages.pop(); expect(isDesktopDownloadCatalog(c)).toBe(false); });
  it("rejects installer type substitution", () => { const c = catalog(); c.packages[0]!.format = "DEB"; expect(isDesktopDownloadCatalog(c)).toBe(false); });
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("requires a positive integral file length: %s", bytes => { const c = catalog(); c.packages[0]!.bytes = bytes; expect(isDesktopDownloadCatalog(c)).toBe(false); });
  it("requires valid checksums and source availability", () => { const c = catalog(); c.source.sha256 = "missing"; expect(isDesktopDownloadCatalog(c)).toBe(false); c.source.sha256 = "c".repeat(64); c.packages[0]!.sha256 = "unknown"; expect(isDesktopDownloadCatalog(c)).toBe(false); });
  it("does not silently enable an unsigned automatic-update channel", () => expect(isDesktopDownloadCatalog({ ...catalog(), automaticUpdates: true })).toBe(false));
});

it("keeps another platform only with its actual version and corresponding source",()=>{
 const c=catalog();const linux={...c.packages[1]!,version:"0.3.8",path:"/downloads/desktop/releases/0.3.8/desktop.deb",source:{path:"/downloads/desktop/releases/0.3.8/source.tar.gz",sha256:"d".repeat(64)}};
 expect(isDesktopDownloadCatalog({...c,packages:[c.packages[0],linux]})).toBe(true);
 expect(isDesktopDownloadCatalog({...c,packages:[c.packages[0],{...linux,source:undefined}]})).toBe(false);
 expect(isDesktopDownloadCatalog({...c,packages:[c.packages[0],{...linux,source:c.source}]})).toBe(false);
 expect(isDesktopDownloadCatalog({...c,packages:[c.packages[0],{...linux,version:"../0.3.8"}]})).toBe(false);
});

it("retains the qualified optional Apple Silicon package with the required legacy platforms",()=>{
 const c=catalog();const mac={id:"macos-arm64",format:"DMG",fileName:"desktop.dmg",path:"/downloads/desktop/releases/0.3.9/desktop.dmg",bytes:415305439,sha256:"e".repeat(64)};
 expect(isDesktopDownloadCatalog({...c,packages:[...c.packages,mac]})).toBe(true);
 expect(isDesktopDownloadCatalog({...c,packages:[c.packages[0],mac]})).toBe(false);
 expect(isDesktopDownloadCatalog({...c,packages:[...c.packages,{...mac,format:"EXE"}]})).toBe(false);
});
