import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ManualUpdateController, ManualUpdateDiskSpaceError, catalogManualRelease, windowsManualRelease, type ManualPackageKind, type ManualRelease } from "./manual-update.js";

const bytes = new Uint8Array(Buffer.from("MZcontrolled-installer-fixture"));
const entry = { id: "windows-x64", version: "0.3.15", format: "EXE",
  fileName: "Mycellios-Desktop-0.3.15-windows-x64-pilot.exe",
  path: "/downloads/desktop/releases/0.3.15/Mycellios-Desktop-0.3.15-windows-x64-pilot.exe",
  bytes: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") };
const catalog = { automaticUpdates: false, packages: [entry] };
const folders: string[] = [];
afterEach(async () => { for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true }); });
async function fixture(overrides: { busy?: () => boolean; prepare?: () => Promise<boolean>; body?: Uint8Array;
  autoDownload?: () => boolean; backgroundDownloads?: boolean; publishedRelease?: () => Promise<ManualRelease | null>; catalogUnavailable?: boolean;
  packageKind?: ManualPackageKind; installAction?: "restart" | "system-installer"; catalog?: unknown } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "manual-update-")); folders.push(directory);
  const handoff = vi.fn(async () => {});
  const request = vi.fn(async (url: string | URL | Request) => String(url).includes("/public/v1/desktop-downloads")
    ? overrides.catalogUnavailable ? new Response(null, {status: 503}) : new Response(JSON.stringify(overrides.catalog ?? catalog)) : new Response(overrides.body ?? bytes));
  const controller = new ManualUpdateController({ version: "0.3.13", directory: () => directory,
    fetch: request, busy: overrides.busy ?? (() => false), prepare: overrides.prepare ?? (async () => true), handoff,
    autoDownload: overrides.autoDownload, backgroundDownloads: overrides.backgroundDownloads, publishedRelease: overrides.publishedRelease,
    packageKind: overrides.packageKind, installAction: overrides.installAction });
  return { controller, handoff, request, directory };
}
describe("official Windows manual releases", () => {
  it("checks metadata without downloading when the user disables automatic downloads", async () => {
    const { controller, request, handoff } = await fixture({ backgroundDownloads: true, autoDownload: () => false });
    expect(await controller.check(true)).toMatchObject({ phase: "available", availableVersion: entry.version });
    expect(request).toHaveBeenCalledTimes(1);
    expect(await controller.download()).toMatchObject({ phase: "ready", availableVersion: entry.version });
    expect(request).toHaveBeenCalledTimes(2); expect(handoff).not.toHaveBeenCalled();
  });
  it("stages a newer published package even when the website catalog is unavailable", async () => {
    const version = "0.3.17", fileName = `Mycellios-Desktop-${version}-windows-x64-pilot.exe`;
    const published: ManualRelease = {version, fileName, bytes: bytes.byteLength, sha256: entry.sha256,
      url: `https://github.com/Mycellios/mycellios/releases/download/desktop-v${version}-windows-preview/${fileName}`};
    const {controller, handoff, directory} = await fixture({catalogUnavailable: true,
      backgroundDownloads: true, publishedRelease: async () => published});
    expect(await controller.check(false)).toMatchObject({phase: "ready", availableVersion: version});
    expect(await readFile(path.join(directory, fileName))).toEqual(Buffer.from(bytes));
    expect(handoff).not.toHaveBeenCalled();
  });
  it("retains the official catalog when the secondary feed fails", async () => {
    const {controller, handoff} = await fixture({backgroundDownloads: true,
      publishedRelease: async () => {throw Error("Feed offline");}});
    expect(await controller.check(false)).toMatchObject({phase: "ready", availableVersion: entry.version});
    expect(handoff).not.toHaveBeenCalled();
  });
  it("downloads the published package in the background without closing the app or installing", async () => {
    const prepare = vi.fn(async () => true);
    const { controller, handoff, request } = await fixture({ backgroundDownloads: true, prepare });
    const first = controller.check(false);
    expect(controller.check(true)).toBe(first);
    expect(await first).toMatchObject({ phase: "ready", availableVersion: "0.3.15" });
    expect(controller.state().installPending).not.toBe(true);
    expect(request).toHaveBeenCalledTimes(2);
    expect(prepare).not.toHaveBeenCalled();
    expect(handoff).not.toHaveBeenCalled();
    await controller.check(false);
    expect(request).toHaveBeenCalledTimes(3);
    expect(handoff).not.toHaveBeenCalled();
  });
  it("refreshes a staged release without downgrading or installing it", async () => {
    let published: ManualRelease | null = null;
    const { controller, handoff } = await fixture({ backgroundDownloads: true, publishedRelease: async () => published });
    expect(await controller.check(false)).toMatchObject({ phase: "ready", availableVersion: entry.version });
    const version = "0.3.17";
    const fileName = `Mycellios-Desktop-${version}-windows-x64-pilot.exe`;
    published = { version, fileName, bytes: entry.bytes, sha256: entry.sha256,
      url: `https://github.com/Mycellios/mycellios/releases/download/desktop-v${version}-windows-preview/${fileName}` };
    expect(await controller.check(false)).toMatchObject({ phase: "ready", availableVersion: version });
    published = null;
    expect(await controller.check(false)).toMatchObject({ phase: "ready", availableVersion: version });
    expect(handoff).not.toHaveBeenCalled();
  });
  it("keeps a verified update available for recovery after a failed transfer", async () => {
    const { controller, request, handoff } = await fixture({ backgroundDownloads: true, body: bytes.subarray(0, 3) });
    expect(await controller.check(false)).toMatchObject({ phase: "error", availableVersion: "0.3.15" });
    expect(handoff).not.toHaveBeenCalled();
    expect(await controller.check(true)).toMatchObject({ phase: "error" });
    expect(request).toHaveBeenCalledTimes(4);
  });
  it("rejects unsafe paths, hashes, sizes, versions and duplicate platform offers", () => {
    for (const patch of [{ path: "https://other.invalid/app.exe" }, { path: "/downloads/../other.exe" },
      { fileName: "../app.exe" }, { sha256: "wrong" }, { bytes: 2_000_000_001 }, { bytes: -1 },
      { version: "0.3.16-unsafe" }, { format: "MSI" }])
      expect(() => windowsManualRelease({ packages: [{ ...entry, ...patch }] }, "0.3.13")).toThrow();
    expect(() => windowsManualRelease({ packages: [entry, entry] }, "0.3.13")).toThrow();
    expect(windowsManualRelease(catalog, "0.3.15")).toBeNull();
    expect(windowsManualRelease(catalog, "0.3.16")).toBeNull();
    expect(windowsManualRelease(catalog, "0.3.13")?.url).toBe("https://www.mycellios.com" + entry.path);
  });
  it("does no background check or install and serializes explicit verified downloads", async () => {
    const { controller, request, handoff, directory } = await fixture();
    await controller.check(false); expect(request).not.toHaveBeenCalled();
    const first = controller.check(true), second = controller.check(true);
    expect(first).toBe(second);
    expect(await first).toMatchObject({ phase: "ready", availableVersion: "0.3.15" });
    expect(request).toHaveBeenCalledTimes(2); expect(handoff).not.toHaveBeenCalled();
    expect(request.mock.calls[0]?.[0]).toBe("https://www.mycellios.com/public/v1/desktop-downloads");
    expect(await readFile(path.join(directory, entry.fileName))).toEqual(Buffer.from(bytes));
  });
  it("never offers a truncated or checksum-mismatched executable", async () => {
    for (const body of [bytes.subarray(0, 3), new Uint8Array(bytes.length).fill(7)]) {
      const { controller, directory, handoff } = await fixture({ body });
      expect(await controller.check(true)).toMatchObject({ phase: "error" });
      await controller.install(); expect(handoff).not.toHaveBeenCalled();
      expect(await readdir(directory)).toEqual([]);
    }
  });
  it("waits for active work, supports cancellation and never replays the install", async () => {
    let busy = true;
    const { controller, handoff } = await fixture({ busy: () => busy });
    await controller.check(true);
    expect(await controller.install()).toMatchObject({ installPending: true });
    await controller.install(); expect(handoff).not.toHaveBeenCalled();
    await controller.cancelInstall(); busy = false;
    await new Promise(resolve => setTimeout(resolve, 1_050));
    expect(handoff).not.toHaveBeenCalled();
    await controller.install(); await vi.waitFor(() => expect(handoff).toHaveBeenCalledTimes(1));
    await controller.install(); expect(handoff).toHaveBeenCalledTimes(1);
  });
  it("keeps the verified installer ready when disk space blocks the restart", async () => {
    const { controller, handoff } = await fixture();
    handoff.mockRejectedValueOnce(new ManualUpdateDiskSpaceError());
    await controller.check(true);
    await controller.install();
    await vi.waitFor(() => expect(controller.state()).toMatchObject({
      phase: "ready", installPending: false, message: "Free at least 6 GB of disk space before restarting to update.",
    }));
    await controller.install();
    await vi.waitFor(() => expect(handoff).toHaveBeenCalledTimes(2));
  });
  it("requires renderer acknowledgement and rechecks activity after acknowledgement", async () => {
    let ready = false, busy = false;
    const { controller, handoff } = await fixture({ busy: () => busy, prepare: async () => { busy = ready; return ready; } });
    await controller.check(true); await controller.install();
    await new Promise(resolve => setTimeout(resolve, 20)); expect(handoff).not.toHaveBeenCalled();
    ready = true;
    await new Promise(resolve => setTimeout(resolve, 1_050)); expect(handoff).not.toHaveBeenCalled();
    await controller.cancelInstall();
  });
  it("rechecks the executable immediately before handoff and makes tampering retryable", async () => {
    const { controller, handoff, directory } = await fixture();
    await controller.check(true); await writeFile(path.join(directory, entry.fileName), "changed");
    await controller.install();
    await vi.waitFor(() => expect(controller.state()).toMatchObject({ phase: "error", installPending: false }));
    expect(handoff).not.toHaveBeenCalled();
    expect(await controller.check(true)).toMatchObject({ phase: "ready" });
  });
  it("does not consume the installer repeatedly while the renderer still holds unsaved work", async () => {
    let ready = false;
    const { controller, directory, handoff } = await fixture({ prepare: async () => ready });
    await controller.check(true);
    await writeFile(path.join(directory, entry.fileName), "changed while waiting");
    await controller.install();
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(controller.state()).toMatchObject({ phase: "ready", installPending: true });
    expect(handoff).not.toHaveBeenCalled();
    ready = true;
    await vi.waitFor(() => expect(controller.state()).toMatchObject({ phase: "error", installPending: false }), { timeout: 2_000 });
    expect(handoff).not.toHaveBeenCalled();
  });
});

