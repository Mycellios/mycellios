import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "./client.js";
import { Prisma } from "./generated/prisma/client.js";
import { creditAccount, reserveModelCredits, SharedMicoAllowanceError } from "./model-credits.js";

describe("creditAccount", () => {
  const organizationId = "credit-race-fixture";
  const account = { organizationId, balanceMicros: 0n, mode: null };

  function fixture(error?: Error) {
    const upsert = error
      ? vi.fn().mockRejectedValueOnce(error)
      : vi.fn().mockResolvedValue(account);
    const findUniqueOrThrow = vi.fn().mockResolvedValue(account);
    const prisma = {
      modelCreditAccount: { upsert, findUniqueOrThrow },
    } as unknown as PrismaClient;
    return { prisma, upsert, findUniqueOrThrow };
  }

  it("returns the winning account after a concurrent first create conflicts", async () => {
    const conflict = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "test",
      meta: { modelName: "ModelCreditAccount", target: ["organizationId"] },
    });
    const { prisma, upsert, findUniqueOrThrow } = fixture(conflict);

    await expect(creditAccount(prisma, organizationId)).resolves.toBe(account);
    expect(upsert).toHaveBeenCalledOnce();
    expect(findUniqueOrThrow).toHaveBeenCalledExactlyOnceWith({ where: { organizationId } });
  });

  it("returns the account without another read when the upsert succeeds", async () => {
    const { prisma, findUniqueOrThrow } = fixture();

    await expect(creditAccount(prisma, organizationId)).resolves.toBe(account);
    expect(findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it.each([
    new Error("Connection failed"),
    new Prisma.PrismaClientKnownRequestError("Foreign key constraint failed", {
      code: "P2003",
      clientVersion: "test",
    }),
  ])("propagates other failures without reading an account: %s", async (error) => {
    const { prisma, findUniqueOrThrow } = fixture(error);

    await expect(creditAccount(prisma, organizationId)).rejects.toBe(error);
    expect(findUniqueOrThrow).not.toHaveBeenCalled();
  });
});

describe("a Space member's daily allowance on a shared Mico", () => {
  /** A transaction that holds the payer's account lock and reports what the member spent. */
  function fixture(spentMicros: bigint) {
    const queries: string[] = [];
    const updateMany = vi.fn();
    const tx = {
      $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
        const sql = strings.join("?");
        queries.push(sql);
        return sql.includes("SUM(-e.") ? [{ spent: spentMicros }] : [];
      }),
      modelCreditEntry: { findUnique: vi.fn(async () => null) },
      modelCreditAccount: { updateMany },
    };
    const prisma = {
      $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
    } as unknown as PrismaClient;
    return { prisma, queries, updateMany };
  }
  const attribution = { callId: "call-1", userId: "owner", spaceId: "space", runId: "run-1", requestedByUserId: "ben" };
  const allowance = (limitMicros: bigint) => ({ memberUserId: "ben", botId: "bot-1", limitMicros, since: new Date(0) });

  it("stops every call when the owner set the allowance to 0", async () => {
    const { prisma, updateMany } = fixture(0n);
    const refused = reserveModelCredits(prisma, "org", 0.01, attribution, new Date(), allowance(0n));
    await expect(refused).rejects.toBeInstanceOf(SharedMicoAllowanceError);
    await expect(refused).rejects.toThrow("paused");
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("refuses a hold that would go past what is left today, under the payer's account lock", async () => {
    const { prisma, queries, updateMany } = fixture(900_000n);
    const refused = reserveModelCredits(prisma, "org", 0.2, attribution, new Date(), allowance(1_000_000n));
    await expect(refused).rejects.toThrow("today's limit");
    expect(queries[0]).toContain("FOR UPDATE");
    expect(queries[1]).toContain("requestedByUserId");
    expect(updateMany).not.toHaveBeenCalled();
  });
});
