import { describe, expect, it, vi } from "vitest";
import type { DesktopUpdateState } from "@rakazo/contracts";
import { UpdatePreferences } from "./update-preferences.js";

function fixture(options: { packaged?: boolean; allowed?: boolean; saved?: string; installSupported?: boolean; autoInstallByDefault?: boolean } = {}) {
  let state: DesktopUpdateState = { currentVersion: "0.3.27", availableVersion: "0.3.28", phase: "ready", percent: null, message: null, checkedAt: null };
  let busy = false;
  let now = 0;
  const ports = { packaged: options.packaged ?? true, allowed: options.allowed ?? true, installSupported: options.installSupported,
    autoInstallByDefault: options.autoInstallByDefault, now: () => now,
    read: vi.fn(async () => options.saved ?? null), write: vi.fn(async (_raw: string) => {}), state: () => state,
    download: vi.fn(async () => { state = { ...state, phase: "ready" }; return state; }),
    install: vi.fn(async () => ({ ...state, installPending: true })), cancelInstall: vi.fn(async () => state),
    busy: () => busy, prepare: vi.fn(async () => true), relaunch: vi.fn(async () => {}),
  };
  const policy = new UpdatePreferences(ports);
  return { policy, ports, advance: (ms = 15_000) => { now += ms; }, setState: (patch: Partial<DesktopUpdateState>) => { state = { ...state, ...patch }; }, setBusy: (next: boolean) => { busy = next; } };
}
async function settle() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
describe("native update preferences and idle restarts", () => {
  it("automates eligible fresh installs with a cancellable fifteen-second grace period", async () => {
    const { policy, ports, advance } = fixture({ autoInstallByDefault: true });
    await policy.load();
    expect(policy.preferences()).toMatchObject({ autoDownload: true, autoInstall: true });
    await policy.tick();
    expect(policy.state()).toMatchObject({ relaunchPending: true, automaticRestartAt: 15_000 });
    expect(ports.install).not.toHaveBeenCalled();
    advance(14_999); await policy.tick(); expect(ports.install).not.toHaveBeenCalled();
    advance(1); await policy.tick(); expect(ports.install).toHaveBeenCalledOnce();
    expect(policy.state().automaticRestartAt).toBeUndefined();
  });
  it("preserves saved manual preferences and never enables an unsupported installation", async () => {
    const optedOut = fixture({ autoInstallByDefault: true, saved: '{"schema":1,"autoInstall":false}' });
    await optedOut.policy.load(); await optedOut.policy.tick(); expect(optedOut.ports.install).not.toHaveBeenCalled();
    for (const options of [{ packaged: false }, { allowed: false }, { installSupported: false }]) {
      const f = fixture({ autoInstallByDefault: true, ...options });
      await f.policy.load(); await f.policy.tick(); expect(f.policy.preferences().autoInstall).toBe(false);
      expect(f.ports.install).not.toHaveBeenCalled();
    }
    const legacy = fixture({ installSupported: false, saved: '{"schema":1,"autoInstall":true}' });
    await legacy.policy.load(); await legacy.policy.tick(); expect(legacy.ports.install).not.toHaveBeenCalled();
  });
  it("restarts the grace period if work, a draft or a different release appears", async () => {
    const f = fixture({ autoInstallByDefault: true });
    await f.policy.tick(); f.advance(14_000); f.setBusy(true); await f.policy.tick();
    expect(f.policy.state().automaticRestartAt).toBeUndefined();
    f.setBusy(false); f.ports.prepare.mockResolvedValueOnce(false); await f.policy.tick();
    expect(f.policy.state().automaticRestartAt).toBeUndefined();
    await f.policy.tick(); expect(f.policy.state().automaticRestartAt).toBe(29_000);
    f.advance(14_000); f.setState({ availableVersion: "0.3.29" }); await f.policy.tick();
    expect(f.policy.state().automaticRestartAt).toBe(43_000);
    f.advance(); await f.policy.tick(); expect(f.ports.install).toHaveBeenCalledOnce();
  });
  it("never interprets corrupt or unreadable saved choices as permission to restart", async () => {
    for (const saved of ['{', '{"schema":2}', '{"schema":1,"autoInstall":"yes"}']) {
      const f = fixture({ autoInstallByDefault: true, saved });
      await f.policy.load(); await f.policy.tick();
      expect(f.policy.preferences().autoInstall).toBe(false); expect(f.ports.install).not.toHaveBeenCalled();
    }
    const f = fixture({ autoInstallByDefault: true });
    f.ports.read.mockRejectedValueOnce(Error("access denied"));
    await f.policy.load(); await f.policy.tick(); expect(f.policy.preferences().autoInstall).toBe(false);
  });
  it("postpones this release after cancelling the grace period, without disabling future updates", async () => {
    const f = fixture({ autoInstallByDefault: true });
    await f.policy.tick(); await f.policy.cancel(); f.advance(); await f.policy.tick();
    expect(f.ports.install).not.toHaveBeenCalled(); expect(f.policy.preferences().autoInstall).toBe(true);
    f.setState({ availableVersion: "0.3.29" }); await f.policy.tick();
    expect(f.policy.state().automaticRestartAt).toBe(30_000);
    f.policy.request("update"); await settle(); expect(f.ports.install).toHaveBeenCalledOnce();
  });
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
    const { policy, ports, setBusy, advance } = fixture();
    await policy.save({ autoInstall: true }); setBusy(true); await policy.tick();
    expect(ports.prepare).not.toHaveBeenCalled(); expect(policy.state().relaunchWaitingFor).toBe("local_work");
    setBusy(false); ports.prepare.mockResolvedValueOnce(false); await policy.tick();
    expect(ports.install).not.toHaveBeenCalled(); expect(policy.state().relaunchWaitingFor).toBe("unsaved_work");
    await policy.tick(); expect(ports.install).not.toHaveBeenCalled();
    advance(); await policy.tick(); expect(ports.install).toHaveBeenCalledOnce();
  });
  it("cancellation during a renderer check cannot later install, and defers this release", async () => {
    const { policy, ports, setState, advance } = fixture();
    await policy.save({ autoInstall: true });
    let ready!: (value: boolean) => void;
    ports.prepare.mockImplementationOnce(() => new Promise(resolve => { ready = resolve; }));
    const pending = policy.tick(); await policy.cancel(); ready(true); await pending;
    await policy.tick(); expect(ports.install).not.toHaveBeenCalled();
    setState({ availableVersion: "0.3.29" }); await policy.tick(); advance(); await policy.tick(); expect(ports.install).toHaveBeenCalledOnce();
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
    const { policy, ports, advance } = fixture(); await policy.save({ autoInstall: true });
    ports.install.mockRejectedValueOnce(Error("handoff failed"));
    await policy.tick(); advance(); await policy.tick(); await policy.tick();
    expect(ports.install).toHaveBeenCalledOnce(); expect(policy.state().relaunchError).toBe(true);
    policy.request("update"); await settle(); expect(ports.install).toHaveBeenCalledTimes(2);
  });
  it("does not restart the same helper after an accepted installation fails asynchronously", async () => {
    const { policy, ports, advance, setState } = fixture({ autoInstallByDefault: true });
    await policy.tick(); advance(); await policy.tick();
    expect(ports.install).toHaveBeenCalledOnce();
    setState({ phase: "ready", installPending: false, message: "Could not complete the update. Try again." });
    for (let i = 0; i < 5; i++) { advance(); await policy.tick(); }
    expect(ports.install).toHaveBeenCalledOnce();
    expect(policy.state()).toMatchObject({ relaunchPending: false, relaunchError: true });
    policy.request("update"); await settle();
    expect(ports.install).toHaveBeenCalledTimes(2);
  });
  it("admits a newer ready release after deferring a failed helper", async () => {
    const { policy, ports, advance, setState } = fixture({ autoInstallByDefault: true });
    setState({ message: "Could not complete the update. Try again." });
    await policy.tick(); advance(); await policy.tick();
    expect(ports.install).not.toHaveBeenCalled();
    setState({ availableVersion: "0.3.99", message: null });
    await policy.tick(); advance(); await policy.tick();
    expect(ports.install).toHaveBeenCalledOnce();
    expect(policy.state().relaunchError).toBe(false);
  });
});

describe("installs applied by the system package manager", () => {
  it("keeps unattended installation off and reports the package's explicit install action", async () => {
    const { policy } = fixture({ installSupported: false });
    expect(policy.preferences()).toMatchObject({ supported: true, installSupported: false, autoInstall: false });
    await expect(policy.save({ autoInstall: true })).rejects.toThrow();
  });
  it("does not treat a completed system installer handoff as a failed restart", async () => {
    const { policy, ports } = fixture({ installSupported: false });
    const opened = { ...ports.state(), phase: "ready" as const, installPending: false, handoffComplete: true,
      message: "Opened the system installer. Restart Mycellios when it finishes." };
    ports.install.mockResolvedValueOnce(opened);
    await policy.request("update"); await settle();
    expect(policy.state()).toMatchObject({ relaunchError: false, relaunchPending: false });
    // The same message without a completed handoff still fails loudly.
    ports.install.mockResolvedValueOnce({ ...opened, handoffComplete: false });
    await policy.request("update"); await settle();
    expect(policy.state().relaunchError).toBe(true);
  });
});
