import { afterEach, describe, expect, it, vi } from "vitest";
import { createMycelliosProvider } from "./mycellios-provider.js";
import * as credentials from "./model-credentials.js";
import type { RouterDeps } from "./router.js";
import type { Actor } from "@rakazo/contracts";
import type { CodexLiveCatalog } from "@rakazo/adapters";
import { serializeModelSecret } from "@rakazo/adapters";
import { getModelRole } from "@rakazo/db";
import { mainRole, withModelRoles } from "../../../packages/adapters/src/testing/model-roles.js";

const actor = { userId: "fixture-user", spaceId: "fixture-space" } as Actor;
const key = "synthetic-native-key-long-enough";
function fixture(sso = true) {
  const rows = vi.fn().mockResolvedValue([]);
  const load = vi.fn().mockResolvedValue(serializeModelSecret({
    kind: "openai_compatible", baseUrl: "https://www.mycellios.com/v1", apiKey: key,
    headers: { "x-mycellios-funding": "contribution-credits" },
  }));
  const token = vi.fn().mockResolvedValue("synthetic-linked-session");
  const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    // Fail if account setup ever starts generation, checkout, or inference.
    if (url.endsWith("/api-keys") && init?.method === "POST")
      return Response.json({ id: "fixture-key", secret: key });
    if (url.endsWith("/api-keys/fixture-key") && init?.method === "DELETE")
      return new Response(null, { status: 204 });
    expect(init?.method ?? "GET").toBe("GET");
    if (url.endsWith("/account/economy")) return Response.json({
      object: "economic_account", asset: "MYC_MICROCREDITS", balanceMicrounits: 0,
      lifetimeMicrounits: 0, settledJobs: 0, contributionFundingSupported: true,
    });
    expect(url.endsWith("/models")).toBe(true);
    return Response.json({ data: [{ id: "fixture-credit-model" }] });
  });
  const persist = vi.spyOn(credentials, "persistModelCredential").mockResolvedValue({
    id: "fixture-connection", provider: "openai-compatible", label: "Mycellios", hasKey: true, isDefault: true,
  } as never);
  const deps = {
    prisma: { userModelCredential: { findMany: rows }, secret: { findFirst: vi.fn().mockResolvedValue({ ciphertext: "fixture" }) } },
    secrets: { load }, auth: { oidcAccessToken: token },
    env: { mycelliosSso: sso, defaultModel: "fixture-credit-model", defaultModelMaxTokens: 1024 },
    modelConnectionFetch: transport,
  } as unknown as RouterDeps;
  return { provider: createMycelliosProvider(deps, {} as CodexLiveCatalog), deps, rows, token, transport, persist };
}
afterEach(() => vi.restoreAllMocks());

