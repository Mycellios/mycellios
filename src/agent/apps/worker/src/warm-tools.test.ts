import { describe, expect, it, vi } from "vitest";
import { WARM_TOOLS_MAX_MICOS, WARM_TOOLS_RECENT_MS, warmToolSessions } from "./warm-tools.js";

const NOW = Date.parse("2026-11-28T07:00:00Z");

function setup(
  micos: Array<{ botId: string; spaceId: string; userId: string }>,
  connections: Record<string, Array<Record<string, unknown>>> = {},
) {
  const groupBy = vi.fn(async (_args?: unknown) => micos);
  const findMany = vi.fn(async ({ where }: { where: { userId: string } }) => connections[where.userId] ?? []);
  const discoverTools = vi.fn(async () => []);
  return {
    groupBy,
    findMany,
    discoverTools,
    deps: {
      prisma: { run: { findMany: groupBy }, connection: { findMany } } as never,
      connector: { discoverTools },
    },
  };
}

describe("warming tool sessions after a restart", () => {
  it("discovers the tools of Micos that ran in the last day, as a turn would", async () => {
    const { deps, groupBy, discoverTools } = setup(
      [
        { botId: "b1", spaceId: "s1", userId: "u1" },
        { botId: "b2", spaceId: "s2", userId: "u2" },
      ],
      {
        u1: [
          { id: "c1", connectorId: "composio", provider: "gmail", providerRef: "ca_1", displayName: "Gmail", status: "connected" },
          { id: "c2", connectorId: "composio", provider: "slack", providerRef: "ca_2", displayName: "Slack", status: "revoked" },
        ],
      },
    );
    await expect(warmToolSessions(deps, { now: NOW })).resolves.toEqual({ warmed: 2, failed: 0 });
    expect(groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { createdAt: { gte: new Date(NOW - WARM_TOOLS_RECENT_MS) } },
        orderBy: { createdAt: "desc" },
        take: WARM_TOOLS_MAX_MICOS * 10,
      }),
    );
    expect(discoverTools).toHaveBeenCalledTimes(2);
    const first = (discoverTools.mock.calls as unknown as Array<[Record<string, unknown>]>)[0]![0];
    expect(first).toMatchObject({ spaceId: "s1", userId: "u1", botId: "b1" });
    // Only the live connection is handed over, like a turn's own context.
    expect(first.connectedProviders).toEqual(["gmail"]);
    expect(first.connectedConnections).toEqual([
      expect.objectContaining({ id: "c1", connectorId: "composio", externalId: "gmail", providerRef: "ca_1" }),
    ]);
  });

  it("opens each recent Mico once and no more than the limit", async () => {
    const runs = [
      ...Array.from({ length: 5 }, () => ({ botId: "busy", spaceId: "s", userId: "u" })),
      ...Array.from({ length: WARM_TOOLS_MAX_MICOS + 10 }, (_, i) => ({ botId: `b${i}`, spaceId: "s", userId: "u" })),
    ];
    const { deps, discoverTools } = setup(runs);
    await warmToolSessions(deps, { now: NOW });
    expect(discoverTools).toHaveBeenCalledTimes(WARM_TOOLS_MAX_MICOS);
    const bots = (discoverTools.mock.calls as unknown as Array<[{ botId: string }]>).map(([context]) => context.botId);
    expect(new Set(bots).size).toBe(WARM_TOOLS_MAX_MICOS);
    expect(bots[0]).toBe("busy");
  });

  it("goes on after a Mico whose tools cannot be discovered", async () => {
    const { deps, discoverTools } = setup([
      { botId: "b1", spaceId: "s1", userId: "u1" },
      { botId: "b2", spaceId: "s1", userId: "u1" },
      { botId: "b3", spaceId: "s1", userId: "u1" },
    ]);
    discoverTools.mockRejectedValueOnce(new Error("server down"));
    await expect(warmToolSessions(deps, { now: NOW })).resolves.toEqual({ warmed: 2, failed: 1 });
    expect(discoverTools).toHaveBeenCalledTimes(3);
  });

  it("opens only a few Micos at a time", async () => {
    const micos = Array.from({ length: 8 }, (_, i) => ({ botId: `b${i}`, spaceId: "s", userId: "u" }));
    const { deps, discoverTools } = setup(micos);
    let running = 0;
    let peak = 0;
    discoverTools.mockImplementation(async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
      return [];
    });
    await warmToolSessions(deps, { now: NOW });
    expect(discoverTools).toHaveBeenCalledTimes(8);
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("leaves everything to the first turn when the recent Micos cannot be read", async () => {
    const { deps, groupBy, discoverTools } = setup([]);
    groupBy.mockRejectedValueOnce(new Error("database busy"));
    await expect(warmToolSessions(deps, { now: NOW })).resolves.toEqual({ warmed: 0, failed: 0 });
    expect(discoverTools).not.toHaveBeenCalled();
  });

  it("stops once the worker is shutting down", async () => {
    const { deps, discoverTools } = setup([{ botId: "b1", spaceId: "s", userId: "u" }]);
    const shutdown = new AbortController();
    shutdown.abort();
    await expect(warmToolSessions(deps, { now: NOW, signal: shutdown.signal })).resolves.toEqual({
      warmed: 0,
      failed: 0,
    });
    expect(discoverTools).not.toHaveBeenCalled();
  });
});
