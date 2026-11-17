import { expect, it } from "vitest";
import { SearchProgressClock } from "./search-progress.js";
it("extends only on novel result locations and never beyond the hard ceiling", () => {
  const clock = new SearchProgressClock(45_000, 180_000, ["src"], 0);
  expect(clock.output(Buffer.from("src/a.ts:10:match\n"), 30_000)).toBe(true);
  expect(clock.deadline).toBe(75_000);
  expect(clock.output(Buffer.from("src/a.ts:10:different text\nSearching...\n"), 60_000)).toBe(false);
  expect(clock.deadline).toBe(75_000);
  for (const now of [70_000, 110_000, 150_000, 175_000]) clock.output(Buffer.from(`src/a.ts:${now}:match\n`), now);
  expect(clock.deadline).toBe(180_000);
  expect(clock.output(Buffer.from("src/new.ts\n"), 180_001)).toBe(false);
});
it("ignores out-of-scope output, banners and duplicate paths, including split chunks", () => {
  const clock = new SearchProgressClock(45_000, 180_000, ["src"], 0);
  expect(clock.output(Buffer.from("Searching...\nother/a.ts\nsrc/"), 10_000)).toBe(false);
  expect(clock.output(Buffer.from("b.ts\n"), 20_000)).toBe(true);
  expect(clock.deadline).toBe(65_000);
  expect(clock.output(Buffer.from("./src/b.ts\n"), 40_000)).toBe(false);
});
