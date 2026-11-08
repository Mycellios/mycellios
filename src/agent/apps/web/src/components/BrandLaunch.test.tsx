import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("brand launch motion", () => {
  it("stops the ring, float and entrance when reduced motion is requested", () => {
    const css = readFileSync(new URL("./brand-launch.css", import.meta.url), "utf8");
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toContain(".brand-launch-ring");
    expect(reduced).toContain(".brand-launch-mark img");
    expect(reduced).toContain("animation: none");
    expect(css).not.toMatch(/gradient\s*\(/);
  });
});
