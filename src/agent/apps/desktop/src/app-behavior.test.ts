import { describe, expect, it, vi } from "vitest";
import { AppBehavior } from "./app-behavior";
function fixture(raw = "", platform = "win32", packaged = true) {
  let login = false; let battery = false;
  const ports = { packaged, platform, read: vi.fn(async () => raw), write: vi.fn(async (_: string) => undefined),
    login: { get: () => login, set: vi.fn((v: boolean) => { login = v; }) },
    power: { onBattery: () => battery, start: vi.fn(() => 7), stop: vi.fn() }, changed: vi.fn() };
  return { ports, settings: new AppBehavior(ports), battery: (v: boolean) => { battery = v; } };
}
describe("native application settings", () => {
  it("persists quick reconnection without granting background execution or changing OS startup",async()=>{
    const f=fixture();await f.settings.load();await f.settings.update({keepRemoteSessions:true});
    expect(f.settings.state()).toMatchObject({keepRemoteSessions:true,keepRunningInBackground:false});
    expect(f.ports.login.set).not.toHaveBeenCalled();expect(f.ports.power.start).not.toHaveBeenCalled();
    const restored=fixture(f.ports.write.mock.calls[0]![0]);await restored.settings.load();
    expect(restored.settings.state().keepRemoteSessions).toBe(true);
  });
  it("migrates the existing background preference without enabling other effects", async () => {
    const f = fixture('{"schema":1,"keepRunningInBackground":true}'); await f.settings.load();
    expect(f.settings.state()).toMatchObject({ keepRunningInBackground: true, keepAwake: false, externalLinkTarget: "system" });
    expect(f.ports.login.set).not.toHaveBeenCalled(); expect(f.ports.power.start).not.toHaveBeenCalled();
  });
  it("keeps the screen free to sleep, releases on battery and resumes on AC", async () => {
    const f = fixture(); await f.settings.load(); await f.settings.update({ keepAwake: true });
    expect(f.ports.power.start).toHaveBeenCalledTimes(1);
    f.settings.syncPower(); expect(f.ports.power.start).toHaveBeenCalledTimes(1);
    f.battery(true); f.settings.syncPower(); expect(f.ports.power.stop).toHaveBeenCalledWith(7);
    await f.settings.update({ keepAwakeOnBattery: true }); expect(f.ports.power.start).toHaveBeenCalledTimes(2);
    f.settings.dispose(); expect(f.ports.power.stop).toHaveBeenCalledTimes(2);
  });
  it("does not report a failed write as saved and restores login state", async () => {
    const f = fixture(); f.ports.write.mockRejectedValueOnce(new Error("disk full"));
    await expect(f.settings.update({ launchAtLogin: true, keepAwake: true })).rejects.toThrow("disk full");
    expect(f.settings.state()).toMatchObject({ launchAtLogin: false, keepAwake: false });
    expect(f.ports.login.get()).toBe(false); expect(f.ports.power.start).not.toHaveBeenCalled();
    await f.settings.update({ externalLinkTarget: "app" }); expect(f.settings.state().externalLinkTarget).toBe("app");
  });
  it("serializes concurrent patches without losing settings", async () => {
    const f = fixture(); await Promise.all([f.settings.update({ keepRunningInBackground: true }), f.settings.update({ externalLinkTarget: "app" })]);
    expect(JSON.parse(f.ports.write.mock.calls[1]![0])).toMatchObject({ keepRunningInBackground: true, externalLinkTarget: "app" });
  });
  it("rejects unknown settings, invalid types and unavailable OS functions", async () => {
    const f = fixture("", "linux", false);
    for (const patch of [{ launchAtLogin: true }, { keepAwake: true }, { keepAwake: "yes" }, { arbitraryCommand: "x" }, { externalLinkTarget: "file:" }])
      await expect(f.settings.update(patch)).rejects.toThrow();
    expect(f.ports.write).not.toHaveBeenCalled();
  });
});
