// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyResolvedAppearance, readSystemAppearance, setUiAppearance } from "./ui-appearance";

afterEach(() => vi.restoreAllMocks());

describe("ui-appearance", () => {
  it("treats matching light media as light", () => {
    expect(readSystemAppearance({ matches: true })).toBe("light");
    expect(readSystemAppearance({ matches: false })).toBe("dark");
  });

  it("writes data-theme and color-scheme on the root", () => {
    const root = {
      dataset: {} as DOMStringMap,
      style: { colorScheme: "" },
    };
    applyResolvedAppearance("light", root as unknown as HTMLElement);
    expect(root.dataset.theme).toBe("light");
    expect(root.style.colorScheme).toBe("light");
  });

  it("applies the theme immediately with reduced motion", () => {
    const start = vi.fn();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    Object.defineProperty(document, "startViewTransition", { configurable: true, value: start });
    try {
      applyResolvedAppearance("light");
      setUiAppearance("dark");
      expect(document.documentElement.dataset.theme).toBe("dark");
      expect(start).not.toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(document, "startViewTransition");
      vi.unstubAllGlobals();
    }
  });

  it("keeps the latest theme when a pending reveal is interrupted", async () => {
    let update: () => void = () => {};
    let finish: () => void = () => {};
    const finished = new Promise<void>(resolve => { finish = resolve; });
    const skipTransition = vi.fn(finish);
    const start = vi.fn((callback: () => void) => {
      update = callback;
      return { finished, ready: Promise.resolve(), skipTransition };
    });
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    Object.defineProperty(document, "startViewTransition", { configurable: true, value: start });
    try {
      applyResolvedAppearance("light");
      setUiAppearance("dark");
      expect(document.documentElement.dataset.theme).toBe("light");
      setUiAppearance("light");
      update();
      await finished;
      expect(skipTransition).toHaveBeenCalledOnce();
      expect(document.documentElement.dataset.theme).toBe("light");
      expect(document.documentElement.dataset.themeSweep).toBeUndefined();
      expect(document.querySelector(".rk-theme-sweep-mark")).toBeNull();
    } finally {
      Reflect.deleteProperty(document, "startViewTransition");
      vi.unstubAllGlobals();
    }
  });
});
