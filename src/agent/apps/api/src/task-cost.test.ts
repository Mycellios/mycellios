import { createRouterClient } from "@orpc/server";
import type { Actor } from "@rakazo/contracts";
import { describe, expect, it, vi } from "vitest";
import type { RouterDeps } from "./router.js";
import { createRouter } from "./router.js";

const actor: Actor = { userId: "owner", spaceId: "space", email: "owner@example.test" };
function fixture() {
  const records = [
    {
      id: "a",
      userId: "owner",
      spaceId: "space",
      runId: "root",
      parentRunId: "root",
      provider: "fixture",
      costUsd: 0.1,
      costSource: "provider-reported",
      usageSource: "provider-reported",
      pricingSnapshot: null,
    },
    {
      id: "b",
      userId: "owner",
      spaceId: "space",
      runId: "child",
      parentRunId: "root",
      provider: "fixture",
      costUsd: 0.2,
      costSource: "provider-reported",
      usageSource: "provider-reported",
      pricingSnapshot: null,
    },
    {
      id: "c",
      userId: "owner",
      spaceId: "space",
      runId: "root",
      parentRunId: "root",
      provider: "fixture",
      costUsd: 0.3,
      costSource: "provider-reported",
      usageSource: "provider-reported",
      pricingSnapshot: null,
    },
  ];
  const run = vi.fn(async ({ where }) =>
    where.userId === actor.userId && where.spaceId === actor.spaceId && where.id.in.includes("root")
      ? [{ id: "root", status: "completed" }]
      : [],
  );
  const usage = vi.fn(async ({ where }) =>
    records.filter(
      (r) =>
        r.userId === where.userId &&
        r.spaceId === where.spaceId &&
        (where.OR[0].runId.in.includes(r.runId) ||
          where.OR[1].parentRunId.in.includes(r.parentRunId)),
    ),
  );
  const router = createRouter({
    prisma: { run: { findMany: run }, usageRecord: { findMany: usage } },
    env: { sandboxProvider: "fake" },
  } as unknown as RouterDeps);
  return {
    run,
    usage,
    router,
    client: createRouterClient(router, { context: { actor } as never }),
  };
}
describe("task cost RPC boundaries", () => {
  it("returns one total including intermediate and child calls", async () => {
    const f = fixture();
    expect(await f.client.usage.tasks({ runIds: ["root", "root"] })).toEqual([
      { runId: "root", state: "confirmed", amountUsd: 0.6, modelCalls: 3, unpricedCalls: 0 },
    ]);
    expect(f.run).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "owner", spaceId: "space", id: { in: ["root"] } },
      }),
    );
    for (const [query] of f.usage.mock.calls)
      expect(query.where).toMatchObject({ userId: "owner", spaceId: "space" });
  });
  it("does not query usage for a run outside the current account", async () => {
    const f = fixture();
    expect(await f.client.usage.tasks({ runIds: ["foreign"] })).toEqual([]);
    expect(f.usage).not.toHaveBeenCalled();
  });
  it("requires authentication and limits batch size", async () => {
    const f = fixture();
    const anon = createRouterClient(f.router, { context: {} as never });
    await expect(anon.usage.tasks({ runIds: ["root"] })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(
      f.client.usage.tasks({ runIds: Array.from({ length: 101 }, (_, i) => "run" + i) }),
    ).rejects.toThrow();
  });
});
