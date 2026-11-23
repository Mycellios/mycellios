import type { MemoryCapabilities, MemoryGrantsSetInput } from "@mycellios/contracts";
import { IsolationError } from "@mycellios/db";
import { describe, expect, it, vi } from "vitest";
import { createMemoryGrants } from "./memory-grants.js";

const actor = { userId: "user-1", spaceId: "space-1", email: "a@b.com", isDeploymentOwner: false };
const at = new Date("2026-11-23T10:00:00.000Z");
const READ_ONLY: MemoryCapabilities = {
  read: true,
  write: false,
  forget: false,
  projects: false,
  status: false,
};
const WRITABLE: MemoryCapabilities = { ...READ_ONLY, write: true, forget: true };

type Grant = MemoryGrantsSetInput["grants"][number];
const read = (botId: string, autoRecall = true): Grant => ({
  botId,
  autoRecall,
  access: "read",
  allowForget: false,
});
const write = (botId: string, allowForget = false): Grant => ({
  botId,
  autoRecall: true,
  access: "read_write",
  allowForget,
});

type StoredGrant = { botId: string; autoRecall: boolean; access: string; allowForget: boolean };

function setup(
  options: {
    connection?: boolean;
    ownedBots?: string[];
    capabilities?: MemoryCapabilities;
    writerElsewhere?: boolean;
  } = {},
) {
  const stored = new Map<string, StoredGrant>();
  const tx = {
    memoryConnection: {
      findFirst: vi.fn(async () =>
        options.connection === false
          ? null
          : { id: "conn-1", capabilities: options.capabilities ?? READ_ONLY },
      ),
    },
    bot: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in
          .filter((id) => (options.ownedBots ?? ["bot-1", "bot-2"]).includes(id))
          .map((id) => ({ id })),
      ),
    },
    micoMemoryGrant: {
      findFirst: vi.fn(async () => (options.writerElsewhere ? { id: "grant-other" } : null)),
      deleteMany: vi.fn(async ({ where }: { where: { botId: { notIn: string[] } } }) => {
        for (const botId of [...stored.keys()]) {
          if (!where.botId.notIn.includes(botId)) stored.delete(botId);
        }
      }),
      upsert: vi.fn(async ({ create }: { create: StoredGrant }) => {
        stored.set(create.botId, {
          botId: create.botId,
          autoRecall: create.autoRecall,
          access: create.access,
          allowForget: create.allowForget,
        });
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
      grants: [read("bot-1"), read("bot-2", false)],
    });
    const saved = await grants.set(actor, {
      connectionId: "conn-1",
      grants: [read("bot-2", false)],
    });
    expect(saved).toEqual([
      expect.objectContaining({
        botId: "bot-2",
        access: "read",
        allowForget: false,
        autoRecall: false,
      }),
    ]);
    expect([...stored.keys()]).toEqual(["bot-2"]);
  });

  it("grants writing and forgetting when the memory supports them", async () => {
    const { grants } = setup({ capabilities: WRITABLE });
    const saved = await grants.set(actor, {
      connectionId: "conn-1",
      grants: [write("bot-1", true), read("bot-2")],
    });
    expect(saved).toEqual([
      expect.objectContaining({ botId: "bot-1", access: "read_write", allowForget: true }),
      expect.objectContaining({ botId: "bot-2", access: "read", allowForget: false }),
    ]);
  });

  it("refuses writing to a read-only memory", async () => {
    const { grants, tx } = setup();
    await expect(
      grants.set(actor, { connectionId: "conn-1", grants: [write("bot-1")] }),
    ).rejects.toThrow("does not accept writes");
    expect(tx.micoMemoryGrant.upsert).not.toHaveBeenCalled();
  });

  it("refuses forgetting when the memory cannot forget", async () => {
    const { grants, tx } = setup({ capabilities: { ...WRITABLE, forget: false } });
    await expect(
      grants.set(actor, { connectionId: "conn-1", grants: [write("bot-1", true)] }),
    ).rejects.toThrow("cannot forget");
    expect(tx.micoMemoryGrant.upsert).not.toHaveBeenCalled();
  });

  it("refuses a second memory a Mico would save to", async () => {
    const { grants, tx } = setup({ capabilities: WRITABLE, writerElsewhere: true });
    await expect(
      grants.set(actor, { connectionId: "conn-1", grants: [write("bot-1")] }),
    ).rejects.toThrow("only one memory");
    expect(tx.micoMemoryGrant.findFirst).toHaveBeenCalledWith({
      where: {
        spaceId: "space-1",
        userId: "user-1",
        botId: { in: ["bot-1"] },
        connectionId: { not: "conn-1" },
        access: "read_write",
      },
      select: { id: true },
    });
    expect(tx.micoMemoryGrant.upsert).not.toHaveBeenCalled();
  });

  it("refuses a connection the person does not own", async () => {
    const { grants, tx } = setup({ connection: false });
    await expect(
      grants.set(actor, { connectionId: "conn-1", grants: [read("bot-1")] }),
    ).rejects.toBeInstanceOf(IsolationError);
    expect(tx.micoMemoryGrant.upsert).not.toHaveBeenCalled();
  });

  it("refuses a Mico the person does not own, without changing anything", async () => {
    const { grants, tx } = setup({ ownedBots: ["bot-1"] });
    await expect(
      grants.set(actor, { connectionId: "conn-1", grants: [read("bot-1"), read("someone-elses")] }),
    ).rejects.toBeInstanceOf(IsolationError);
    expect(tx.micoMemoryGrant.deleteMany).not.toHaveBeenCalled();
    expect(tx.micoMemoryGrant.upsert).not.toHaveBeenCalled();
  });

  it("scopes every query to the acting person and Space", async () => {
    const { grants, tx } = setup();
    await grants.set(actor, { connectionId: "conn-1", grants: [] });
    expect(tx.memoryConnection.findFirst).toHaveBeenCalledWith({
      where: { id: "conn-1", spaceId: "space-1", userId: "user-1" },
      select: { id: true, capabilities: true },
    });
    expect(tx.micoMemoryGrant.deleteMany).toHaveBeenCalledWith({
      where: { connectionId: "conn-1", spaceId: "space-1", userId: "user-1", botId: { notIn: [] } },
    });
  });
});
