import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startForestLoader } from "./forest-loader";

const animation = vi.hoisted(() => ({ complete: () => {}, exitComplete: () => {}, kill: vi.fn(), destroy: vi.fn() }));
vi.mock("gsap", () => ({ default: {
  timeline: (options: { onComplete: () => void }) => {
    animation.complete = options.onComplete;
    const timeline = { addLabel: () => timeline, to: () => timeline, timeScale: vi.fn(), kill: animation.kill };
    return timeline;
  },
  to: (_state: unknown, options: { onComplete: () => void }) => {
    animation.exitComplete = options.onComplete;
    return { kill: animation.kill };
  },
} }));
vi.mock("./forest-renderer", () => ({ createForestRenderer: () => ({ render: vi.fn(), destroy: animation.destroy }) }));

function setup({ imagesFail = false, imagesPending = false, fontsPending = false, alreadyReady = false } = {}) {
  const loader = new EventTarget() as HTMLElement;
  Object.assign(loader, { dataset: alreadyReady ? { routeReady: "true" } : {}, prepend: vi.fn() });
  const window = new EventTarget(), media = Object.assign(new EventTarget(), { matches: false });
  const session = { setItem: vi.fn() };
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", { createElement: () => ({ setAttribute: vi.fn() }),
    fonts: { ready: fontsPending ? new Promise(() => {}) : Promise.resolve() } });
  vi.stubGlobal("matchMedia", () => media);
  vi.stubGlobal("sessionStorage", session);
  vi.stubGlobal("Image", class { decode() { return imagesFail ? Promise.reject(new Error("offline")) : imagesPending ? new Promise(() => {}) : Promise.resolve(); } });
  const released = vi.fn();
  loader.addEventListener("mycellios:forest-finish", () => {
    released(); loader.dispatchEvent(new Event("mycellios:loader-released"));
  });
  const dispose = startForestLoader(loader);
  const signal = (name: string) => loader.dispatchEvent(new Event(`mycellios:${name}`));
  return { loader, session, released, dispose, signal, media, window };
}

describe("forest readiness and cancellation", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("holds the completed forest until the real route is ready", async () => {
    const page = setup();
    await vi.advanceTimersByTimeAsync(0);
    animation.complete();
    expect(page.released).not.toHaveBeenCalled();
    page.signal("route-ready");
    await vi.advanceTimersByTimeAsync(0);
    animation.exitComplete();
    expect(page.released).toHaveBeenCalledOnce();
    expect(page.session.setItem).toHaveBeenCalledWith("mycellios.forestIntro.v1", "seen");
    expect(animation.destroy).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("accepts a ready signal sent before the animation chunk finished importing", async () => {
    const page = setup({ alreadyReady: true });
    await vi.advanceTimersByTimeAsync(0);
    animation.complete(); animation.exitComplete();
    expect(page.released).toHaveBeenCalledOnce();
  });

  it("does not trap the page behind unavailable fonts", async () => {
    const page = setup({ fontsPending: true });
    await vi.advanceTimersByTimeAsync(0);
    animation.complete(); page.signal("route-ready");
    await vi.advanceTimersByTimeAsync(601);
    animation.exitComplete();
    expect(page.released).toHaveBeenCalledOnce();
  });

  it("fails open after an image error only once the route is ready, without marking the intro seen", async () => {
    const page = setup({ imagesFail: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(page.released).not.toHaveBeenCalled();
    page.signal("route-ready");
    await vi.advanceTimersByTimeAsync(0);
    expect(page.released).toHaveBeenCalledOnce();
    expect(page.session.setItem).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("honors Skip intro before readiness, then removes all animation work", async () => {
    const page = setup();
    page.signal("forest-skip");
    expect(page.released).not.toHaveBeenCalled();
    page.signal("route-ready");
    await vi.advanceTimersByTimeAsync(0);
    expect(page.released).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds an image request that never settles after the route is ready", async () => {
    const page = setup({ alreadyReady: true, imagesPending: true });
    await vi.advanceTimersByTimeAsync(1801);
    expect(page.released).toHaveBeenCalledOnce();
    expect(page.session.setItem).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("responds to a reduced-motion change during playback", async () => {
    const page = setup({ alreadyReady: true });
    await vi.advanceTimersByTimeAsync(0);
    page.media.matches = true; page.media.dispatchEvent(new Event("change"));
    expect(page.released).toHaveBeenCalledOnce();
    expect(animation.kill).toHaveBeenCalled();
  });
});
