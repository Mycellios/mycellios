import { describe, expect, it } from "vitest";
import { publicAuthRequest } from "./public-auth-request.js";

describe("public auth namespace", () => {
  it("restores the public callback while retaining query, method, cookies and body", async () => {
    const request = new Request("https://example.com/api/auth/callback/oidc?code=abc&state=xyz", {
      method: "POST",
      headers: { cookie: "state=opaque", origin: "https://example.com" },
      body: "payload",
    });
    const result = publicAuthRequest(request, "https://example.com/agent/api/auth");
    expect(result.url).toBe("https://example.com/agent/api/auth/callback/oidc?code=abc&state=xyz");
    expect(result.method).toBe("POST");
    expect(result.headers.get("cookie")).toBe("state=opaque");
    expect(await result.text()).toBe("payload");
  });
  it("does not change root installs and rejects malformed namespaces", () => {
    const request = new Request("https://example.com/api/auth/get-session");
    expect(publicAuthRequest(request, "https://example.com")).toBe(request);
    expect(publicAuthRequest(request, "https://example.com/api/auth")).toBe(request);
    expect(() => publicAuthRequest(request, "https://example.com/other")).toThrow();
  });
});
