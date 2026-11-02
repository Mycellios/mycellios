import { createRouterClient } from "@orpc/server";
import { serializeModelSecret } from "@rakazo/adapters";
import { afterEach, expect, it, vi } from "vitest";
import type { RouterDeps } from "./router.js";
import { createRouter } from "./router.js";

afterEach(() => vi.unstubAllEnvs());
it("refreshes an exact delayed receipt and stores it only on its owned usage row", async () => {
  vi.stubEnv("RAKAZO_OPENAI_COMPAT_ALLOW_PUBLIC", "1");
  let settled = false;
  const row = {
    id: "usage-fixture",
    provider: "antseed",
    model: "peer@model",
    userId: "owner",
    spaceId: "space",
    runId: "root",
    parentRunId: "root",
    callId: "call-pending",
    costUsd: null,
    costSource: null,
    usageSource: "provider-reported-via-pi",
    pricingSnapshot: { antseedCallId: "call-pending", antseedReceiptState: "pending" },
    inputTokens: 10,
    outputTokens: 5,
  };
  const update = vi.fn().mockResolvedValue({ count: 1 });
  const transport = vi.fn<typeof fetch>(async (url, init) => {
    const target = new URL(String(url));
    if (target.pathname.endsWith("/auth/api-key")) {
      expect(JSON.parse(String(init?.body))).toEqual({ key: "fixture-key-delayed" });
      return Response.json(
        {},
        { headers: { "set-cookie": "session=delayed-fixture; Path=/console" } },
      );
    }
    expect(target.searchParams.get("q")).toBe("call-pending");
    return Response.json({
      requests: [
        {
          tag: "gw-delayed",
          endUser: "call-pending",
          finishedAt: 1,
          spent: settled ? "0.001234" : null,
          costPending: !settled,
        },
      ],
    });
  });
  const deps = {
    env: { sandboxProvider: "fake" },
    modelConnectionFetch: transport,
    secrets: {
      load: vi.fn().mockResolvedValue(
        serializeModelSecret({
          kind: "openai_compatible",
          baseUrl: "https://reconcile.example.test/v1",
          apiKey: "fixture-key-delayed",
        }),
      ),
    },
    prisma: {
      run: { findMany: vi.fn().mockResolvedValue([{ id: "root", status: "completed" }]) },
      usageRecord: { findMany: vi.fn().mockResolvedValue([row]), updateMany: update },
      userModelPreference: { findMany: vi.fn().mockResolvedValue([]) },
      userModelCredential: {
        findMany: vi.fn().mockResolvedValue([
          { id: "credential", userId: "owner", provider: "antseed", label: "AntSeed", secretId: "secret" },
        ]),
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: "credential", provider: "antseed", secretId: "secret" }),
      },
      secret: { findFirst: vi.fn().mockResolvedValue({ ciphertext: "encrypted-fixture" }) },
      modelCreditEntry: { findFirst: vi.fn().mockResolvedValue(null) },
    },
  } as unknown as RouterDeps;
  const client = createRouterClient(createRouter(deps), {
    context: { actor: { userId: "owner", spaceId: "space", email: "owner@example.test" } } as never,
  });
  expect(await client.usage.tasks({ runIds: ["root"] })).toEqual([
    { runId: "root", state: "pending", amountUsd: null, modelCalls: 1, unpricedCalls: 1 },
  ]);
  expect(update).not.toHaveBeenCalled();
  settled = true;
  expect(await client.usage.tasks({ runIds: ["root"] })).toEqual([
    { runId: "root", state: "confirmed", amountUsd: 0.001234, modelCalls: 1, unpricedCalls: 0 },
  ]);
  expect(update).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { userId: "owner", spaceId: "space", id: "usage-fixture", costUsd: null },
      data: expect.objectContaining({ costUsd: 0.001234, costSource: "provider-reported" }),
    }),
  );
});
