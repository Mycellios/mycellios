import { IsolationError } from "@mycellios/db";
import { describe, expect, it, vi } from "vitest";
import { createMemoryGrants } from "./memory-grants.js";

const actor = { userId: "user-1", spaceId: "space-1", email: "a@b.com", isDeploymentOwner: false };
const at = new Date("2026-11-23T10:00:00.000Z");

function setup(options: { connection?: boolean; ownedBots?: string[] } = {}) {
  const stored = new Map<string, { botId: string; autoRecall: boolean }>();
  const tx = {
    memoryConnection: {
      findFirst: vi.fn(async () => (options.connection === false ? null : { id: "conn-1" })),
    },
    bot: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in
          .filter((id) => (options.ownedBots ?? ["bot-1", "bot-2"]).includes(id))
          .map((id) => ({ id })),
      ),
    },
    micoMemoryGrant: {
      deleteMany: vi.fn(async ({ where }: { where: { botId: { notIn: string[] } } }) => {
        for (const botId of [...stored.keys()]) {
          if (!where.botId.notIn.includes(botId)) stored.delete(botId);
        }
      }),
      upsert: vi.fn(async ({ create }: { create: { botId: string; autoRecall: boolean } }) => {
        stored.set(create.botId, { botId: create.botId, autoRecall: create.autoRecall });
      }),
      findMany: vi.fn(async () =>
        [...stored.values()].map((row) => ({
          id: `grant-${row.botId}`,
          connectionId: "conn-1",
          createdAt: at,
          updatedAt: at,
          ...row,
        })),
      ),
    },
  };
  const prisma = {
    ...tx,
    $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  return { grants: createMemoryGrants({ prisma: prisma as never }), tx, stored };
}

describe("memory grants", () => {
  it("grants read access to the chosen Micos and removes the others", async () => {
    const { grants, stored } = setup();
    await grants.set(actor, {
      connectionId: "conn-1",
      grants: [
        { botId: "bot-1", autoRecall: true },
        { botId: "bot-2", autoRecall: false },
      ],
    });
    const saved = await grants.set(actor, {
      connectionId: "conn-1",
      grants: [{ botId: "bot-2", autoRecall: false }],
    });
    expect(saved).toEqual([
      expect.objectContaining({ botId: "bot-2", access: "read", autoRecall: false }),
    ]);
    expect([...stored.keys()]).toEqual(["bot-2"]);
  });

  it("refuses a connection the person does not own", async () => {
    const { grants, tx } = setup({ connection: false });
    await expect(
      grants.set(actor, { connectionId: "conn-1", grants: [{ botId: "bot-1", autoRecall: true }] }),
    ).rejects.toBeInstanceOf(IsolationError);
    expect(tx.micoMemoryGrant.upsert).not.toHaveBeenCalled();
  });

  it("refuses a Mico the person does not own, without changing anything", async () => {
    const { grants, tx } = setup({ ownedBots: ["bot-1"] });
    await expect(
      grants.set(actor, {
        connectionId: "conn-1",
        grants: [
          { botId: "bot-1", autoRecall: true },
          { botId: "someone-elses", autoRecall: true },
        ],
      }),
    ).rejects.toBeInstanceOf(IsolationError);
    expect(tx.micoMemoryGrant.deleteMany).not.toHaveBeenCalled();
    expect(tx.micoMemoryGrant.upsert).not.toHaveBeenCalled();
  });

  it("scopes every query to the acting person and Space", async () => {
    const { grants, tx } = setup();
    await grants.set(actor, { connectionId: "conn-1", grants: [] });
    expect(tx.memoryConnection.findFirst).toHaveBeenCalledWith({
      where: { id: "conn-1", spaceId: "space-1", userId: "user-1" },
      select: { id: true },
    });
    expect(tx.micoMemoryGrant.deleteMany).toHaveBeenCalledWith({
      where: { connectionId: "conn-1", spaceId: "space-1", userId: "user-1", botId: { notIn: [] } },
    });
  });
});
