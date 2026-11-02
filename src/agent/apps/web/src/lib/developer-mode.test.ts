// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
vi.mock("./query", () => ({ useQueryUserId: () => "fixture-user" }));
import { getDeveloperMode, setDeveloperMode } from "./developer-mode";
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});
it("defaults off and keeps browser preferences isolated per account", () => {
  expect(getDeveloperMode("one")).toBe(false);
  setDeveloperMode("one", true);
  expect(getDeveloperMode("one")).toBe(true);
  expect(getDeveloperMode("two")).toBe(false);
  expect(getDeveloperMode(null)).toBe(false);
  setDeveloperMode("one", false);
  expect(getDeveloperMode("one")).toBe(false);
});
it("notifies mounted settings and tolerates unavailable storage", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Unavailable");
  });
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("Unavailable");
  });
  const listener = vi.fn();
  window.addEventListener("mycellios:developer-mode", listener);
  try {
    setDeveloperMode("restricted", true);
    expect(getDeveloperMode("restricted")).toBe(true);
    setDeveloperMode("restricted", false);
    expect(getDeveloperMode("restricted")).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
  } finally {
    window.removeEventListener("mycellios:developer-mode", listener);
  }
});
