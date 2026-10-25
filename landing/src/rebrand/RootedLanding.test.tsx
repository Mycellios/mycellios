import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RootedLanding } from "./RootedLanding";

describe("the network-first marketing page", () => {
  it("preserves usable entry points and distinguishes concept art from observed activity", () => {
    const html = renderToStaticMarkup(<RootedLanding />);
    for (const destination of ["/network", "/dashboard", "/docs", "/earn", "/downloads", "/browser/", "https://www.mycellios.com/agent"]) {
      expect(html).toContain(`href="${destination}"`);
    }
    expect(html).toContain("Network concept");
    expect(html).toContain("active development");
    expect(html).not.toContain("view=inference");
    expect(html).not.toContain("USDC");
    expect(html.match(/<h1\b/g)).toHaveLength(1);
  });
});
