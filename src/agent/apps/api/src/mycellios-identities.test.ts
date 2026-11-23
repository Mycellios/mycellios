import { createRouterClient } from "@orpc/server";
import { describe, expect, it, vi } from "vitest";
import { createRouter, type RouterDeps } from "./router.js";

const ISSUER = "https://www.mycellios.com/agent/auth/v1";
const STATE = "0123456789abcdef0123456789abcdef";
const identity = (id: string, provider: string, email?: string) => ({
  identity_id: id,
  id: `${provider}-subject`,
  provider,
  identity_data: email ? { email, sub: `${provider}-subject` } : {},
});

function fixture({
  sso = true,
  identities = [identity("id-email", "email", "owner@example.test"), identity("id-google", "google", "owner@gmail.test")],
  providerUrl = "https://accounts.google.com/o/oauth2/v2/auth?state=authority-state",
} = {}) {
  const token = vi.fn(async () => "fixture-oidc-session");
  const transport = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url === "https://www.mycellios.com/public/v1/auth-config")
      return Response.json({ enabled: true, url: "https://www.mycellios.com", anonKey: "public-anon-key" });
    if (url === `${ISSUER}/settings`) return Response.json({ external: { email: true, google: true, twitter: true } });
    if (url === `${ISSUER}/user` && method === "GET") return Response.json({ id: "subject", identities });
    if (url.startsWith(`${ISSUER}/user/identities/authorize?`)) return Response.json({ url: providerUrl });
    if (url.startsWith(`${ISSUER}/user/identities/`) && method === "DELETE") return Response.json({});
    return new Response("unexpected", { status: 500 });
  });
  const deps = {
    auth: { oidcAccessToken: token },
    modelConnectionFetch: transport,
    env: {
      mycelliosSso: sso,
      mycelliosIdentityIssuer: sso ? ISSUER : undefined,
      webOrigin: "https://www.mycellios.com/agent",
      sandboxProvider: "fake",
    },
  } as unknown as RouterDeps;
  const client = createRouterClient(createRouter(deps), { context: {
    actor: { userId: "owner", spaceId: "space", email: "owner@example.test" },
    requestHeaders: new Headers(),
  } as never });
  const calls = (method: string) => transport.mock.calls.filter(([, init]) => (init?.method ?? "GET") === method);
  return { client, transport, token, calls };
}

describe("Google and X sign-in in the Agent account", () => {
  it("lists sign-in methods with the owner's server-side session at the identity authority", async () => {
    const f = fixture();
    const result = await f.client.mycelliosIdentities.list({ expectedUserId: "owner" });
    expect(f.token).toHaveBeenCalledWith(expect.any(Headers), "owner");
    expect(result).toEqual({
      available: { google: true, twitter: true },
      identities: [
        { id: "id-email", provider: "email", email: "owner@example.test" },
        { id: "id-google", provider: "google", email: "owner@gmail.test" },
      ],
    });
    const user = f.transport.mock.calls.find(([url]) => String(url) === `${ISSUER}/user`)!;
    expect(user[1]).toMatchObject({ method: "GET", redirect: "error", cache: "no-store" });
    expect(new Headers(user[1]?.headers).get("authorization")).toBe("Bearer fixture-oidc-session");
    expect(new Headers(user[1]?.headers).get("apikey")).toBe("public-anon-key");
    const settings = f.transport.mock.calls.find(([url]) => String(url) === `${ISSUER}/settings`)!;
    expect(new Headers(settings[1]?.headers).get("authorization")).toBeNull();
    expect(JSON.stringify(result)).not.toContain("fixture-oidc-session");
  });

  it("returns to the fixed profile section with the browser's own state", async () => {
    const f = fixture();
    const result = await f.client.mycelliosIdentities.link({ expectedUserId: "owner", provider: "twitter", state: STATE });
    expect(result.url).toBe("https://accounts.google.com/o/oauth2/v2/auth?state=authority-state");
    const [url, init] = f.transport.mock.calls.find(([value]) => String(value).includes("/identities/authorize"))!;
    const authorize = new URL(String(url));
    expect(authorize.searchParams.get("provider")).toBe("twitter");
    expect(authorize.searchParams.get("skip_http_redirect")).toBe("true");
    expect(authorize.searchParams.get("redirect_to")).toBe(
      `https://www.mycellios.com/agent/app?settings=profile&identityLinkState=${STATE}`,
    );
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer fixture-oidc-session");
  });

  it("refuses a malformed state and an unsafe provider link", async () => {
    const f = fixture();
    await expect(
      f.client.mycelliosIdentities.link({ expectedUserId: "owner", provider: "google", state: "https://evil.example" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(f.token).not.toHaveBeenCalled();
    const g = fixture({ providerUrl: "http://accounts.google.com/auth" });
    await expect(
      g.client.mycelliosIdentities.link({ expectedUserId: "owner", provider: "google", state: STATE }),
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });

  it("unlinks Google when another sign-in method remains", async () => {
    const f = fixture();
    expect(await f.client.mycelliosIdentities.unlink({ expectedUserId: "owner", identityId: "id-google" })).toEqual({ unlinked: true });
    const [url, init] = f.calls("DELETE")[0]!;
    expect(url).toBe(`${ISSUER}/user/identities/id-google`);
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer fixture-oidc-session");
  });

  it("never unlinks the last sign-in method or a method other than Google and X", async () => {
    const only = fixture({ identities: [identity("id-google", "google", "owner@gmail.test")] });
    await expect(only.client.mycelliosIdentities.unlink({ expectedUserId: "owner", identityId: "id-google" }))
      .rejects.toMatchObject({ code: "CONFLICT" });
    expect(only.calls("DELETE")).toHaveLength(0);
    const f = fixture();
    await expect(f.client.mycelliosIdentities.unlink({ expectedUserId: "owner", identityId: "id-email" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(f.client.mycelliosIdentities.unlink({ expectedUserId: "owner", identityId: "id-unknown" }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(f.calls("DELETE")).toHaveLength(0);
  });

  it("maps the authority's own refusal without exposing its body", async () => {
    const f = fixture();
    f.transport.mockImplementation(async (input, init) => {
      if ((init?.method ?? "GET") === "DELETE") return new Response("private authority diagnostic", { status: 422 });
      if (String(input) === `${ISSUER}/user`)
        return Response.json({ identities: [identity("id-email", "email"), identity("id-x", "twitter")] });
      return Response.json({});
    });
    const error = await f.client.mycelliosIdentities.unlink({ expectedUserId: "owner", identityId: "id-x" }).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "CONFLICT" });
    expect(String((error as Error).message)).not.toContain("private authority diagnostic");
  });

  it("rejects another account and deployments without Mycellios sign-in before reading a token", async () => {
    const f = fixture();
    await expect(f.client.mycelliosIdentities.list({ expectedUserId: "someone-else" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const g = fixture({ sso: false });
    await expect(g.client.mycelliosIdentities.list({ expectedUserId: "owner" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(f.token).not.toHaveBeenCalled();
    expect(g.token).not.toHaveBeenCalled();
    expect(g.transport).not.toHaveBeenCalled();
  });
});
