// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { BrandLaunch } from "./BrandLaunch";

describe("brand launch motion", () => {
  it("stops the ring, float and entrance when reduced motion is requested", () => {
    const css = readFileSync(resolve("apps/web/src/components/brand-launch.css"), "utf8");
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toContain(".brand-launch-ring");
    expect(reduced).toContain(".brand-launch-mark img");
    expect(reduced).toContain("animation: none");
    expect(css).not.toMatch(/gradient\s*\(/);
  });
});

describe("brand launch drag region", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  afterEach(() => {
    root.unmount();
    container.remove();
    delete window.rakazoDesktop;
  });

  async function render() {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(<BrandLaunch drag markSrc="/mico.png" wordSrc="/mark.png" />);
    });
    return container.querySelector("header");
  }

  it("keeps the welcome bar draggable only while macOS hides the title bar", async () => {
    window.rakazoDesktop = { platform: "darwin" } as Window["rakazoDesktop"];
    expect((await render())?.className).toBe("brand-launch-bar app-drag");
    root.unmount();
    container.remove();
    window.rakazoDesktop = { platform: "win32" } as Window["rakazoDesktop"];
    expect((await render())?.className).toBe("brand-launch-bar");
  });
});
