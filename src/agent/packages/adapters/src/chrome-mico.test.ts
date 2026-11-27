import { describe, expect, it } from "vitest";
import {
  BROWSER_GROUP_COLORS,
  BROWSER_MICO_NAME_MAX,
} from "../../../../contracts/browser-tabs-bridge.js";
import { chromeMico } from "./chrome-mico.js";

describe("how a Mico shows itself in the person's Chrome", () => {
  it("keeps the same color for the same Mico and picks from Chrome's palette", () => {
    const first = chromeMico("bot-1", "Ada");
    expect(chromeMico("bot-1", "Ada").color).toBe(first.color);
    expect(BROWSER_GROUP_COLORS).toContain(first.color);
  });

  it("cleans the name: no markup, control characters or invisible direction marks", () => {
    const rightToLeftOverride = String.fromCharCode(0x202e);
    expect(chromeMico("b", `  <b>Ada\u0007</b>\n${rightToLeftOverride}corp  `).name).toBe(
      "bAda/bcorp",
    );
    expect(chromeMico("b", "").name).toBe("Mico");
    expect(chromeMico("b", "<<>>").name).toBe("Mico");
  });

  it("never exceeds the contract's name length, even with characters of two code units", () => {
    const mico = chromeMico("b", "🍄".repeat(40));
    expect(mico.name.length).toBeLessThanOrEqual(BROWSER_MICO_NAME_MAX);
    expect(mico.name.length).toBeGreaterThan(0);
    expect(chromeMico("b", "a".repeat(80)).name).toHaveLength(BROWSER_MICO_NAME_MAX);
  });
});
