import { createRouterClient } from "@orpc/server";
import { TailnetService } from "@rakazo/adapters";
import type { PrismaClient } from "@rakazo/db";
import type * as Db from "@rakazo/db";
import { describe, expect, it, vi } from "vitest";
import { createRouter, type RouterDeps } from "./router.js";

vi.mock("@rakazo/db", async original => ({ ...await original<typeof Db>(), recordSecurityEvent: vi.fn(async () => {}) }));

function setup() {
  const actor = { spaceId: "space-a", userId: "user-a", email: "synthetic@example.invalid", isDeploymentOwner: false };
  const row = { id: "network-a", ...actor, name: "Office", kind: "personal", dnsSuffix: "tail123.ts.net",
    allowedBotIds: [], enabled: false, generation: 0 };
  const prisma = {
    spaceMember: { findFirst: vi.fn(async () => ({ role: "member" })) },
    tailnetConnection: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; userId: string; spaceId: string } }) =>
        where.id === row.id && where.userId === row.userId && where.spaceId === row.spaceId ? row : null),
      create: vi.fn(), update: vi.fn(), count: vi.fn(async () => 0),
    },
    tailnetPolicy: { findFirst: vi.fn(async () => null), upsert: vi.fn() },
    bot: { count: vi.fn(async () => 0) },
  };
  const fetch = vi.fn<typeof globalThis.fetch>();
  const deps = { prisma: prisma as unknown as PrismaClient,
    tailnets: new TailnetService(prisma as unknown as PrismaClient, { url: "http://gateway", key: "x".repeat(32), fetch }),
    env: { defaultProvider: "fake", defaultModel: "fake", screenProxySecret: "synthetic-secret", webOrigin: "http://127.0.0.1:5173", sandboxProvider: "none" },
    dataDir: "synthetic-data",
  } as unknown as RouterDeps;
  const router = createRouter(deps);
  return { actor, row, prisma, fetch, router, client: createRouterClient(router, { context: { actor } as never }) };
}
describe("Tailscale authenticated API", () => {
  it("requires a signed-in user", async () => {
    const f = setup();
    const anonymous = createRouterClient(f.router, { context: {} as never });
    await expect(anonymous.tailscale.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it("refuses company policy changes by ordinary members", async () => {
    const f = setup();
    await expect(f.client.tailscale.company({ dnsSuffix: "tail123.ts.net", enabled: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.prisma.tailnetPolicy.upsert).not.toHaveBeenCalled();
  });
  it("does not create grants for a foreign Mico", async () => {
    const f = setup();
    await expect(f.client.tailscale.create({ name: "Home", kind: "personal", dnsSuffix: "tail123.ts.net", allowedBotIds: ["foreign-mico"] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.prisma.tailnetConnection.create).not.toHaveBeenCalled();
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it("cannot connect someone else's network by guessing its id", async () => {
    const f = setup();
    const foreign = createRouterClient(f.router, { context: { actor: { ...f.actor, userId: "user-b" } } as never });
    await expect(foreign.tailscale.connect({ id: "network-a" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it("only changes grants on an owned network and owned Micos", async () => {
    const f = setup();
    await expect(f.client.tailscale.grant({ id: "network-a", allowedBotIds: ["foreign-mico"] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.prisma.tailnetConnection.update).not.toHaveBeenCalled();
    await expect(f.client.tailscale.grant({ id: "network-a", allowedBotIds: [] })).resolves.toEqual({ ok: true });
    expect(f.prisma.tailnetConnection.update).toHaveBeenCalledWith({ where: { id: "network-a" }, data: { allowedBotIds: [] } });
  });
  it("cannot bypass the company path with a personal connection", async () => {
    const f = setup(); f.prisma.tailnetPolicy.findFirst.mockResolvedValue({ enabled: false } as never);
    await expect(f.client.tailscale.create({ name: "Home", kind: "personal", dnsSuffix: "tail123.ts.net", allowedBotIds: [] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(f.prisma.tailnetConnection.create).not.toHaveBeenCalled();
  });
});
