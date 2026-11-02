import { describe, expect, it } from "vitest";
import { SupabaseAuthService } from "../src/coordinator/supabase-auth.js";

describe("Supabase network authorization", () => {
  const issuer = "https://product.example.test/agent/auth/v1";
  const oauthToken = (extra: Record<string, unknown> = {}) => `header.${Buffer.from(JSON.stringify({ iss: issuer, sub: "user-1", client_id: "agent-app", ...extra })).toString("base64url")}.signature`;
  it("verifies the separate pinned OAuth authority without forwarding a service key or network role", async () => {
    const calls: string[] = [];
    const auth = new SupabaseAuthService("https://auth.example.test", "private-service-key", async (input, init) => {
      calls.push(String(input));
      if (calls.length === 1) return new Response(null, { status: 401 });
      expect(String(input)).toBe(`${issuer}/oauth/userinfo`);
      expect(init?.redirect).toBe("error");
      expect(new Headers(init?.headers).get("apikey")).toBeNull();
      return Response.json({ sub: "user-1", email: "user@example.test" });
    }, ["agent-app"], issuer);
    await expect(auth.authenticate(oauthToken())).resolves.toEqual({ id: "user-1", email: "user@example.test", role: null });
    expect(calls.length).toBe(2);
  });
  it("never follows a token's issuer or trusts an unregistered app", async () => {
    for (const claims of [{ iss: "https://untrusted.example.test" }, { client_id: "unknown" }]) {
      let calls = 0;
      const auth = new SupabaseAuthService("https://auth.example.test", "service", async () => { calls++; return new Response(null, { status: 401 }); }, ["agent-app"], issuer);
      await expect(auth.authenticate(oauthToken(claims))).resolves.toBeNull();
      expect(calls).toBe(1);
    }
  });
  it("fails closed on malformed OAuth claims", async () => {
    for (const raw of ["null", "[]", "not json"]) {
      let calls = 0;
      const auth = new SupabaseAuthService("https://auth.example.test", "service", async () => { calls++; return new Response(null, { status: 401 }); }, ["agent-app"], issuer);
      await expect(auth.authenticate(`header.${Buffer.from(raw).toString("base64url")}.signature`)).resolves.toBeNull();
      expect(calls).toBe(1);
    }
  });
  it("rejects an expired token and an identity mismatch at the pinned authority", async () => {
    for (const response of [new Response(null, { status: 401 }), Response.json({ sub: "another-user" })]) {
      let calls = 0;
      const auth = new SupabaseAuthService("https://auth.example.test", "service", async () => ++calls === 1 ? new Response(null, { status: 401 }) : response, ["agent-app"], issuer);
      await expect(auth.authenticate(oauthToken())).resolves.toBeNull();
    }
  });
  it("rejects unregistered OAuth clients after authoritative verification", async () => {
    const token = `header.${Buffer.from(JSON.stringify({ client_id: "untrusted-app" })).toString("base64url")}.signature`;
    const auth = new SupabaseAuthService("https://auth.example.test", "service", async () => Response.json({ id: "user" }));
    await expect(auth.authenticate(token)).resolves.toBeNull();
  });
  it("allows a registered app to use its own account without inheriting a network role", async () => {
    const token = `header.${Buffer.from(JSON.stringify({ client_id: "agent-app" })).toString("base64url")}.signature`;
    let calls = 0;
    const auth = new SupabaseAuthService("https://auth.example.test", "service", async () => { calls++; return Response.json({ id: "user", email: "user@example.test" }); }, ["agent-app"]);
    await expect(auth.authenticate(token)).resolves.toEqual({ id: "user", email: "user@example.test", role: null });
    expect(calls).toBe(1);
  });
  it("returns the authenticated user and network role", async () => {
    const calls: string[] = [];
    const auth = new SupabaseAuthService(
      "https://supabase.example.test",
      "service-role",
      async (input) => {
        const url = new URL(String(input));
        calls.push(url.pathname);
        if (url.pathname === "/auth/v1/user") {
          return Response.json({ id: "user-1", email: "owner@example.test" });
        }
        return Response.json([{ role: "owner" }]);
      },
    );

    await expect(auth.authenticate("user-access-token")).resolves.toEqual({
      id: "user-1",
      email: "owner@example.test",
      role: "owner",
    });
    expect(calls).toEqual(["/auth/v1/user", "/rest/v1/network_members"]);
  });

  it("rejects an expired access token without consulting membership", async () => {
    let calls = 0;
    const auth = new SupabaseAuthService(
      "https://supabase.example.test",
      "service-role",
      async () => {
        calls += 1;
        return new Response(null, { status: 401 });
      },
    );

    await expect(auth.authenticate("expired")).resolves.toBeNull();
    expect(calls).toBe(1);
  });
});
