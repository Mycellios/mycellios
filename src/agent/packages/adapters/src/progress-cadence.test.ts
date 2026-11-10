import { expect, it } from "vitest";
import { shouldPublishTextProgress } from "./progress-cadence.js";

it("publishes first text immediately, coalesces token bursts, and publishes at 80ms", () => {
  expect(shouldPublishTextProgress(10, 0, 1)).toBe(true);
  expect(shouldPublishTextProgress(170, 100, 4)).toBe(false);
  expect(shouldPublishTextProgress(180, 100, 4)).toBe(true);
  expect(shouldPublishTextProgress(180, 100, 0)).toBe(false);
});
it("does not hold a large received answer for the next time window", () => {
  expect(shouldPublishTextProgress(105, 100, 2048)).toBe(true);
});
