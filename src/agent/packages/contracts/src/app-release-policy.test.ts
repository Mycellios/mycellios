import { describe, expect, it } from "vitest";
import { privateAppsEnabled, videoStudioEnabled } from "./app-release-policy.js";

describe("private Apps release admission", () => {
  it("keeps production closed without an exact operator opt-in", () => {
    for (const value of [undefined, "", "0", "true", "yes", " 1"])
      expect(privateAppsEnabled(true, value)).toBe(false);
    expect(privateAppsEnabled(true, "1")).toBe(true);
  });
  it("preserves the existing local development preview", () => {
    expect(privateAppsEnabled(false)).toBe(true);
  });
});

describe("released Video Studio availability", () => {
  it("releases the qualified built-in while retaining an exact operator off switch", () => {
    expect(videoStudioEnabled()).toBe(true);
    expect(videoStudioEnabled("1")).toBe(true);
    for (const value of ["", "0", "true", "yes", " 1"])
      expect(videoStudioEnabled(value)).toBe(false);
    expect(privateAppsEnabled(true)).toBe(false);
  });
});
