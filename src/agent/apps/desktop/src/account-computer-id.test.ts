import { expect, it } from "vitest";
import { desktopInstanceId } from "./account-computer.js";

const profile = "11111111-1111-4111-8111-111111111111";
const otherProfile = "22222222-2222-4222-8222-222222222222";
const installed =
  "C:\\Program Files\\Mycellios Agent\\Mycellios Agent.exe\0C:\\Users\\Dani\\AppData\\Roaming\\Mycellios Agent";
const worktree = "C:\\work\\electron.exe\0C:\\work\\user-data";

it("gives every Desktop installation a stable id that is not the machine id", () => {
  const prod = desktopInstanceId(profile, installed);
  const dev = desktopInstanceId(profile, worktree);
  expect(prod).toBe(desktopInstanceId(profile, installed));
  expect(prod).not.toBe(dev);
  expect(prod).not.toBe(profile);
  expect(desktopInstanceId(otherProfile, installed)).not.toBe(prod);
  expect(prod).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-a[a-f0-9]{3}-[a-f0-9]{12}$/);
  expect(dev).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-a[a-f0-9]{3}-[a-f0-9]{12}$/);
});