it("explicit restart bypasses continuous native work but never bypasses saving renderer state", async () => {
  let saved=false;
  const {controller,handoff}=await fixture({busy:()=>true,prepare:async()=>saved});
  await controller.check(true);
  await controller.install();
  expect(controller.state().installPending).toBe(true);
  await controller.install(true);
  await vi.waitFor(()=>expect(controller.state().waitingFor).toBe("unsaved_work"),{timeout:3000});
  expect(handoff).not.toHaveBeenCalled();
  saved=true;
  await vi.waitFor(()=>expect(handoff).toHaveBeenCalledTimes(1),{timeout:5000});
  expect(controller.state().restartMode).toBe("now");
});

const rpmBytes = new Uint8Array(Buffer.from("RPM-controlled-installer-fixture"));
const fedoraEntry = { id: "fedora-x64", version: "0.3.32", format: "RPM",
  fileName: "Mycellios-Desktop-0.3.32-fedora-x86_64.rpm",
  path: "/downloads/desktop/releases/0.3.32/Mycellios-Desktop-0.3.32-fedora-x86_64.rpm",
  bytes: rpmBytes.byteLength, sha256: createHash("sha256").update(rpmBytes).digest("hex"),
  source: { path: "/downloads/desktop/releases/0.3.32/Mycellios-Desktop-0.3.32-source-e25994ba.tar.gz", sha256: "a".repeat(64) } };
