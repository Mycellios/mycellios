import { describe, expect, it, vi } from "vitest";
import type { DesktopUpdateState } from "@rakazo/contracts";
import { UpdatePreferences } from "./update-preferences.js";

function fixture(options: { packaged?: boolean; allowed?: boolean; saved?: string } = {}) {
  let state: DesktopUpdateState = { currentVersion: "0.3.27", availableVersion: "0.3.28", phase: "ready", percent: null, message: null, checkedAt: null };
  let busy = false;
  const ports = { packaged: options.packaged ?? true, allowed: options.allowed ?? true,
    read: vi.fn(async () => options.saved ?? null), write: vi.fn(async (_raw: string) => {}), state: () => state,
    download: vi.fn(async () => { state = { ...state, phase: "ready" }; return state; }),
    install: vi.fn(async () => ({ ...state, installPending: true })), cancelInstall: vi.fn(async () => state),
    busy: () => busy, prepare: vi.fn(async () => true), relaunch: vi.fn(async () => {}),
  };
  const policy = new UpdatePreferences(ports);
  return { policy, ports, setState: (patch: Partial<DesktopUpdateState>) => { state = { ...state, ...patch }; }, setBusy: (next: boolean) => { busy = next; } };
}
async function settle() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
describe("native update preferences and idle restarts", () => {
  it("does not auto-install by default, and honors opt-out of automatic downloads", async () => {
    const { policy, ports, setState } = fixture();
    await policy.tick(); expect(ports.install).not.toHaveBeenCalled();
    await policy.save({ autoDownload: false }); setState({ phase: "available" });
    await policy.tick(); expect(ports.download).not.toHaveBeenCalled();
    await policy.save({ autoDownload: true }); await policy.tick();
    expect(ports.download).toHaveBeenCalledOnce(); expect(ports.install).not.toHaveBeenCalled();
  });
  it("persists transactionally and serializes concurrent choices without losing either", async () => {
    const { policy, ports } = fixture();
    ports.write.mockRejectedValueOnce(Error("disk"));
    await expect(policy.save({ autoDownload: false })).rejects.toThrow("disk");
    expect(policy.preferences().autoDownload).toBe(true);
    await Promise.all([policy.save({ autoDownload: false }), policy.save({ autoInstall: true })]);
    expect(policy.preferences()).toMatchObject({ autoDownload: false, autoInstall: true });
    expect(JSON.parse(ports.write.mock.calls.at(-1)![0])).toEqual({ schema: 1, autoDownload: false, autoInstall: true });
    await expect(policy.save({ channel: "unstable" })).rejects.toThrow();
    await expect(policy.save({ autoInstall: "yes" })).rejects.toThrow();
  });
  it("never activates automatic updates in development or a managed installation", async () => {
    for (const options of [{ packaged: false }, { allowed: false }]) {
      const { policy, ports } = fixture({ ...options, saved: '{"schema":1,"autoInstall":true,"autoDownload":true}' });
      await policy.load(); await policy.tick();
      expect(policy.preferences().supported).toBe(false); expect(ports.install).not.toHaveBeenCalled();
      await expect(policy.save({ autoInstall: true })).rejects.toThrow();
    }
  });
  it("waits for running work and a fresh acknowledgement of saved drafts", async () => {
    const { policy, ports, setBusy } = fixture();
    await policy.save({ autoInstall: true }); setBusy(true); await policy.tick();
    expect(ports.prepare).not.toHaveBeenCalled(); expect(policy.state().relaunchWaitingFor).toBe("local_work");
    setBusy(false); ports.prepare.mockResolvedValueOnce(false); await policy.tick();
    expect(ports.install).not.toHaveBeenCalled(); expect(policy.state().relaunchWaitingFor).toBe("unsaved_work");
    await policy.tick(); expect(ports.install).toHaveBeenCalledOnce();
  });
  it("cancellation during a renderer check cannot later install, and defers this release", async () => {
    const { policy, ports, setState } = fixture();
    await policy.save({ autoInstall: true });
    let ready!: (value: boolean) => void;
    ports.prepare.mockImplementationOnce(() => new Promise(resolve => { ready = resolve; }));
    const pending = policy.tick(); await policy.cancel(); ready(true); await pending;
    await policy.tick(); expect(ports.install).not.toHaveBeenCalled();
    setState({ availableVersion: "0.3.29" }); await policy.tick(); expect(ports.install).toHaveBeenCalledOnce();
  });
  it("rechecks newly started work after the renderer responds", async () => {
    const { policy, ports, setBusy } = fixture();
    ports.prepare.mockImplementationOnce(async () => { setBusy(true); return true; });
    policy.request("update"); await settle();
    expect(ports.install).not.toHaveBeenCalled(); expect(policy.state().relaunchWaitingFor).toBe("local_work");
    setBusy(false); await policy.tick(); expect(ports.install).toHaveBeenCalledOnce();
  });
  it("waits for downloads before relaunching and allows cancelling the restart", async () => {
    const { policy, ports, setState } = fixture(); setState({ phase: "downloading" });
    policy.request("relaunch"); await settle();
    expect(ports.relaunch).not.toHaveBeenCalled(); expect(policy.state().relaunchWaitingFor).toBe("update_download");
    await policy.cancel(); setState({ phase: "idle" }); await policy.tick(); expect(ports.relaunch).not.toHaveBeenCalled();
    policy.request("relaunch"); await settle(); expect(ports.relaunch).toHaveBeenCalledOnce();
  });
  it("shows a failed automatic restart once and permits an explicit retry", async () => {
    const { policy, ports } = fixture(); await policy.save({ autoInstall: true });
    ports.install.mockRejectedValueOnce(Error("handoff failed"));
    await policy.tick(); await policy.tick();
    expect(ports.install).toHaveBeenCalledOnce(); expect(policy.state().relaunchError).toBe(true);
    policy.request("update"); await settle(); expect(ports.install).toHaveBeenCalledTimes(2);
  });
});
