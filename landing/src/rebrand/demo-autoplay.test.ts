import { afterEach, describe, expect, it, vi } from "vitest";
import { createDemoAutoplay } from "./demo-autoplay";

function fixture(duration: number | readonly number[] = 6000) {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance"] });
  let intersect: (visible: boolean) => void = () => {}, mutate = () => {};
  const page = { dataset: { journeyRunning: "true" } }, stories = { dataset: { storiesPaused: "false" } };
  const media = Object.assign(new EventTarget(), { matches: false });
  const document = Object.assign(new EventTarget(), { hidden: false, activeElement: null as null | { matches: () => boolean } });
  const root = Object.assign(new EventTarget(), { dataset: {}, contains: () => true,
    closest: (selector: string) => selector === "[data-journey-running]" ? page : stories,
  });
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", { setInterval, clearInterval, matchMedia: () => media });
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: (entries: { isIntersecting: boolean }[]) => void) { intersect = visible => callback([{ isIntersecting: visible }]); }
    observe() {} disconnect() {}
  });
  vi.stubGlobal("MutationObserver", class {
    constructor(callback: () => void) { mutate = callback; }
    observe() {} disconnect() {}
  });
  const onStep = vi.fn();
  const autoplay = createDemoAutoplay(root as unknown as HTMLElement, onStep, { steps: 3, duration });
  return { autoplay, onStep, root, document, media, page, stories,
    visible: (value: boolean) => intersect(value), mutate: () => mutate(),
    hidden: (value: boolean) => { document.hidden = value; document.dispatchEvent(new Event("visibilitychange")); },
    reduced: (value: boolean) => { media.matches = value; media.dispatchEvent(new Event("change")); },
  };
}

describe("automatic illustrative demos", () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("starts on entry, tours every state and repeats without a play action", () => {
    const f = fixture();
    vi.advanceTimersByTime(30000); expect(f.onStep).not.toHaveBeenCalled();
    f.visible(true); vi.advanceTimersByTime(18000);
    expect(f.onStep.mock.calls.map(call => call[0])).toEqual([1, 2, 0]);
    f.autoplay.destroy();
  });

  it("preserves remaining reading time across off-screen and hidden periods", () => {
    const f = fixture(); f.visible(true); vi.advanceTimersByTime(3000);
    f.visible(false); vi.advanceTimersByTime(60000); f.visible(true);
    vi.advanceTimersByTime(2999); expect(f.onStep).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); expect(f.onStep).toHaveBeenLastCalledWith(1);
    f.hidden(true); vi.advanceTimersByTime(60000); f.hidden(false);
    vi.advanceTimersByTime(6000); expect(f.onStep.mock.calls.map(call => call[0])).toEqual([1, 2]);
    f.autoplay.destroy();
  });

  it("honors explicit pause and changes to reduced motion", () => {
    const f = fixture(); f.reduced(true); f.visible(true);
    vi.advanceTimersByTime(20000); expect(f.onStep).not.toHaveBeenCalled();
    f.reduced(false); vi.advanceTimersByTime(6000); expect(f.onStep).toHaveBeenLastCalledWith(1);
    f.page.dataset.journeyRunning = "false"; f.mutate(); vi.advanceTimersByTime(20000);
    expect(f.onStep).toHaveBeenCalledTimes(1);
    f.page.dataset.journeyRunning = "true"; f.stories.dataset.storiesPaused = "true"; f.mutate();
    vi.advanceTimersByTime(20000); expect(f.onStep).toHaveBeenCalledTimes(1);
    f.stories.dataset.storiesPaused = "false"; f.mutate();
    vi.advanceTimersByTime(6000); expect(f.onStep).toHaveBeenLastCalledWith(2);
    f.autoplay.destroy();
  });

  it("gives manual interaction a grace period and never interrupts focused editing", () => {
    const f = fixture(); f.visible(true); vi.advanceTimersByTime(5000);
    f.root.dispatchEvent(new Event("pointerdown")); vi.advanceTimersByTime(17000);
    expect(f.onStep).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000); expect(f.onStep).toHaveBeenLastCalledWith(1);
    f.document.activeElement = { matches: () => true };
    vi.advanceTimersByTime(30000); expect(f.onStep).toHaveBeenCalledTimes(1);
    f.document.activeElement = null; vi.advanceTimersByTime(6000);
    expect(f.onStep).toHaveBeenLastCalledWith(2);
    f.autoplay.destroy();
  });

  it("keeps intermediate beats visible and removes all activity on disposal", () => {
    const f = fixture([2000, 2000, 4000]); f.visible(true);
    vi.advanceTimersByTime(1999); expect(f.onStep).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); expect(f.onStep).toHaveBeenLastCalledWith(1);
    vi.advanceTimersByTime(2000); expect(f.onStep).toHaveBeenLastCalledWith(2);
    vi.advanceTimersByTime(4000); expect(f.onStep).toHaveBeenLastCalledWith(0);
    f.autoplay.destroy(); f.hidden(true); f.hidden(false);
    vi.advanceTimersByTime(60000); expect(f.onStep).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });
});
