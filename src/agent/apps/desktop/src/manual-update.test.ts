import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ManualUpdateController, windowsManualRelease } from "./manual-update.js";

const bytes = new Uint8Array(Buffer.from("MZcontrolled-installer-fixture"));
const entry = { id: "windows-x64", version: "0.3.15", format: "EXE",
  fileName: "Mycellios-Desktop-0.3.15-windows-x64-pilot.exe",
  path: "/downloads/desktop/releases/0.3.15/Mycellios-Desktop-0.3.15-windows-x64-pilot.exe",
  bytes: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") };
const catalog = { automaticUpdates: false, packages: [entry] };
const folders: string[] = [];
afterEach(async () => { for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true }); });
async function fixture(overrides: { busy?: () => boolean; prepare?: () => Promise<boolean>; body?: Uint8Array } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "manual-update-")); folders.push(directory);
  const handoff = vi.fn(async () => {});
  const request = vi.fn(async (url: string | URL | Request) => String(url).endsWith("desktop-downloads")
    ? new Response(JSON.stringify(catalog)) : new Response(overrides.body ?? bytes));
  const controller = new ManualUpdateController({ version: "0.3.13", directory: () => directory,
    fetch: request, busy: overrides.busy ?? (() => false), prepare: overrides.prepare ?? (async () => true), handoff });
  return { controller, handoff, request, directory };
}
describe("official Windows manual releases", () => {
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
