import { createRouterClient } from "@orpc/server";
import { serializeModelSecret } from "@rakazo/adapters";
import type { Actor } from "@rakazo/contracts";
import { describe, expect, it, vi } from "vitest";
import type { RouterDeps } from "./router.js";
import { createRouter } from "./router.js";
import * as modelCredentials from "./model-credentials.js";

function fixture(mycelliosSso = false) {
  const actor: Actor = {
    userId: "fixture-user",
    spaceId: "fixture-space",
    email: "user@example.test",
    isDeploymentOwner: false,
  };
  const preference = vi.fn().mockResolvedValue(null);
  const credentials = vi.fn().mockResolvedValue([]);
  const secret = vi.fn().mockResolvedValue(null);
  const load = vi.fn().mockResolvedValue(
    serializeModelSecret({
      kind: "openai_compatible",
      baseUrl: "https://www.mycellios.com/v1",
      apiKey: "fixture-account-key",
    }),
  );
  const account = {
    object: "economic_account",
    asset: "MYC_MICROCREDITS",
    balanceMicrounits: 42,
    lifetimeMicrounits: 42,
    settledJobs: 1,
  };
  const transport = vi.fn(async () => Response.json(account));
  const deps = {
    prisma: {
      spaceModelPreference: { findFirst: preference },
      userModelCredential: { findFirst: vi.fn().mockResolvedValue(null), findMany: credentials },
      secret: { findFirst: secret },
      deploymentSettings: { findUnique: vi.fn().mockResolvedValue(null) },
    },
    auth: { oidcAccessToken: vi.fn().mockResolvedValue("fixture-session-token") },
    env: {
      mycelliosSso,
      defaultProvider: "fake",
      defaultModel: "fake-model",
      webOrigin: "http://127.0.0.1:5173",
      screenProxySecret: "fixture-secret",
      sandboxProvider: "fake",
    },
    dataDir: "/tmp/fixture-agent",
    secrets: { load },
    modelConnectionFetch: transport,
  } as unknown as RouterDeps;
  const router = createRouter(deps);
  const connected = () => {
    credentials.mockResolvedValue([{
      id: "fixture-credential", provider: "openai-compatible", secretId: "fixture-secret",
    }]);
    preference.mockResolvedValue({
      isDefault: true,
      modelId: "fixture-model",
      thinkingLevel: null,
      credential: {
        id: "fixture-credential",
        provider: "openai-compatible",
        secretId: "fixture-secret",
      },
    });
  };
  return {
    deps,
    actor,
    accountToken: deps.auth.oidcAccessToken as ReturnType<typeof vi.fn>,
    preference,
    credentials,
    secret,
    load,
    account,
    transport,
    connected,
    router,
    signedInClient: createRouterClient(router, {
      context: { actor, requestHeaders: new Headers() } as never,
    }),
    client: createRouterClient(router, { context: { actor } as never }),
  };
}

