import type gsap from "gsap";

/** Keep a finite product sequence on wall time when browsers throttle rendering. */
export function createTimelineClock(timeline: gsap.core.Timeline, ticker: typeof gsap.ticker, canPlay = () => true) {
  let previous = performance.now();
  const tick = () => {
    const now = performance.now(), elapsed = Math.max(0, now - previous) / 1000;
    previous = now;
    if (canPlay()) timeline.time(Math.min(timeline.duration(), timeline.time() + elapsed), false);
    if (timeline.time() >= timeline.duration()) ticker.remove(tick);
  };
  ticker.add(tick);
  return { reset() { previous = performance.now(); }, destroy() { ticker.remove(tick); } };
}