describe("built-in Mycellios account provider", () => {
  it.each(["empty", "personal", "backups"] as const)("persists the system default only for an empty account (%s)", async selection => {
    const f = fixture(); f.persist.mockRestore();
    const db = f.deps.prisma;
    const personal = mainRole(actor, "personal-provider", "personal-model");
    const saved = selection === "empty" ? [] : [{ ...personal, position: selection === "backups" ? 1 : 0 }];
    db.$transaction = vi.fn(async (callback: (client: typeof db) => Promise<unknown>) => callback(db)) as never;
    db.secret.create = vi.fn(async ({ data }: { data: unknown }) => data) as never;
    db.userModelCredential.create = vi.fn(async ({ data }: { data: object }) => ({
      id: "fixture-connection", ...data, createdAt: new Date(0), updatedAt: new Date(0),
    })) as never;
    db.userModelPreference = { upsert: vi.fn().mockResolvedValue({}) } as never;
    f.deps.secrets.put = vi.fn().mockResolvedValue({ id: "new-secret", ciphertext: "synthetic-ciphertext" });
    withModelRoles(db, saved);
    const result = await f.provider.connect(actor, new Headers());
    const role = await getModelRole(db, { ...actor, scope: "account" }, "main");
    if (selection === "empty") {
      expect(role.primary).toMatchObject({ provider: "openai-compatible", modelId: "fixture-credit-model", credentialId: "fixture-connection" });
      expect(result.isDefault).toBe(true);
    } else if (selection === "personal") {
      expect(role.primary).toMatchObject({ provider: "personal-provider", modelId: "personal-model" });
      expect(result.isDefault).toBe(false);
    } else {
      expect(role.primary).toBeNull(); expect(role.backups).toMatchObject([{ provider: "personal-provider", modelId: "personal-model" }]);
    }
    expect(JSON.stringify(result)).not.toContain(key);
  });
  it("automatically configures the current linked account without inference or altering an explicit default", async () => {
    const f = fixture(); const headers = new Headers();
    await f.provider.ensure(actor, headers);
    expect(f.token).toHaveBeenCalledExactlyOnceWith(headers, actor.userId);
    expect(f.persist).toHaveBeenCalledWith(f.deps, actor, expect.objectContaining({
      provider: "openai-compatible", label: "Mycellios", modelId: "fixture-credit-model",
      scope: "account", keepExistingDefault: true,
    }), expect.anything());
    expect(JSON.parse(f.persist.mock.calls[0]![2].plaintext)).toMatchObject({
      apiKey: key, headers: { "x-mycellios-funding": "contribution-credits" }, maxTokens: 1024,
    });
    expect(f.transport).toHaveBeenCalledTimes(3);
  });
  it("reuses an owned funded connection without provisioning or renewing identity", async () => {
    const f = fixture();
    f.rows.mockResolvedValue([{ id: "fixture-connection", secretId: "fixture-secret" }]);
    await f.provider.ensure(actor, new Headers());
    expect(f.token).not.toHaveBeenCalled(); expect(f.transport).not.toHaveBeenCalled(); expect(f.persist).not.toHaveBeenCalled();
    expect(f.rows).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: actor.userId, provider: "openai-compatible" } }));
  });
  it("does not select an identity or create a key for an unlinked local account", async () => {
    const f = fixture(false);
    await f.provider.ensure(actor, new Headers());
    expect(f.rows).not.toHaveBeenCalled(); expect(f.token).not.toHaveBeenCalled(); expect(f.persist).not.toHaveBeenCalled();
  });
  it("coalesces concurrent account setup across different Spaces", async () => {
    const f = fixture();
    await Promise.all([f.provider.ensure(actor, new Headers()), f.provider.ensure({ ...actor, spaceId: "other-space" }, new Headers())]);
    expect(f.persist).toHaveBeenCalledOnce();
    expect(f.transport.mock.calls.filter(([url, init]) => String(url).endsWith("/api-keys") && init?.method === "POST")).toHaveLength(1);
  });
  it("keeps other providers accessible on an identity outage and permits an explicit retry", async () => {
    const f = fixture(); f.token.mockResolvedValueOnce(null);
    await expect(f.provider.ensure(actor, new Headers())).resolves.toBeUndefined();
    expect(f.persist).not.toHaveBeenCalled();
    await f.provider.connect(actor, new Headers()); expect(f.persist).toHaveBeenCalledOnce();
  });
  it("revokes a newly created unused key if encrypted persistence fails", async () => {
    const f = fixture(); f.persist.mockRejectedValueOnce(new Error("synthetic storage outage"));
    await expect(f.provider.connect(actor, new Headers())).rejects.toThrow("synthetic storage outage");
    expect(f.transport.mock.calls.some(([url, init]) => String(url).endsWith("/api-keys/fixture-key") && init?.method === "DELETE")).toBe(true);
  });
  it.each([
    { baseUrl: "https://provider.example.test/v1" },
    { apiKey: "different-account-key" },
    { headers: { "x-mycellios-funding": "another-wallet" } },
  ])("rejects replacing the pinned account connection through a generic save: %j", async patch => {
    const f = fixture();
    f.deps.prisma.userModelCredential.findFirst = vi.fn().mockResolvedValue({
      id: "fixture-connection", provider: "openai-compatible", secretId: "fixture-secret",
    });
    const connector = credentials.createModelConnector(f.deps, {} as CodexLiveCatalog);
    await expect(connector.verifyModelConnection(actor, {
      provider: "openai-compatible", credentialId: "fixture-connection", ...patch,
    }, undefined)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.transport).not.toHaveBeenCalled(); expect(f.persist).not.toHaveBeenCalled();
  });
});
