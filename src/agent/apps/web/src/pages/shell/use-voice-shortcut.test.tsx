// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useVoiceShortcut } from "./use-voice-shortcut";

let root: Root;
let container: HTMLDivElement;
const start = vi.fn(), consume = vi.fn();
const props = { requested: true, ready: true, blocked: false, scope: "owned-thread", start, consume };
function Harness(input: typeof props) { useVoiceShortcut(input); return null; }
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  container = document.createElement("div"); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function render(input = props) { act(() => root.render(<StrictMode><Harness {...input} /></StrictMode>)); }
it("starts one hands-free capture in an installed visible app, never a send", () => {
  render(); act(() => vi.runAllTimers());
  expect(start).toHaveBeenCalledTimes(1); expect(consume).toHaveBeenCalledTimes(1);
});
it("waits for voice configuration", () => {
  render({ ...props, ready: false }); act(() => vi.runAllTimers()); expect(start).not.toHaveBeenCalled();
  render(); act(() => vi.runAllTimers()); expect(start).toHaveBeenCalledTimes(1);
});
it("does not record from an ordinary browser link", () => {
  vi.mocked(window.matchMedia).mockReturnValue({ matches: false } as MediaQueryList);
  render(); act(() => vi.runAllTimers()); expect(start).not.toHaveBeenCalled(); expect(consume).toHaveBeenCalledOnce();
});
it("does not record over busy work, a draft, attachments or another call", () => {
  render({ ...props, blocked: true }); act(() => vi.runAllTimers());
  expect(start).not.toHaveBeenCalled(); expect(consume).toHaveBeenCalledOnce();
});
it("does not record in the background", () => {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  render(); act(() => vi.runAllTimers()); expect(start).not.toHaveBeenCalled();
});
it("cancels a pending launch when the owned view unmounts", () => {
  render(); act(() => root.render(null)); act(() => vi.runAllTimers());
  expect(start).not.toHaveBeenCalled(); expect(consume).not.toHaveBeenCalled();
});
it("does nothing without the explicit shortcut request", () => {
  render({ ...props, requested: false }); act(() => vi.runAllTimers()); expect(start).not.toHaveBeenCalled();
});

it("accepts the official Android main-frame host without pretending it is a PWA", () => {
  window.MycelliosNative = { postMessage: vi.fn() };
  vi.mocked(window.matchMedia).mockReturnValue({ matches: false } as MediaQueryList);
  try { render(); act(() => vi.runAllTimers()); expect(start).toHaveBeenCalledOnce(); }
  finally { delete window.MycelliosNative; }
});