describe("Mycellios account RPC authorization", () => {
  it("keeps the built-in connection and its roles during a legacy bulk disconnect", async () => {
    const f = fixture(true); f.connected(); f.secret.mockResolvedValue({ ciphertext: "encrypted-fixture" });
    const remove = vi.fn().mockResolvedValue({ count: 1 });
    const accountRoles = vi.fn().mockResolvedValue({ count: 1 });
    const spaceRoles = vi.fn().mockResolvedValue({ count: 1 });
    const removeSecret = vi.fn().mockResolvedValue({ count: 1 });
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ bypass: "off" }]),
      userModelCredential: {
        findMany: vi.fn().mockResolvedValue([
          { id: "fixture-credential", secretId: "fixture-secret" },
          { id: "personal-gateway", secretId: "personal-secret" },
        ]),
        deleteMany: remove, count: vi.fn().mockResolvedValue(0),
      },
      userVoiceCredential: { count: vi.fn().mockResolvedValue(0) },
      userModelRoleChoice: { deleteMany: accountRoles },
      spaceModelRoleChoice: { deleteMany: spaceRoles }, secret: { deleteMany: removeSecret },
    };
    f.deps.prisma.$transaction = vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) as never;
    f.deps.oauthLogins = { cancelProvider: vi.fn().mockResolvedValue(undefined) } as never;
    await f.signedInClient.models.disconnect({ provider: "openai-compatible" });
    expect(remove).toHaveBeenCalledExactlyOnceWith({ where: { userId: f.actor.userId, id: { in: ["personal-gateway"] } } });
    for (const cleanup of [accountRoles, spaceRoles]) expect(cleanup).toHaveBeenCalledExactlyOnceWith({
      where: { userId: f.actor.userId, provider: expect.anything(), OR: [{ credentialId: { in: ["personal-gateway"] } }] },
    });
    expect(removeSecret).toHaveBeenCalledExactlyOnceWith({ where: { id: "personal-secret" } });
  });
  it.each(["disconnect", "rename"] as const)("rejects %s of the built-in provider before changing credentials", async (operation) => {
    const f = fixture(true); f.connected();
    f.secret.mockResolvedValue({ ciphertext: "encrypted-fixture" });
    const result = operation === "disconnect"
      ? f.signedInClient.models.disconnect({ provider: "openai-compatible", credentialId: "fixture-credential" })
      : f.signedInClient.models.rename({ credentialId: "fixture-credential", label: "Replacement" });
    await expect(result).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.transport).not.toHaveBeenCalled();
  });
  it("discovers models for the signed-in account without creating a key or spending credits", async () => {
    const f = fixture(true);
    f.transport.mockImplementation(async (url?: unknown) => Response.json(String(url).endsWith("/models")
      ? { data: [{ id: "qwen3-8b" }, { id: "kokoro" }] }
      : { ...f.account, contributionFundingSupported: true }) as never);
    expect(await f.signedInClient.models.mycelliosModels()).toMatchObject([{ id: "qwen3-8b", providerName: "Mycellios" }]);
    expect(f.credentials).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: f.actor.userId, provider: "openai-compatible" } }));
    expect(f.transport).toHaveBeenCalledTimes(2);
  });
  it("keeps an existing main model when connecting Mycellios and reuses the owned key", async () => {
    const f = fixture(true);
    f.connected();
    f.secret.mockResolvedValue({ ciphertext: "encrypted-fixture" });
    f.transport.mockImplementation(async (url?: unknown) => Response.json(String(url).endsWith("/models")
      ? { data: [{ id: "qwen3-8b" }] }
      : { ...f.account, contributionFundingSupported: true }) as never);
    const save = vi.spyOn(modelCredentials, "persistModelCredential").mockResolvedValue({ id: "fixture-credential", provider: "openai-compatible", label: "Mycellios", hasKey: true, isDefault: false } as never);
    try {
      await f.signedInClient.models.connectMycellios();
      expect(save).toHaveBeenCalledWith(expect.anything(), f.actor, expect.objectContaining({
        credentialId: "fixture-credential", keepExistingDefault: true, scope: "account", modelId: "qwen3-8b",
      }), expect.anything());
      const saved = save.mock.calls[0]![2];
      expect(JSON.parse(saved.plaintext)).toMatchObject({ apiKey: "fixture-account-key", headers: { "x-mycellios-funding": "contribution-credits" } });
      expect(f.transport).toHaveBeenCalledTimes(2);
    } finally { save.mockRestore(); }
  });
  it("returns a safe unavailable error instead of an internal error when native authorization fails", async () => {
    const f = fixture(true);
    f.transport.mockImplementation(
      async () => new Response("private upstream diagnostic", { status: 401 }) as never,
    );
    await expect(f.signedInClient.models.connectMycellios()).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      message: "Mycellios account access is temporarily unavailable. No credits were spent.",
    });
    expect(f.transport).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])("reuses only the owned connection without renewing SSO (SSO enabled: %s)", async (enabled) => {
    const f = fixture(enabled);
    f.connected();
    f.secret.mockResolvedValue({ ciphertext: "encrypted-fixture" });
    f.accountToken.mockRejectedValue(new Error("expired SSO must not block an owned key"));
    f.transport.mockImplementation(async (url?: unknown) => Response.json(String(url).endsWith("/models")
      ? { data: [{ id: "qwen3-8b" }] }
      : { ...f.account, contributionFundingSupported: true }) as never);
    const save = vi.spyOn(modelCredentials, "persistModelCredential").mockResolvedValue({
      id: "fixture-credential", provider: "openai-compatible", label: "Mycellios", hasKey: true, isDefault: false,
    } as never);
    try {
      await f.client.models.connectMycellios();
      expect(f.accountToken).not.toHaveBeenCalled();
      expect(f.transport).toHaveBeenCalledTimes(2);
      for (const [, init] of f.transport.mock.calls as unknown as [unknown, RequestInit][]) {
        expect(init.method ?? "GET").toBe("GET");
        expect(new Headers(init.headers).get("authorization")).toBe("Bearer fixture-account-key");
      }
      expect(save).toHaveBeenCalledWith(expect.anything(), f.actor,
        expect.objectContaining({ credentialId: "fixture-credential", keepExistingDefault: true, scope: "account" }), expect.anything());
    } finally { save.mockRestore(); }
  });

  it("does not reuse a key whose secret is not owned by the signed-in account", async () => {
    const f = fixture();
    f.connected();
    f.secret.mockResolvedValue(null);
    await expect(f.client.models.connectMycellios()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.secret).toHaveBeenCalledWith(expect.objectContaining({ where: {
      id: "fixture-secret", userId: f.actor.userId, spaceId: null,
    } }));
    expect(f.load).not.toHaveBeenCalled();
    expect(f.transport).not.toHaveBeenCalled();
  });

  it("preserves the account's selected model when reconnecting instead of a Space preference", async () => {
    const f = fixture(true);
    f.credentials.mockResolvedValue([{
      id: "fixture-credential", provider: "openai-compatible", secretId: "fixture-secret",
      userPreferences: [{ modelId: "qwen3-8b" }],
      preferences: [{ modelId: "qwen3-14b" }],
    }]);
    f.secret.mockResolvedValue({ ciphertext: "encrypted-fixture" });
    f.transport.mockImplementation(async (url?: unknown) => Response.json(String(url).endsWith("/models")
      ? { data: [{ id: "qwen3-14b", recommended: true }, { id: "qwen3-8b" }] }
      : { ...f.account, contributionFundingSupported: true }) as never);
    const save = vi.spyOn(modelCredentials, "persistModelCredential").mockResolvedValue({
      id: "fixture-credential", provider: "openai-compatible", label: "Mycellios", hasKey: true, isDefault: false,
    } as never);
    try {
      await f.signedInClient.models.connectMycellios();
      expect(save).toHaveBeenCalledWith(expect.anything(), f.actor,
        expect.objectContaining({ modelId: "qwen3-8b", keepExistingDefault: true, scope: "account" }), expect.anything());
      expect(f.credentials).toHaveBeenCalledWith(expect.objectContaining({
        include: { userPreferences: { where: { userId: f.actor.userId } } },
      }));
    } finally { save.mockRestore(); }
  });

  it("does not provision a key when Mycellios SSO is not enabled", async () => {
    const f = fixture();
    await expect(f.client.models.connectMycellios()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.transport).not.toHaveBeenCalled();
  });
  it("discovers canonical Mycellios models through the configured transport", async () => {
    const f = fixture();
    f.transport.mockImplementation(
      async () => Response.json({ data: [{ id: "fixture-model" }] }) as never,
    );
    await expect(
      f.client.models.probeOpenAiCompatible({
        baseUrl: "https://www.mycellios.com/v1",
        apiKey: "fixture-account-key",
        headers: {},
      }),
    ).resolves.toEqual({ models: ["fixture-model"] });
    expect(f.transport).toHaveBeenCalledOnce();
  });
  it("requires a session before looking up a credential", async () => {
    const f = fixture();
    const anonymous = createRouterClient(f.router, { context: {} as never });
    await expect(anonymous.models.mycelliosAccount()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(f.preference).not.toHaveBeenCalled();
    expect(f.transport).not.toHaveBeenCalled();
  });

  it("returns no balance for an unconnected account", async () => {
    const f = fixture();
    await expect(f.client.models.mycelliosAccount()).resolves.toBeNull();
    expect(f.transport).not.toHaveBeenCalled();
  });
  it("shows the SSO account balance without provisioning a key or configuring a model", async () => {
    const f = fixture(true);
    await expect(f.signedInClient.models.mycelliosAccount()).resolves.toEqual(f.account);
    expect(f.credentials).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: f.actor.userId, provider: "openai-compatible" },
    }));
    expect(f.secret).not.toHaveBeenCalled();
    expect(f.transport).toHaveBeenCalledOnce();
    const [url, init] = f.transport.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toBe("https://www.mycellios.com/v1/account/economy");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer fixture-session-token");
    expect(init.method ?? "GET").toBe("GET");
  });

  it("keeps owned credit access and discovery working when the linked SSO token is unavailable", async () => {
    const f = fixture(true);
    f.connected();
    f.secret.mockResolvedValue({ ciphertext: "encrypted-fixture" });
    f.transport.mockImplementation(async (url?: unknown) => Response.json(String(url).endsWith("/models")
      ? { data: [{ id: "qwen3-8b" }] }
      : { ...f.account, contributionFundingSupported: true }) as never);
    await expect(f.signedInClient.models.mycelliosAccount()).resolves.toMatchObject(f.account);
    await expect(f.signedInClient.models.mycelliosModels()).resolves.toMatchObject([{ id: "qwen3-8b" }]);
    for (const [, init] of f.transport.mock.calls as unknown as [unknown, RequestInit][])
      expect(new Headers(init.headers).get("authorization")).toBe("Bearer fixture-account-key");
  });

  it("resolves only the authenticated user's connected credential and owned secret", async () => {
    const f = fixture();
    f.connected();
    f.secret.mockResolvedValue({ ciphertext: "fixture-ciphertext" });
    await expect(f.client.models.mycelliosAccount()).resolves.toEqual(f.account);
    expect(f.credentials).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: f.actor.userId,
          provider: "openai-compatible",
        },
      }),
    );
    expect(f.secret).toHaveBeenCalledWith({
      where: { id: "fixture-secret", userId: f.actor.userId, spaceId: null },
      select: { ciphertext: true },
    });
    expect(f.load).toHaveBeenCalledWith("fixture-ciphertext", "fixture-secret");
    expect(f.transport).toHaveBeenCalledOnce();
  });

  it("keeps the Mycellios balance when another provider is the default", async () => {
    const f = fixture();
    f.connected();
    const native = await f.preference();
    f.preference.mockImplementation(async (args) =>
      args.where.isDefault ? { credential: { provider: "antseed" } } : native,
    );
    f.secret.mockResolvedValue({ ciphertext: "fixture-ciphertext" });
    await expect(f.client.models.mycelliosAccount()).resolves.toEqual(f.account);
    expect(f.credentials).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: f.actor.userId, provider: "openai-compatible" },
    }));
  });

  it("does not send another compatible provider's key to Mycellios", async () => {
    const f = fixture();
    f.connected();
    f.secret.mockResolvedValue({ ciphertext: "fixture-ciphertext" });
    f.load.mockResolvedValue(
      serializeModelSecret({
        kind: "openai_compatible",
        baseUrl: "https://other.example/v1",
        apiKey: "other-fixture-key",
      }),
    );
    await expect(f.client.models.mycelliosAccount()).resolves.toBeNull();
    expect(f.transport).not.toHaveBeenCalled();
  });

  it("finds the owned native account behind a newer unrelated compatible connection", async () => {
    const f = fixture();
    f.credentials.mockResolvedValue([
      { id: "other", provider: "openai-compatible", secretId: "other-secret" },
      { id: "native", provider: "openai-compatible", secretId: "native-secret" },
    ]);
    f.secret.mockImplementation(async ({ where }) => ({ ciphertext: where.id }));
    f.load.mockImplementation(async (_ciphertext, id) => serializeModelSecret({
      kind: "openai_compatible",
      baseUrl: id === "native-secret" ? "https://www.mycellios.com/v1" : "https://other.example/v1",
      apiKey: id === "native-secret" ? "native-fixture-key" : "other-fixture-key",
    }));
    await expect(f.client.models.mycelliosAccount()).resolves.toEqual(f.account);
    expect(f.transport).toHaveBeenCalledOnce();
    const request = f.transport.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(request[1].headers).get("authorization")).toBe("Bearer native-fixture-key");
  });

  it("does not fall back to another user's secret when the owned secret is unavailable", async () => {
    const f = fixture();
    f.connected();
    await expect(f.client.models.mycelliosAccount()).resolves.toBeNull();
    expect(f.load).not.toHaveBeenCalled();
    expect(f.transport).not.toHaveBeenCalled();
  });

  it("reports an unavailable service without exposing provider diagnostics or a false zero", async () => {
    const f = fixture();
    f.connected();
    f.secret.mockResolvedValue({ ciphertext: "fixture-ciphertext" });
    f.transport.mockResolvedValue(new Response("private upstream diagnostics", { status: 503 }));
    await expect(f.client.models.mycelliosAccount()).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      message: "Mycellios credits are temporarily unavailable.",
    });
  });
  it.each([401, 403] as const)("passes authority access denial %s to the sidebar without diagnostics", async status => {
    const f = fixture(true);
    f.transport.mockResolvedValue(new Response("private upstream fixture-session-token", { status }));
    await expect(f.signedInClient.models.mycelliosAccount()).rejects.toMatchObject({
      code: status === 401 ? "UNAUTHORIZED" : "FORBIDDEN",
      message: "Sign in again to see your Mycellios credits.",
    });
    expect(f.transport).toHaveBeenCalledOnce();
  });
});

