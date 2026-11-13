import { expect, it } from "vitest";
import { automaticUpdatePolicy } from "./automatic-update-policy.js";
const env = { packaged: true, platform: "darwin", arch: "arm64" };
const policy = { schema: "mycellios-desktop-update-policy/1", automaticUpdates: true, platform: "darwin", arch: "arm64", trust: "signed", feedUrl: "https://www.mycellios.com/downloads/desktop/updates/macos/arm64" };
it("uses only the own signed platform channel", () => {
  expect(automaticUpdatePolicy(policy, env).enabled).toBe(true);
  for (const patch of [{ trust: "adhoc" }, { feedUrl: "https://example.com/latest" }, { platform: "win32" }, { arch: "x64" }, { automaticUpdates: false }])
    expect(automaticUpdatePolicy({ ...policy, ...patch }, env).enabled).toBe(false);
});
it("retains development and installation opt-outs", () => {
  expect(automaticUpdatePolicy(policy, { ...env, disabled: true }).enabled).toBe(false);
  expect(automaticUpdatePolicy(policy, { ...env, packaged: false }).enabled).toBe(false);
  expect(automaticUpdatePolicy(null, env).enabled).toBe(false);
});
it("updates AppImages without taking ownership of Debian or RPM installations", () => {
  const p = { ...policy, platform: "linux", arch: "x64", trust: "appimage", feedUrl: "https://www.mycellios.com/downloads/desktop/updates/linux/x64" };
  expect(automaticUpdatePolicy(p, { packaged: true, platform: "linux", arch: "x64", appImage: "/home/u/Mycellios.AppImage" }).enabled).toBe(true);
  expect(automaticUpdatePolicy(p, { packaged: true, platform: "linux", arch: "x64" }).enabled).toBe(false);
});
