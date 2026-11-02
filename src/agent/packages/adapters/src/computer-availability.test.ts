import { expect, it } from "vitest";
import { computerAvailable } from "./computer-availability.js";
it("keeps first boot available for configured cloud providers, independent of an unprovisioned saved computer", () => {
  for (const provider of ["e2b", "daytona", "docker", "fake"]) expect(computerAvailable(provider, undefined)).toBe(true);
  expect(computerAvailable("none", undefined)).toBe(false);
});
it("enables only an admitted native binding and preserves the relay's unavailable result", () => {
  expect(computerAvailable("none", "desktop")).toBe(true);
  expect(computerAvailable("none", "none")).toBe(false);
  expect(computerAvailable("docker", "none")).toBe(false);
});
