import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ManualUpdateController, windowsManualRelease, type ManualRelease } from "./manual-update.js";

const bytes = new Uint8Array(Buffer.from("MZcontrolled-installer-fixture"));
const entry = { id: "windows-x64", version: "0.3.15", format: "EXE",
  fileName: "Mycellios-Desktop-0.3.15-windows-x64-pilot.exe",
  path: "/downloads/desktop/releases/0.3.15/Mycellios-Desktop-0.3.15-windows-x64-pilot.exe",
  bytes: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") };
const catalog = { automaticUpdates: false, packages: [entry] };
const folders: string[] = [];
afterEach(async () => { for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true }); });
async function fixture(overrides: { busy?: () => boolean; prepare?: () => Promise<boolean>; body?: Uint8Array;
  backgroundDownloads?: boolean; publishedRelease?: () => Promise<ManualRelease | null>; catalogUnavailable?: boolean } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "manual-update-")); folders.push(directory);
  const handoff = vi.fn(async () => {});
  const request = vi.fn(async (url: string | URL | Request) => String(url).endsWith("desktop-downloads")
    ? overrides.catalogUnavailable ? new Response(null, {status: 503}) : new Response(JSON.stringify(catalog)) : new Response(overrides.body ?? bytes));
  const controller = new ManualUpdateController({ version: "0.3.13", directory: () => directory,
    fetch: request, busy: overrides.busy ?? (() => false), prepare: overrides.prepare ?? (async () => true), handoff,
    backgroundDownloads: overrides.backgroundDownloads, publishedRelease: overrides.publishedRelease });
  return { controller, handoff, request, directory };
}
describe("official Windows manual releases", () => {
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
    expect(request).toHaveBeenCalledTimes(2);
    expect(handoff).not.toHaveBeenCalled();
  });
  it("keeps a failed background transfer quiet and permits a later explicit retry", async () => {
    const { controller, request, handoff } = await fixture({ backgroundDownloads: true, body: bytes.subarray(0, 3) });
    expect(await controller.check(false)).toMatchObject({ phase: "idle", message: null });
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
