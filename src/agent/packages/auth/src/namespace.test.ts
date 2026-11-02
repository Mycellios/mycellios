import { describe, expect, it } from "vitest";
import { buildTrustedOrigins, createAuth } from "./index.js";

describe("auth behind a product namespace", () => {
  it("keeps configured native origins without trusting an opaque null origin", () => {
    const origins = buildTrustedOrigins({
      webOrigin: "https://example.test",
      baseURL: "https://example.test/agent/api/auth",
      extraOrigins: ["rakazo://"],
    });
    expect(origins).toEqual(["https://example.test", "rakazo://"]);
    expect(origins).not.toContain("null");
  });
  it("serves the configured public auth path without accepting a second root path", async () => {
    const auth = createAuth({} as never, {
      secret: "offline-namespace-fixture-secret-32-bytes",
      baseURL: "https://example.test/agent/api/auth",
      webOrigin: "https://example.test",
      signupsEnabled: "false",
      signupAllowlist: undefined,
    });
    const response = await auth.handler(
      new Request("https://example.test/agent/api/auth/get-session"),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toBeNull();
    const wrong = await auth.handler(new Request("https://example.test/api/auth/get-session"));
    expect(wrong.status).not.toBe(200);
    const context = await auth.$context;
    expect(context.options.advanced?.defaultCookieAttributes?.path).toBe("/agent");
  });
});
