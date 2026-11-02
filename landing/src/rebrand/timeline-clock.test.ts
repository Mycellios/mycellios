import { afterEach, describe, expect, it, vi } from "vitest";
import type gsap from "gsap";
import { createTimelineClock } from "./timeline-clock";

function fixture() {
  let now = 0, time = 0, paused = false;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  const timeline = { duration: () => 14, time: (value?: number) => value === undefined ? time : (time = value) } as unknown as gsap.core.Timeline;
  let tick = () => {};
  const ticker = { add: (callback: () => void) => { tick = callback; }, remove: vi.fn() } as unknown as typeof gsap.ticker;
  const clock = createTimelineClock(timeline, ticker, () => !paused);
  return { clock, ticker, advance: (ms: number) => { now += ms; tick(); }, time: () => time, pause: () => { paused = true; clock.reset(); }, play: () => { paused = false; clock.reset(); } };
}

describe("finite GSAP sequence clock", () => {
  afterEach(() => vi.restoreAllMocks());
  it("keeps the intended pace across a throttled frame and stops at the final cue", () => {
    const f = fixture();
    f.advance(4000); expect(f.time()).toBe(4);
    f.advance(20_000); expect(f.time()).toBe(14);
    expect(f.ticker.remove).toHaveBeenCalledOnce();
  });
  it("does not consume paused time and removes its ticker on unmount", () => {
    const f = fixture();
    f.advance(1000); f.pause(); f.advance(20_000); expect(f.time()).toBe(1);
    f.play(); f.advance(1000); expect(f.time()).toBe(2);
    f.clock.destroy(); expect(f.ticker.remove).toHaveBeenCalledOnce();
  });
});
