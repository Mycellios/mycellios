import { describe, expect, it } from "vitest";
import { productAppUrl } from "./product-url.js";

describe("product route URLs", () => {
  it("preserves root deployments", () => {
    expect(productAppUrl("https://example.test", "/app/bot?m=1")).toBe(
      "https://example.test/app/bot?m=1",
    );
  });
  it("retains namespaces for auth, MCP, integrations and webhook callbacks", () => {
    for (const base of ["https://example.test/agent", "https://example.test/agent/"])
      for (const path of [
        "/sign-in",
        "/reset-password",
        "/mcp/oauth/callback",
        "/integrations/setup",
        "/api/v1/messaging/webhook/sendblue",
      ])
        expect(productAppUrl(base, path)).toBe(`https://example.test/agent${path}`);
  });
  it("rejects route escapes and foreign destinations", () => {
    for (const path of ["//other.test/x", "https://other.test/", "/../outside", "/%2e%2e/outside"])
      expect(() => productAppUrl("https://example.test/agent", path)).toThrow();
  });
});
