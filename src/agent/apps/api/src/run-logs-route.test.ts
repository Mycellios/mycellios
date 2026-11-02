import { createRouterClient } from "@orpc/server";
import type { Actor } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import { expect, it, vi } from "vitest";
import type { RouterDeps } from "./router.js";
import { createRouter } from "./router.js";

function fixture() {
  const findMany = vi.fn().mockResolvedValue([]);
  const prisma = { run: { findMany }, bot: { findMany } } as unknown as PrismaClient;
  const deps = {
    prisma,
    dataDir: "/tmp/run-logs-offline-fixture",
    env: {
      defaultProvider: "fake",
      defaultModel: "fake-model",
      webOrigin: "http://127.0.0.1:5173",
      sandboxProvider: "none",
    },
  } as unknown as RouterDeps;
  const actor: Actor = {
    userId: "owner",
    spaceId: "workspace",
    email: "owner@example.test",
    isDeploymentOwner: false,
  };
  const router = createRouter(deps);
  return { findMany, actor, router };
}
it("requires an authenticated actor before reading execution logs", async () => {
  const { router, findMany } = fixture();
  const client = createRouterClient(router, { context: { actor: null } });
  await expect(client.runs.logs({})).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  expect(findMany).not.toHaveBeenCalled();
});
it("returns scoped metadata through the actual RPC contract", async () => {
  const { router, findMany, actor } = fixture();
  const client = createRouterClient(router, { context: { actor } });
  await expect(client.runs.logs({})).resolves.toMatchObject({
    runs: [],
    agents: [],
    nextCursor: null,
  });
  expect(findMany).toHaveBeenCalledTimes(2);
  expect(findMany.mock.calls[0]?.[0].where).toMatchObject({
    userId: actor.userId,
    spaceId: actor.spaceId,
  });
});
it("rejects an oversized page before reading the database", async () => {
  const { router, findMany, actor } = fixture();
  const client = createRouterClient(router, { context: { actor } });
  await expect(client.runs.logs({ limit: 1000 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(findMany).not.toHaveBeenCalled();
});
