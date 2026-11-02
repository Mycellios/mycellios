import type gsap from "gsap";

export interface NetworkPoint { x: number; y: number }

export function pointerPosition(x: number, y: number, bounds: { left: number; top: number; width: number; height: number }): NetworkPoint {
  if (bounds.width <= 0 || bounds.height <= 0) return { x: 0, y: 0 };
  const clamp = (value: number) => Math.max(-1, Math.min(1, value));
  return { x: clamp((x - bounds.left) / bounds.width * 2 - 1), y: clamp((y - bounds.top) / bounds.height * 2 - 1) };
}

export function pointOnSamples(points: readonly NetworkPoint[], phase: number): NetworkPoint {
  if (!points.length) return { x: 0, y: 0 };
  const cursor = Math.max(0, Math.min(1, phase)) * (points.length - 1);
  const index = Math.floor(cursor), start = points[index]!, end = points[Math.min(index + 1, points.length - 1)]!;
  return { x: start.x + (end.x - start.x) * (cursor - index), y: start.y + (end.y - start.y) * (cursor - index) };
}

export function easePointer(from: NetworkPoint, to: NetworkPoint, seconds: number): NetworkPoint {
  const blend = 1 - Math.exp(-Math.max(0, seconds) * 6);
  return { x: from.x + (to.x - from.x) * blend, y: from.y + (to.y - from.y) * blend };
}

/** Own the ticker subscription so hidden and paused scenes consume no frames. */
export function createSignalClock(ticker: Pick<typeof gsap.ticker, "add" | "remove">, render: (elapsed: number, delta: number) => void) {
  let elapsed = 0, previous = performance.now(), active = false;
  const tick = () => {
    const now = performance.now(), delta = Math.max(0, now - previous) / 1000;
    previous = now; elapsed += delta; render(elapsed, delta);
  };
  return {
    setActive(next: boolean) {
      if (active === next) return;
      active = next;
      if (active) { previous = performance.now(); ticker.add(tick); }
      else ticker.remove(tick);
    },
    destroy() { if (active) ticker.remove(tick); active = false; },
  };
}
