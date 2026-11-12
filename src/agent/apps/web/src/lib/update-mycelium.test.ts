// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { playUpdateMycelium } from "./update-mycelium";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function environment(reduced = false) {
  vi.stubGlobal("matchMedia", () => ({ matches: reduced, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
}
it("does not create animation resources with reduced motion", async () => {
  environment(true);
  const context = vi.spyOn(HTMLCanvasElement.prototype, "getContext");
  await playUpdateMycelium();
  expect(context).not.toHaveBeenCalled();
  expect(document.querySelector("[data-update-mycelium]")).toBeNull();
});
it("does not prevent update actions when graphics are unavailable", async () => {
  environment();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => { throw Error("No graphics context"); });
  await expect(playUpdateMycelium()).resolves.toBeUndefined();
  expect(document.querySelector("[data-update-mycelium]")).toBeNull();
});
it("removes the overlay on resize and resolves the waiting update action", async () => {
  environment();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ scale: vi.fn() } as unknown as CanvasRenderingContext2D);
  const done = playUpdateMycelium();
  expect(document.querySelector("[data-update-mycelium]")?.getAttribute("aria-hidden")).toBe("true");
  window.dispatchEvent(new Event("resize"));
  await done;
  expect(document.querySelector("[data-update-mycelium]")).toBeNull();
});
it("has a finite lifetime even when animation frames are throttled", async () => {
  vi.useFakeTimers(); environment();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ scale: vi.fn() } as unknown as CanvasRenderingContext2D);
  vi.stubGlobal("requestAnimationFrame", () => 1); vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const done = playUpdateMycelium();
  await vi.advanceTimersByTimeAsync(1600); await done;
  expect(document.querySelector("[data-update-mycelium]")).toBeNull();
});