const fedoraCatalog = { ...catalog, fedora: fedoraEntry };

describe("official Fedora manual releases", () => {
  it("selects the RPM entry of the extended catalog for a Fedora installation", () => {
    expect(catalogManualRelease(fedoraCatalog, "0.3.30", "fedora-x64")).toMatchObject({
      version: "0.3.32", fileName: fedoraEntry.fileName,
      url: "https://www.mycellios.com" + fedoraEntry.path });
    expect(catalogManualRelease(fedoraCatalog, "0.3.32", "fedora-x64")).toBeNull();
    // Another package kind never borrows this entry.
    expect(() => catalogManualRelease(fedoraCatalog, "0.3.30", "linux-x64")).toThrow();
    expect(catalogManualRelease(fedoraCatalog, "0.3.30", "windows-x64")).toBeNull();
  });
  it("accepts the RPM builder's build revision and rejects altered artifacts", () => {
    const version = "0.3.32", fileName = "Mycellios-Desktop-0.3.32-2-fedora-x86_64.rpm";
    const rebuilt = { ...fedoraEntry, fileName, path: `/downloads/desktop/releases/${version}/${fileName}` };
    expect(catalogManualRelease({ fedora: rebuilt }, "0.3.30", "fedora-x64")?.fileName).toBe(fileName);
    for (const patch of [{ fileName: "desktop.rpm" }, { path: "https://other.invalid/desktop.rpm" },
      { path: "/downloads/../desktop.rpm" }, { sha256: "wrong" }, { bytes: 2_000_000_001 },
      { bytes: 0 }, { version: "0.3.32-2" }, { format: "DEB" }])
      expect(() => catalogManualRelease({ fedora: { ...fedoraEntry, ...patch } }, "0.3.30", "fedora-x64")).toThrow();
    expect(() => catalogManualRelease({ packages: [entry] }, "0.3.30", "fedora-x64")).toThrow();
  });
  it("downloads the verified RPM and hands it to the system installer without quitting", async () => {
    const { controller, handoff, request, directory } = await fixture({ packageKind: "fedora-x64",
      installAction: "system-installer", catalog: fedoraCatalog, body: rpmBytes });
    expect(controller.state()).toMatchObject({ installAction: "system-installer", supportsForceRestart: false });
    expect(await controller.check(true)).toMatchObject({ phase: "ready", availableVersion: "0.3.32" });
    expect(request.mock.calls[0]?.[0]).toBe("https://www.mycellios.com/public/v1/desktop-downloads");
    expect(await readFile(path.join(directory, fedoraEntry.fileName))).toEqual(Buffer.from(rpmBytes));
    await controller.install();
    await vi.waitFor(() => expect(handoff).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(controller.state()).toMatchObject({
      phase: "ready", installPending: false, handoffComplete: true,
      message: "Opened the system installer. Restart Mycellios when it finishes.",
    }));
  });
  it("keeps an unchanged staged RPM ready after a failed system installer handoff", async () => {
    const { controller, handoff } = await fixture({ packageKind: "fedora-x64",
      installAction: "system-installer", catalog: fedoraCatalog, body: rpmBytes });
    handoff.mockRejectedValueOnce(new ManualUpdateDiskSpaceError());
    await controller.check(true);
    await controller.install();
    await vi.waitFor(() => expect(controller.state()).toMatchObject({
      phase: "ready", installPending: false, message: "Free at least 6 GB of disk space before restarting to update." }));
    expect(controller.state().handoffComplete).not.toBe(true);
    await controller.install();
    await vi.waitFor(() => expect(handoff).toHaveBeenCalledTimes(2));
  });
});
