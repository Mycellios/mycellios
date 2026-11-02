import { afterEach, describe, expect, it, vi } from "vitest";
import { createSignalClock, easePointer, pointOnSamples, pointerPosition } from "./living-network-model";

describe("living network motion", () => {
  afterEach(() => vi.restoreAllMocks());

  it("normalizes the pointer within the scene and bounds overshoot", () => {
    const bounds = { left: 100, top: 50, width: 400, height: 200 };
    expect(pointerPosition(300, 150, bounds)).toEqual({ x: 0, y: 0 });
    expect(pointerPosition(-500, 800, bounds)).toEqual({ x: -1, y: 1 });
    expect(pointerPosition(300, 150, { ...bounds, width: 0 })).toEqual({ x: 0, y: 0 });
  });

  it("keeps lights on the sampled route including both endpoints", () => {
    const points = [{ x: 0, y: 10 }, { x: 10, y: 20 }, { x: 30, y: 0 }];
    expect(pointOnSamples(points, .75)).toEqual({ x: 20, y: 10 });
    expect(pointOnSamples(points, -1)).toEqual(points[0]);
    expect(pointOnSamples(points, 2)).toEqual(points[2]);
    expect(pointOnSamples([], .5)).toEqual({ x: 0, y: 0 });
  });

  it("smooths pointer movement consistently across frame rates without overshoot", () => {
    const start = { x: 0, y: 0 }, target = { x: 1, y: -1 };
    const firstFrame = easePointer(start, target, 1 / 60);
    const secondFrame = easePointer(firstFrame, target, 1 / 60);
    const slowFrame = easePointer(start, target, 1 / 30);
    expect(secondFrame.x).toBeCloseTo(slowFrame.x, 12);
    expect(secondFrame.y).toBeCloseTo(slowFrame.y, 12);
    expect(easePointer(start, target, 0)).toEqual(start);
    expect(easePointer(start, target, 100).x).toBeLessThanOrEqual(1);
  });

  it("removes its frames while paused and resumes without consuming hidden time", () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const callbacks = new Set<() => void>();
    const ticker = { add: vi.fn((callback: () => void) => { callbacks.add(callback); return callback; }), remove: vi.fn((callback: () => void) => { callbacks.delete(callback); }) };
    const render = vi.fn();
    const clock = createSignalClock(ticker, render);
    const advance = (ms: number) => { now += ms; callbacks.forEach(tick => tick()); };
    advance(1000); expect(render).not.toHaveBeenCalled();
    clock.setActive(true); clock.setActive(true);
    expect(ticker.add).toHaveBeenCalledOnce();
    advance(500); expect(render).toHaveBeenLastCalledWith(.5, .5);
    clock.setActive(false); advance(20_000);
    expect(callbacks.size).toBe(0); expect(render).toHaveBeenCalledOnce();
    clock.setActive(true); advance(250);
    expect(render).toHaveBeenLastCalledWith(.75, .25);
    clock.destroy(); clock.destroy(); advance(1000);
    expect(callbacks.size).toBe(0); expect(render).toHaveBeenCalledTimes(2);
    expect(ticker.remove).toHaveBeenCalledTimes(2);
  });
});
