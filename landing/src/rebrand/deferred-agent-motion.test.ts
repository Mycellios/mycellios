import { afterEach, expect, it, vi } from "vitest";
import { loadAfterFirstPaint } from "./deferred-agent-motion";

afterEach(() => vi.unstubAllGlobals());
it("does not request optional timelines until two painted frames and browser idle", async () => {
  const frames: FrameRequestCallback[] = [];
  let idle: (() => void) | undefined;
  vi.stubGlobal("document", { readyState: "complete" });
  vi.stubGlobal("window", { requestIdleCallback: (callback: () => void) => { idle = callback; } });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
  const load = vi.fn(async () => "ready"), result = loadAfterFirstPaint(load);
  expect(load).not.toHaveBeenCalled();
  frames.shift()!(0); expect(load).not.toHaveBeenCalled();
  frames.shift()!(16); expect(load).not.toHaveBeenCalled();
  idle!(); expect(await result).toBe("ready"); expect(load).toHaveBeenCalledTimes(1);
});
