import { describe, expect, it } from "vitest";
import { SupabaseAuthService } from "../src/coordinator/supabase-auth.js";

describe("Supabase network authorization", () => {
  const issuer = "https://product.example.test/agent/auth/v1";
  const oauthToken = (extra: Record<string, unknown> = {}) => `header.${Buffer.from(JSON.stringify({ iss: issuer, sub: "user-1", client_id: "agent-app", ...extra })).toString("base64url")}.signature`;
  it("verifies the separate pinned OAuth authority without forwarding a service key or network role", async () => {
    const calls: string[] = [];
    const auth = new SupabaseAuthService("https://auth.example.test", "private-service-key", async (input, init) => {
      calls.push(String(input));
      expect(String(input)).toBe(`${issuer}/oauth/userinfo`);
      expect(init?.redirect).toBe("error");
      expect(new Headers(init?.headers).get("apikey")).toBeNull();
      return Response.json({ sub: "user-1", email: "user@example.test" });
    }, ["agent-app"], issuer);
    await expect(auth.authenticate(oauthToken())).resolves.toEqual({ id: "user-1", email: "user@example.test", role: null });
    // A pinned-authority token goes straight to that authority, without a Supabase round trip.
    expect(calls).toEqual([`${issuer}/oauth/userinfo`]);
  });
  it("still accepts a pinned-issuer token that only Supabase recognizes", async () => {
    const calls: string[] = [];
    const auth = new SupabaseAuthService("https://auth.example.test", "service", async (input) => {
      calls.push(new URL(String(input)).pathname);
      return String(input).endsWith("/oauth/userinfo") ? new Response(null, { status: 401 }) : Response.json({ id: "user-1" });
    }, ["agent-app"], issuer);
    await expect(auth.authenticate(oauthToken())).resolves.toEqual({ id: "user-1", email: null, role: null });
    expect(calls).toEqual(["/agent/auth/v1/oauth/userinfo", "/auth/v1/user"]);
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

describe("Supabase authentication cache", () => {
  const issuer = "https://product.example.test/agent/auth/v1";
  const token = (extra: Record<string, unknown> = {}) => `header.${Buffer.from(JSON.stringify({ iss: issuer, sub: "user-1", client_id: "agent-app", ...extra })).toString("base64url")}.signature`;
  const oauth = (respond: () => Response | Promise<Response>, now: () => number = Date.now) => {
    const calls = { count: 0 };
    const auth = new SupabaseAuthService("https://auth.example.test", "service", async () => {
      calls.count++;
      return respond();
    }, ["agent-app"], issuer, { now });
    return { auth, calls };
  };

  it("reuses a verified account identity until the TTL ends", async () => {
    let clock = 1_000_000;
    const { auth, calls } = oauth(() => Response.json({ sub: "user-1" }), () => clock);
    await auth.authenticate(token());
    clock += 59_000;
    await expect(auth.authenticate(token())).resolves.toEqual({ id: "user-1", email: null, role: null });
    expect(calls.count).toBe(1);
    clock += 2_000;
    await auth.authenticate(token());
    expect(calls.count).toBe(2);
  });

  it("never reuses an identity past the token's own expiry", async () => {
    let clock = 1_000_000_000;
    const exp = Math.floor(clock / 1_000) + 10;
    const { auth, calls } = oauth(() => Response.json({ sub: "user-1" }), () => clock);
    await auth.authenticate(token({ exp }));
    clock += 9_000;
    await auth.authenticate(token({ exp }));
    expect(calls.count).toBe(1);
    clock += 1_000;
    await auth.authenticate(token({ exp }));
    expect(calls.count).toBe(2);
  });

  it("does not cache an already expired token", async () => {
    const clock = 1_000_000_000;
    const { auth, calls } = oauth(() => Response.json({ sub: "user-1" }), () => clock);
    await auth.authenticate(token({ exp: clock / 1_000 - 1 }));
    await auth.authenticate(token({ exp: clock / 1_000 - 1 }));
    expect(calls.count).toBe(2);
  });

  it("verifies rejected tokens and failures again on every request", async () => {
    let answer: () => Response = () => new Response(null, { status: 401 });
    const { auth, calls } = oauth(() => answer());
    await expect(auth.authenticate(token())).resolves.toBeNull();
    await expect(auth.authenticate(token())).resolves.toBeNull();
    // Each rejected attempt asks the pinned authority, then Supabase.
    expect(calls.count).toBe(4);
    answer = () => { throw new Error("offline"); };
    await expect(auth.authenticate(token())).rejects.toThrow("offline");
    answer = () => Response.json({ sub: "user-1" });
    await expect(auth.authenticate(token())).resolves.toMatchObject({ id: "user-1" });
  });

  it("shares one verification between concurrent requests with the same token", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const { auth, calls } = oauth(async () => { await gate; return Response.json({ sub: "user-1" }); });
    const both = Promise.all([auth.authenticate(token()), auth.authenticate(token())]);
    release();
    const [first, second] = await both;
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(calls.count).toBe(1);
  });

  it("keeps tokens apart and never caches a network role", async () => {
    let calls = 0;
    const auth = new SupabaseAuthService("https://supabase.example.test", "service-role", async (input, init) => {
      calls++;
      if (new URL(String(input)).pathname === "/auth/v1/user")
        return Response.json({ id: new Headers(init?.headers).get("authorization") === "Bearer owner-token" ? "owner" : "member" });
      return Response.json(new Headers(init?.headers).get("authorization") === "Bearer service-role" && calls <= 2 ? [{ role: "owner" }] : []);
    });
    await expect(auth.authenticate("owner-token")).resolves.toMatchObject({ id: "owner", role: "owner" });
    // The role is read again, so a revoked administrator loses it immediately.
    await expect(auth.authenticate("owner-token")).resolves.toMatchObject({ id: "owner", role: null });
    await expect(auth.authenticate("member-token")).resolves.toMatchObject({ id: "member", role: null });
    expect(calls).toBe(6);
  });

  it("stays bounded and returns copies callers cannot alter", async () => {
    const { auth, calls } = (() => {
      const calls = { count: 0 };
      const auth = new SupabaseAuthService("https://auth.example.test", "service", async () => {
        calls.count++;
        return Response.json({ sub: "user-1" });
      }, ["agent-app"], issuer, { maxEntries: 2 });
      return { auth, calls };
    })();
    const first = await auth.authenticate(token({ n: 1 }));
    first!.id = "tampered";
    await expect(auth.authenticate(token({ n: 1 }))).resolves.toMatchObject({ id: "user-1" });
    await auth.authenticate(token({ n: 2 }));
    await auth.authenticate(token({ n: 3 }));
    expect(calls.count).toBe(3);
    await auth.authenticate(token({ n: 1 }));
    expect(calls.count).toBe(4);
  });
});