it("requires linked-account SSO for every contribution RPC and never substitutes a model key", async () => {
  const f = fixture(false);
  await expect(f.client.models.contributionStatus({ nodeId: "own-node" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(f.client.models.contributionControl({ nodeId: "own-node", action: "resume" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(f.client.models.contributionEnrollment()).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(f.transport).not.toHaveBeenCalled();
});

it("preserves missing SSO authorization so the UI clears an old verified balance", async()=>{
 const f=fixture(true);f.accountToken.mockResolvedValue(null);
 await expect(f.signedInClient.models.mycelliosAccount()).rejects.toMatchObject({code:"UNAUTHORIZED"});
 expect(f.transport).not.toHaveBeenCalled();
});
it("links browser payouts through SSO to the canonical service, without any client-supplied account id",async()=>{
 const f=fixture(true);f.transport.mockResolvedValue(Response.json({linked:true}));
 await expect(f.signedInClient.models.browserContributionLink({workerId:"32cb4b44-cd2e-45d5-966e-b876f4c4dba0",token:"w".repeat(32),expectedUserId:f.actor.userId})).resolves.toEqual({linked:true});
 const [url,init]=f.transport.mock.calls[0] as unknown as [string,RequestInit];
 expect(url).toBe("https://www.mycellios.com/v1/browser/contributors");
 expect(new Headers(init.headers).get("authorization")).toBe("Bearer fixture-session-token");
 expect(JSON.parse(String(init.body))).toEqual({workerId:"32cb4b44-cd2e-45d5-966e-b876f4c4dba0",token:"w".repeat(32)});
});
it("rejects a browser payout link after the account changes and never uses a model key",async()=>{
 const f=fixture(true);
 await expect(f.signedInClient.models.browserContributionLink({workerId:"32cb4b44-cd2e-45d5-966e-b876f4c4dba0",token:"w".repeat(32),expectedUserId:"someone-else"})).rejects.toMatchObject({code:"FORBIDDEN"});
 expect(f.transport).not.toHaveBeenCalled();
 f.accountToken.mockResolvedValue(null);
 await expect(f.signedInClient.models.browserContributionLink({workerId:"32cb4b44-cd2e-45d5-966e-b876f4c4dba0",token:"w".repeat(32),expectedUserId:f.actor.userId})).rejects.toMatchObject({code:"UNAUTHORIZED"});
 expect(f.transport).not.toHaveBeenCalled();
});
it.each([[401,"UNAUTHORIZED"],[403,"FORBIDDEN"],[404,"PRECONDITION_FAILED"],[501,"PRECONDITION_FAILED"],[409,"CONFLICT"],[503,"SERVICE_UNAVAILABLE"]] as const)("preserves safe browser linking denial %s without exposing worker credentials",async(status,code)=>{
 const f=fixture(true);f.transport.mockResolvedValue(new Response("private worker proof fixture-session-token",{status}));
 await expect(f.signedInClient.models.browserContributionLink({workerId:"32cb4b44-cd2e-45d5-966e-b876f4c4dba0",token:"w".repeat(32),expectedUserId:f.actor.userId})).rejects.toMatchObject({code,message:"Could not link browser earnings to your Mycellios account."});
 expect(f.transport).toHaveBeenCalledOnce();
});
