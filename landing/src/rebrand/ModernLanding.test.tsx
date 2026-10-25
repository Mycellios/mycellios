import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ModernLanding } from "./ModernLanding";

describe("the refreshed Mycellios entry points", () => {
  it("opens Agent and contribution through real product destinations", () => {
    const html = renderToStaticMarkup(<ModernLanding />);
    expect(html).toContain('href="https://www.mycellios.com/agent"');
    expect(html).toContain('href="/browser/"');
    expect(html).toContain('href="/downloads"');
    expect(html).toContain('href="/network"');
    expect(html).toContain('href="/docs"');
    expect(html).not.toContain('view=inference');
    expect(html).not.toContain('class="inference-console');
    expect(html).not.toContain('USDC');
    expect(html).toContain('interface preview');
  });
});
