import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "./client.js";
import { createDb } from "./client.js";
import {
  creditAccount,
  expireModelCredits,
  reconcileCreditPurchase,
  reserveModelCredits,
  settleModelCredits,
  settleModelCreditsTx,
} from "./model-credits.js";
import { asSystem, runAsTenant } from "./row-security.js";

const dbTests =
  process.env.VERIFY_DATABASE && process.env.DATABASE_URL ? describe.sequential : describe.skip;
dbTests("model credits ledger", () => {
  let organizationId: string;
  let db: ReturnType<typeof createDb>;
  let prisma: PrismaClient;
  beforeAll(async () => {
    db = createDb(process.env.DATABASE_URL!);
    prisma = db.prisma;
  });
  beforeEach(async () => {
    organizationId = `credits-test-${process.pid}-${crypto.randomUUID()}`;
    await prisma.organization.create({
      data: {
        id: organizationId,
        name: "Credit fixture",
        slug: organizationId,
        createdAt: new Date(),
      },
    });
    await creditAccount(prisma, organizationId);
    await prisma.modelCreditAccount.update({
      where: { organizationId },
      data: { mode: "credits" },
    });
  });
  afterEach(async () => {
    await prisma.organization.delete({ where: { id: organizationId } });
  });
  afterAll(async () => {
    await prisma.$disconnect();
    await db.pool.end();
  });
  const balance = async () => (await creditAccount(prisma, organizationId)).balanceMicros;
  it("grants a replayed paid invoice once, including concurrent delivery", async () => {
    await Promise.all(
      Array.from({ length: 4 }, () =>
        reconcileCreditPurchase(prisma, organizationId, {
          id: `${organizationId}-invoice`,
          amountCents: 1000,
        }),
      ),
    );
    expect(await balance()).toBe(10_000_000n);
  });
  it("reconciles refunds without allowing an older read to restore refunded credits", async () => {
    const id = `${organizationId}-refund`;
    await reconcileCreditPurchase(prisma, organizationId, { id, amountCents: 2000 });
    await reconcileCreditPurchase(prisma, organizationId, { id, amountCents: 500 });
    await reconcileCreditPurchase(prisma, organizationId, { id, amountCents: 2000 });
    expect(await balance()).toBe(5_000_000n);
  });
  it("does not persist a zero grant before a settled charge becomes visible", async () => {
    const id = `${organizationId}-settling`;
    await reconcileCreditPurchase(prisma, organizationId, { id, amountCents: 0 });
    await reconcileCreditPurchase(prisma, organizationId, { id, amountCents: 1000 });
    expect(await balance()).toBe(10_000_000n);
  });
  it("only one concurrent call can reserve the available balance", async () => {
    await reconcileCreditPurchase(prisma, organizationId, {
      id: `${organizationId}-concurrent`,
      amountCents: 1000,
    });
    const calls = await Promise.allSettled([
      reserveModelCredits(prisma, organizationId, 7),
      reserveModelCredits(prisma, organizationId, 7),
    ]);
    expect(calls.filter((call) => call.status === "fulfilled")).toHaveLength(1);
    expect(await balance()).toBe(3_000_000n);
  });
  it("settles actual cost once and releases the unused reservation", async () => {
    await reconcileCreditPurchase(prisma, organizationId, {
      id: `${organizationId}-settle`,
      amountCents: 1000,
    });
    const id = await reserveModelCredits(prisma, organizationId, 4);
    await Promise.all([
      settleModelCredits(prisma, id, 0.123456),
      settleModelCredits(prisma, id, 0.123456),
    ]);
    expect(await balance()).toBe(9_876_544n);
  });
  it("retains the reserved debit when a provider returns no usage", async () => {
    await reconcileCreditPurchase(prisma, organizationId, {
      id: `${organizationId}-unknown`,
      amountCents: 1000,
    });
    const id = await reserveModelCredits(prisma, organizationId, 2);
    await settleModelCredits(prisma, id, null);
    expect(await balance()).toBe(8_000_000n);
    expect(await prisma.modelCreditEntry.findUnique({ where: { id } })).toMatchObject({
      pending: true,
    });
    await settleModelCredits(prisma, id, 0.125);
    expect(await balance()).toBe(9_875_000n);
  });
  it("enforces the approved Desktop ceiling across concurrent calls and replaced leases", async () => {
    const userId = `${organizationId}-owner`;
    const spaceId = `${organizationId}-space`;
    const scope = { userId, spaceId };
    await prisma.user.create({ data: { id: userId, name: "Desktop fixture", email: `${userId}@example.test` } });
    try {
      await prisma.space.create({ data: { id: spaceId, name: "Desktop fixture", organizationId } });
      await prisma.member.create({ data: {
        id: `${organizationId}-member`, userId, organizationId, role: "owner", createdAt: new Date(),
      } });
      await asSystem(prisma, "Desktop fixture membership").spaceMember.create({ data: {
        id: `${organizationId}-space-member`, userId, spaceId, organizationId, role: "owner", createdAt: new Date(),
      } });
      await reconcileCreditPurchase(prisma, organizationId, { id: `${organizationId}-desktop`, amountCents: 1000 });
      await runAsTenant(scope, async () => {
        const computer = await prisma.computer.create({ data: {
          ...scope, kind: "desktop", scope: "dedicated", scopeKey: spaceId, homeKey: spaceId,
        } });
        const bot = await prisma.bot.create({ data: {
          ...scope, name: "Desktop fixture", color: "#10B981", computerId: computer.id,
          thread: { create: scope },
        }, include: { thread: true } });
        const runScope = { ...scope, botId: bot.id, threadId: bot.thread!.id };
        const task = await prisma.task.create({ data: { ...runScope, prompt: "Synthetic", status: "running" } });
        const run = await prisma.run.create({ data: {
          ...runScope, taskId: task.id, trigger: "user", status: "running", leaseOwner: "worker-a",
          leaseFence: 1, leaseExpiresAt: new Date(Date.now() + 60_000),
        } });
        const reserve = (id: string, worker = "worker-a", fence = 1) =>
          reserveModelCredits(prisma, organizationId, 0.004, {
            ...scope, runId: run.id, callId: `${run.id}-${id}`, desktopTool: { botId: bot.id, leaseOwner: worker, leaseFence: fence },
          });
        await expect(reserve("disabled")).rejects.toThrow("approval is disabled");
        const approve = (value: number) => prisma.user.update({
          where: { id: userId }, data: { micoDefaults: { desktopToolCreditLimitMicros: value } },
        });
        await approve(5000);
        await prisma.run.update({ where: { id: run.id }, data: { requestedByUserId: "shared-mico-member" } });
        await expect(reserve("member")).rejects.toThrow("no longer authorized");
        await prisma.run.update({ where: { id: run.id }, data: { requestedByUserId: null } });
        const attempts = await Promise.allSettled([reserve("one"), reserve("two")]);
        const accepted = attempts.flatMap(attempt => attempt.status === "fulfilled" ? [attempt.value] : []);
        expect(accepted).toHaveLength(1);
        const held = accepted[0]!;
        expect(await prisma.run.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({ desktopToolCreditLimitMicros: 5000 });
        await expect(reserve(held.slice(run.id.length + 1))).rejects.toThrow("already admitted");
        await settleModelCredits(prisma, held, null);
        await approve(10000);
        await prisma.run.update({ where: { id: run.id }, data: { leaseOwner: "worker-b", leaseFence: 2 } });
        await expect(reserve("stale")).rejects.toThrow("no longer authorized");
        await expect(reserve("new-worker", "worker-b", 2)).rejects.toThrow("approved run budget");
        await settleModelCredits(prisma, held, 0.001);
        await expect(reserve("settled", "worker-b", 2)).resolves.toBe(`${run.id}-settled`);
        await approve(0);
        await expect(reserve("revoked", "worker-b", 2)).rejects.toThrow("approval is disabled");
      });
    } finally {
      await prisma.user.delete({ where: { id: userId } });
    }
  });

  it("rejects unknown pricing and BYOK accounts before spending", async () => {
    await expect(reserveModelCredits(prisma, organizationId, Number.NaN)).rejects.toThrow(
      "reliable price",
    );
    await reconcileCreditPurchase(prisma, organizationId, {
      id: `${organizationId}-byok`,
      amountCents: 1000,
    });
    await prisma.modelCreditAccount.update({ where: { organizationId }, data: { mode: "byok" } });
    await expect(reserveModelCredits(prisma, organizationId, 1)).rejects.toThrow("credits");
    expect(await balance()).toBe(10_000_000n);
  });
  const beforeRenewal = new Date("2029-12-15T00:00:00Z");
  const renewal = new Date("2030-01-01T00:00:00Z");
  const nextRenewal = new Date("2030-02-01T00:00:00Z");
  const grant = (name: string, cents: number, expiresAt?: Date, now = beforeRenewal) =>
    reconcileCreditPurchase(
      prisma,
      organizationId,
      {
        id: `${organizationId}-${name}`,
        amountCents: cents,
        ...(expiresAt ? { expiresAt: expiresAt.toISOString() } : {}),
      },
      now,
    );
  const reserve = (amount: number, now = beforeRenewal) =>
    reserveModelCredits(prisma, organizationId, amount, undefined, now);
  it("spends subscription credits first and expires only their unused balance", async () => {
    await grant("topup", 2000);
    await grant("monthly", 1000, renewal);
    const call = await reserve(5);
    await settleModelCredits(prisma, call, 3, beforeRenewal);
    await expireModelCredits(prisma, organizationId, renewal);
    expect(await balance()).toBe(20_000_000n);
    const topup = await prisma.modelCreditLot.findFirstOrThrow({
      where: { organizationId, expiresAt: null },
    });
    expect(topup.availableMicros).toBe(20_000_000n);
  });
  it("renews without accumulating old monthly credits or refilling an expired invoice replay", async () => {
    await grant("monthly", 1000, renewal);
    await grant("topup", 2000);
    await expireModelCredits(prisma, organizationId, renewal);
    await grant("monthly", 1000, renewal, renewal);
    await grant("next", 2000, nextRenewal, renewal);
    expect(await balance()).toBe(40_000_000n);
    await expireModelCredits(prisma, organizationId, nextRenewal);
    expect(await balance()).toBe(20_000_000n);
  });
  it("expires prorated upgrades with their original billing period", async () => {
    await grant("monthly", 1000, renewal);
    await grant("upgrade", 500, renewal);
    await grant("topup", 2000);
    await expireModelCredits(prisma, organizationId, renewal);
    expect(await balance()).toBe(20_000_000n);
  });
  it("does not revive an expired hold or take the refund from the new month", async () => {
    await grant("monthly", 1000, renewal);
    await grant("topup", 2000);
    const call = await reserve(8);
    await expireModelCredits(prisma, organizationId, renewal);
    await grant("next", 1000, nextRenewal, renewal);
    await settleModelCredits(prisma, call, 3, renewal);
    expect(await balance()).toBe(30_000_000n);
    const next = await prisma.modelCreditLot.findFirstOrThrow({
      where: { organizationId, expiresAt: nextRenewal },
    });
    expect(next.availableMicros).toBe(10_000_000n);
  });
  it("returns top-up holds but expires the monthly part of a cross-period refund", async () => {
    await grant("monthly", 200, renewal);
    await grant("topup", 1000);
    const call = await reserve(5);
    await settleModelCredits(prisma, call, 1, renewal);
    expect(await balance()).toBe(10_000_000n);
  });
  it("offsets expired amounts when a monthly payment is refunded", async () => {
    await grant("monthly", 1000, renewal);
    const call = await reserve(3);
    await settleModelCredits(prisma, call, 2, beforeRenewal);
    await expireModelCredits(prisma, organizationId, renewal);
    await grant("monthly", 0, renewal, renewal);
    expect(await balance()).toBe(-2_000_000n);
    await grant("topup", 1000, undefined, renewal);
    expect(await balance()).toBe(8_000_000n);
    await expireModelCredits(prisma, organizationId, nextRenewal);
    expect(await balance()).toBe(8_000_000n);
  });
  it("does not mint credits when a refunded purchase had an outstanding reservation", async () => {
    await grant("topup", 1000);
    const call = await reserve(8);
    await grant("topup", 0);
    await settleModelCredits(prisma, call, 1, beforeRenewal);
    expect(await balance()).toBe(-1_000_000n);
    await grant("second", 1000);
    const total = await prisma.modelCreditLot.aggregate({
      where: { organizationId },
      _sum: { availableMicros: true },
    });
    expect(total._sum.availableMicros).toBe(9_000_000n);
  });
  it("cannot spend expired credits even when expiry and reservation race", async () => {
    await grant("monthly", 1000, renewal);
    const result = await Promise.allSettled([
      expireModelCredits(prisma, organizationId, renewal),
      reserve(1, renewal),
    ]);
    expect(result[1]?.status).toBe("rejected");
    expect(await balance()).toBe(0n);
  });
  it("expires a late-delivered subscription payment in the same transaction", async () => {
    await grant("late", 1000, renewal, nextRenewal);
    expect(await balance()).toBe(0n);
  });
  it("handles authoritative cost corrections after an overdraft and expiration", async () => {
    await grant("monthly", 1000, renewal);
    const call = await reserve(8);
    await settleModelCredits(prisma, call, 12, beforeRenewal);
    await prisma.$transaction((tx) => settleModelCreditsTx(tx, call, 0, true, renewal));
    expect(await balance()).toBe(0n);
    const total = await prisma.modelCreditLot.aggregate({
      where: { organizationId },
      _sum: { availableMicros: true },
    });
    expect(total._sum.availableMicros).toBe(0n);
  });
  async function oldReleaseReserve(amount: number) {
    const id = crypto.randomUUID();
    await prisma.$transaction(async (tx) => {
      await tx.modelCreditEntry.create({
        data: {
          id,
          callId: id,
          source: `call:${id}`,
          organizationId,
          amountMicros: -BigInt(amount * 1_000_000),
          pending: true,
          createdAt: beforeRenewal,
        },
      });
      await tx.modelCreditAccount.update({
        where: { organizationId },
        data: {
          balanceMicros: { decrement: BigInt(amount * 1_000_000) },
        },
      });
    });
    return id;
  }
  it("retains the expiry of reservations created by the previous release", async () => {
    await grant("monthly", 1000, renewal);
    await grant("topup", 1000);
    const call = await oldReleaseReserve(8);
    await expireModelCredits(prisma, organizationId, renewal);
    await settleModelCredits(prisma, call, 3, renewal);
    expect(await balance()).toBe(10_000_000n);
    const entry = await prisma.modelCreditEntry.findUniqueOrThrow({ where: { id: call } });
    expect(entry.fundedMicros).toBe(3_000_000n);
  });
  it("expires funds returned by the previous API after a hold was classified", async () => {
    await grant("monthly", 1000, renewal);
    const call = await oldReleaseReserve(8);
    await expireModelCredits(prisma, organizationId, renewal);
    await prisma.$transaction(async (tx) => {
      await tx.modelCreditEntry.update({
        where: { id: call },
        data: { pending: false, amountMicros: -3_000_000n },
      });
      await tx.modelCreditAccount.update({
        where: { organizationId },
        data: { balanceMicros: { increment: 5_000_000n } },
      });
    });
    await expireModelCredits(prisma, organizationId, renewal);
    expect(await balance()).toBe(0n);
    const entry = await prisma.modelCreditEntry.findUniqueOrThrow({ where: { id: call } });
    expect(entry.fundedMicros).toBe(3_000_000n);
    const journal = await asSystem(prisma).billingAuditEvent.aggregate({
      where: { organizationId },
      _sum: { amountMicros: true },
    });
    expect(journal._sum.amountMicros).toBe(0n);
  });
  it("rejects a replay that changes an invoice service period", async () => {
    await grant("monthly", 1000, renewal);
    await expect(grant("monthly", 1000, nextRenewal)).rejects.toThrow(
      "Credit service period changed",
    );
    expect(await balance()).toBe(10_000_000n);
  });
});
