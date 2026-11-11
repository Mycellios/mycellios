import { describe, expect, it } from "vitest";
import { assertTailnetUrl, safeTailscaleAuthUrl, TailnetConnectionInput } from "./tailscale.js";
describe("Tailscale destinations", () => {
  it("accepts only a full hostname in the selected network", () => {
    expect(assertTailnetUrl("https://mcp.tail123.ts.net:8443/mcp", "tail123.ts.net").port).toBe("8443");
    expect(assertTailnetUrl("http://mcp.tail123.ts.net/mcp", "tail123.ts.net").protocol).toBe("http:");
  });
  it.each([
    "http://127.0.0.1/mcp", "http://169.254.169.254/latest/meta-data", "http://100.64.1.2/mcp",
    "https://mcp.other.ts.net/mcp", "https://mcp.tail123.ts.net.attacker.test/mcp",
    "https://tail123.ts.net/mcp", "https://nested.mcp.tail123.ts.net/mcp",
    "https://secret@mcp.tail123.ts.net/mcp", "https://mcp.tail123.ts.net/mcp#", "file:///etc/passwd",
  ])("refuses %s", value => expect(() => assertTailnetUrl(value, "tail123.ts.net")).toThrow());
  it("does not accept provider-supplied arbitrary login links", () => {
    expect(safeTailscaleAuthUrl("https://login.tailscale.com/a/abc")).toBe("https://login.tailscale.com/a/abc");
    expect(safeTailscaleAuthUrl("https://login.tailscale.com.evil.test/")).toBeNull();
    expect(safeTailscaleAuthUrl("http://login.tailscale.com/")).toBeNull();
  });
  it("starts with explicit Mico grants and a bounded tailnet name", () => {
    expect(TailnetConnectionInput.safeParse({ name: "Office", kind: "company", dnsSuffix: "tail123.ts.net", allowedBotIds: [] }).success).toBe(true);
    expect(TailnetConnectionInput.safeParse({ name: "Office", kind: "company", dnsSuffix: "office.local", allowedBotIds: [] }).success).toBe(false);
  });
});
