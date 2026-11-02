import { createRouterClient } from "@orpc/server";
import { serializeModelSecret } from "@rakazo/adapters";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RouterDeps } from "./router.js";
import { createRouter } from "./router.js";

afterEach(() => vi.unstubAllEnvs());

function fixture() {
  vi.stubEnv("RAKAZO_OPENAI_COMPAT_ALLOW_PUBLIC", "1");
  const gateway = "https://gateway.example.test/v1";
  const credentials = ["openai-compatible", "antseed"].map((provider) => ({
    id: provider,
    userId: "fixture-user",
    provider,
    secretId: `${provider}-secret`,
  }));
  const findMany = vi.fn(async ({ where }: { where: { userId: string; provider: string } }) =>
    credentials.filter((c) => c.userId === where.userId && c.provider === where.provider),
  );
  const transport = vi.fn<typeof fetch>(async (_url, init) =>
    new Headers(init?.headers).get("authorization") === "Bearer antseed_fixture_key"
      ? Response.json({ data: [{ id: "peer-fixture@text-model" }] })
      : new Response("Rejected", { status: 401 }),
  );
  const load = vi.fn(async (_ciphertext: string, secretId: string) =>
    serializeModelSecret({
      kind: "openai_compatible",
      baseUrl: gateway,
      apiKey: secretId === "antseed-secret" ? "antseed_fixture_key" : "mycellios_fixture_key",
    }),
  );
  const deps = {
    prisma: {
      userModelPreference: { findMany: vi.fn().mockResolvedValue([]) },
      spaceModelPreference: { findFirst: vi.fn().mockResolvedValue(null) },
      userModelCredential: { findFirst: vi.fn().mockResolvedValue(null), findMany },
      secret: {
        findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
          where.id.in.map((id) => ({ id, ciphertext: "encrypted-fixture" })),
        ),
      },
    },
    secrets: { load },
    modelConnectionFetch: transport,
    env: { sandboxProvider: "fake" },
  } as unknown as RouterDeps;
  const client = createRouterClient(createRouter(deps), {
    context: {
      actor: { userId: "fixture-user", spaceId: "fixture-space", email: "user@example.test" },
    } as never,
  });
  return { gateway, client, findMany, load, transport };
}

describe("AntSeed gateway RPC", () => {
  it("uses only the authenticated user's AntSeed key, even at the same gateway URL", async () => {
    const f = fixture();
    await expect(
      f.client.models.probeOpenAiCompatible({ provider: "antseed", baseUrl: f.gateway }),
    ).resolves.toEqual({ models: ["peer-fixture@text-model"] });
    expect(f.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "fixture-user", provider: "antseed" } }),
    );
    expect(f.load).toHaveBeenCalledOnce();
    expect(f.load).toHaveBeenCalledWith("encrypted-fixture", "antseed-secret");
  });
  it("does not forward a saved key to a different gateway", async () => {
    const f = fixture();
    await expect(
      f.client.models.probeOpenAiCompatible({
        provider: "antseed",
        baseUrl: "https://different.example.test/v1",
      }),
    ).rejects.toThrow("AntSeed gateway API key");
    expect(f.transport).not.toHaveBeenCalled();
  });
  it("rejects an invalid replacement key", async () => {
    const f = fixture();
    await expect(
      f.client.models.probeOpenAiCompatible({
        provider: "antseed",
        baseUrl: f.gateway,
        apiKey: "invalid",
        headers: {},
      }),
    ).rejects.toThrow();
    expect(f.load).not.toHaveBeenCalled();
  });
});
