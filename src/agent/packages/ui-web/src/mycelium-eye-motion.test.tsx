// @vitest-environment jsdom
import { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useMyceliumEyes } from "./mycelium-eye-motion.js";

afterEach(() => vi.unstubAllGlobals());

it("keeps an avatar usable and still when the host has no media-query API", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", undefined);
  const frame = vi.fn();
  vi.stubGlobal("requestAnimationFrame", frame);
  const host = document.createElement("div");
  const root = createRoot(host);
  function Avatar() {
    const ref = useRef<SVGSVGElement>(null);
    useMyceliumEyes(ref, true, "running", "mico");
    return <svg ref={ref}><g data-mycelium-gaze=""><rect data-mycelium-lid="0" /></g></svg>;
  }
  try {
    await act(async () => root.render(<Avatar />));
    expect(host.querySelector("svg")?.getAttribute("data-mico-eye-motion")).toBe("paused");
    expect(host.querySelector("rect")).not.toBeNull();
    expect(frame).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
  }
});
