import { createRouterClient } from "@orpc/server";
import { serializeModelSecret } from "@mycellios/adapters";
import { describe, expect, it, vi } from "vitest";
import { createRouter, type RouterDeps } from "./router.js";
import { isAgentKey } from "./routes/mycellios-api-keys.js";

const AGENT_SECRET = `myc_live_agentkey01_${"s".repeat(43)}`;
const keyRow = (id: string, prefix: string, name: string) => ({
  id, name, prefix, created_at: "2026-11-01T10:00:00.000Z", last_used_at: null, revoked_at: null,
});

function fixture({ sso = true, agentKey = true } = {}) {
  const token = vi.fn(async () => "fixture-oidc-session");
  const rows = [
    keyRow("key_agent", "myc_live_agentkey01", "Mycellios Agent"),
    keyRow("key_app", "myc_live_appkey0001", "My application"),
  ];
  const transport = vi.fn<typeof fetch>(async (url, init) => {
    const method = init?.method ?? "GET";
    if (String(url) === "https://www.mycellios.com/v1/api-keys" && method === "GET") return Response.json({ data: rows });
    if (String(url) === "https://www.mycellios.com/v1/api-keys" && method === "POST")
      return Response.json({ ...keyRow("key_new", "myc_live_newkey0001", "CLI"), secret: `myc_live_newkey0001_${"n".repeat(43)}` }, { status: 201 });
    if (method === "DELETE") return new Response(null, { status: 204 });
    return new Response("unexpected", { status: 500 });
  });
  const credential = { id: "credential", provider: "openai-compatible", secretId: "secret", userPreferences: [] };
  const deps = {
    auth: { oidcAccessToken: token },
    modelConnectionFetch: transport,
    env: { mycelliosSso: sso, sandboxProvider: "fake" },
    prisma: {
      userModelCredential: { findMany: vi.fn(async () => (agentKey ? [credential] : [])) },
      secret: { findFirst: vi.fn(async () => ({ ciphertext: "encrypted" })) },
    },
    secrets: {
      load: vi.fn(async () => serializeModelSecret({
        kind: "openai_compatible", baseUrl: "https://www.mycellios.com/v1", apiKey: AGENT_SECRET,
      })),
    },
  } as unknown as RouterDeps;
  const client = createRouterClient(createRouter(deps), { context: {
    actor: { userId: "owner", spaceId: "space", email: "owner@example.test" },
    requestHeaders: new Headers(),
  } as never });
  return { client, transport, token };
}

describe("Mycellios API keys in the Agent account", () => {
  it("lists keys with the owner's server-side session and marks Agent's own key", async () => {
    const f = fixture();
    const result = await f.client.mycelliosApiKeys.list({ expectedUserId: "owner" });
    expect(f.token).toHaveBeenCalledWith(expect.any(Headers), "owner");
    const [url, init] = f.transport.mock.calls[0]!;
    expect(url).toBe("https://www.mycellios.com/v1/api-keys");
    expect(init).toMatchObject({ method: "GET", redirect: "error", cache: "no-store" });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer fixture-oidc-session");
    expect(result.apiBaseUrl).toBe("https://www.mycellios.com/v1");
    expect(result.keys.map((key) => [key.id, key.usedByAgent])).toEqual([["key_agent", true], ["key_app", false]]);
    expect(JSON.stringify(result)).not.toContain("fixture-oidc-session");
    expect(JSON.stringify(result)).not.toContain(AGENT_SECRET);
  });

  it("returns a new secret once to the caller", async () => {
    const f = fixture();
    const created = await f.client.mycelliosApiKeys.create({ expectedUserId: "owner", name: "  CLI  " });
    expect(created.secret).toMatch(/^myc_live_newkey0001_/);
    expect(created.key).toMatchObject({ id: "key_new", prefix: "myc_live_newkey0001", usedByAgent: false });
    expect(JSON.parse(String(f.transport.mock.calls[0]![1]?.body))).toEqual({ name: "CLI" });
  });

  it("revokes an ordinary key and refuses Agent's own key before any change", async () => {
    const f = fixture();
    expect(await f.client.mycelliosApiKeys.revoke({ expectedUserId: "owner", keyId: "key_app" })).toEqual({ revoked: true });
    expect(f.transport).toHaveBeenLastCalledWith("https://www.mycellios.com/v1/api-keys/key_app", expect.objectContaining({ method: "DELETE" }));
    f.transport.mockClear();
    await expect(f.client.mycelliosApiKeys.revoke({ expectedUserId: "owner", keyId: "key_agent" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.transport.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
  });

  it("rejects another account and signed-out SSO before reading a token", async () => {
    const f = fixture();
    await expect(f.client.mycelliosApiKeys.list({ expectedUserId: "someone-else" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const g = fixture({ sso: false });
    await expect(g.client.mycelliosApiKeys.list({ expectedUserId: "owner" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(f.token).not.toHaveBeenCalled();
    expect(g.transport).not.toHaveBeenCalled();
  });

  it("maps upstream failures without exposing their body", async () => {
    const f = fixture();
    f.transport.mockResolvedValueOnce(new Response("private upstream diagnostic", { status: 409 }));
    const error = await f.client.mycelliosApiKeys.create({ expectedUserId: "owner", name: "Extra" }).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "CONFLICT" });
    expect(String((error as Error).message)).not.toContain("private upstream diagnostic");
  });

  it("matches Agent's key only by its full public prefix", () => {
    expect(isAgentKey("myc_live_agentkey01", AGENT_SECRET)).toBe(true);
    expect(isAgentKey("myc_live_agentkey0", AGENT_SECRET)).toBe(false);
    expect(isAgentKey("myc_live_agentkey01", undefined)).toBe(false);
  });
});
