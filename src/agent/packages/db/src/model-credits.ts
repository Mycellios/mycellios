import { randomUUID } from "node:crypto";
import {
  CREDIT_MICROUNITS,
  readMicoDefaults,
  SHARED_MICO_ALLOWANCE_ERROR,
  SHARED_MICO_PAUSED_ERROR,
  usdCentsToCreditMicrounits,
} from "@mycellios/contracts";
import type { AgentUsage, BillingCreditPurchase } from "@mycellios/adapter-kit";
import type { PrismaClient } from "./client.js";
import { Prisma } from "./generated/prisma/client.js";
import type { CreditAllocation } from "./model-credit-lots.js";
import {
  allocateCreditLots,
  allocatedMicros,
  expireCreditLots,
  prepareCreditLots,
  resizeCreditLot,
  returnCreditLots,
  syncLotBalance,
} from "./model-credit-lots.js";

// Compatibility export for existing model-cost callers. One USD buys one Credit.
export const MICROS_PER_DOLLAR = CREDIT_MICROUNITS;

export async function creditAccount(prisma: PrismaClient, organizationId: string) {
  try {
    return await prisma.modelCreditAccount.upsert({
      where: { organizationId },
      create: { organizationId },
      update: {},
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"))
      throw error;
    // Empty-update upserts can race; the organization primary key is the only unique constraint.
    return prisma.modelCreditAccount.findUniqueOrThrow({ where: { organizationId } });
  }
}

/** Payment replay and refunds reconcile one durable grant; refunds can never be re-credited. */
export async function reconcileCreditPurchase(
  prisma: PrismaClient,
  organizationId: string,
  purchase: BillingCreditPurchase,
  now = new Date(),
) {
  if (!Number.isSafeInteger(purchase.amountCents) || purchase.amountCents < 0)
    throw new Error("Invalid credit purchase");
  await creditAccount(prisma, organizationId);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "organizationId" FROM model_credit_accounts WHERE "organizationId" = ${organizationId} FOR UPDATE`;
    await prepareCreditLots(tx, organizationId, now);
    await expireCreditLots(tx, organizationId, now);
    const source = `purchase:${purchase.id}`;
    const existing = await tx.modelCreditEntry.findUnique({ where: { source } });
    if (existing && existing.organizationId !== organizationId)
      throw new Error("Credit purchase belongs to another account");
    if (!existing && purchase.amountCents === 0) return 0;
    const paid = usdCentsToCreditMicrounits(purchase.amountCents);
    const amountMicros = existing && existing.amountMicros < paid ? existing.amountMicros : paid;
    const delta = amountMicros - (existing?.amountMicros ?? 0n);
    const expiresAt = purchase.expiresAt === undefined ? undefined : new Date(purchase.expiresAt);
    if (expiresAt && !Number.isFinite(expiresAt.getTime()))
      throw new Error("Invalid credit expiration");
    const previousLot = existing
      ? await tx.modelCreditLot.findUnique({ where: { id: existing.id } })
      : null;
    if (
      existing &&
      delta === 0n &&
      previousLot &&
      (!expiresAt || previousLot.expiresAt?.getTime() === expiresAt.getTime())
    )
      return 0;
    const entry = await tx.modelCreditEntry.upsert({
      where: { source },
      create: { source, organizationId, amountMicros },
      update: { amountMicros },
    });
    if (delta !== 0n)
      await tx.modelCreditAccount.update({
        where: { organizationId },
        data: { balanceMicros: { increment: delta } },
      });
    await tx.modelCreditLot.upsert({
      where: { id: entry.id },
      create: {
        id: entry.id,
        organizationId,
        amountMicros,
        availableMicros: amountMicros,
        expiresAt,
      },
      update: {},
    });
    await resizeCreditLot(tx, entry.id, amountMicros, expiresAt);
    await syncLotBalance(tx, organizationId);
    await expireCreditLots(tx, organizationId, now);
    return Number(delta);
  });
}

type ModelCreditAttribution = {
  callId?: string;
  userId?: string;
  spaceId?: string;
  runId?: string;
  provider?: string;
  model?: string;
  requestedByUserId?: string;
  desktopTool?: { botId: string; leaseOwner: string; leaseFence: number };
};

async function checkDesktopToolCredits(
  tx: Prisma.TransactionClient,
  organizationId: string,
  attribution: ModelCreditAttribution,
  amountMicros: bigint,
  now: Date,
) {
  const { runId, userId, spaceId, desktopTool } = attribution;
  if (!runId || !userId || !spaceId || !desktopTool || !attribution.callId) {
    throw new Error("Invalid Desktop model credit scope");
  }
  // The wallet lock is held by the caller. A worker replacement, stop or
  // purpose change cannot authorize a second reservation against this grant.
  await tx.$queryRaw`SELECT id FROM runs WHERE id = ${runId} FOR UPDATE`;
  const run = await tx.run.findFirst({
    where: {
      id: runId, userId, spaceId, status: "running", trigger: "user", requestedByUserId: null,
      botId: desktopTool.botId, leaseOwner: desktopTool.leaseOwner, leaseFence: desktopTool.leaseFence,
      leaseExpiresAt: { gt: now }, cloudComputerId: null,
      thread: { userId, spaceId, groupId: null, externalConversationId: null, archivedAt: null, memberUserId: null },
      bot: { userId, spaceId, archivedAt: null, computer: { kind: "desktop", scope: "dedicated", userId, spaceId } },
      space: { organizationId, deletingAt: null, memberships: { some: { userId } } },
    },
    select: { desktopToolCreditLimitMicros: true },
  });
  if (!run) throw new Error("Desktop model run is no longer authorized");
  const member = await tx.member.findUnique({
    where: { organizationId_userId: { organizationId, userId } }, select: { role: true },
  });
  if (!member?.role.split(",").some(role => role.trim() === "owner")) {
    throw new Error("Only the billing account owner can approve Desktop model credits");
  }
  const user = await tx.user.findUnique({ where: { id: userId }, select: { micoDefaults: true } });
  const approved = readMicoDefaults(user?.micoDefaults).desktopToolCreditLimitMicros ?? 0;
  if (!approved) throw new Error("Desktop model credit approval is disabled");
  const limit = Math.min(approved, run.desktopToolCreditLimitMicros ?? approved);
  const used = await tx.modelCreditEntry.aggregate({
    where: { organizationId, runId, userId, spaceId, desktopTool: true },
    _sum: { amountMicros: true },
  });
  if (amountMicros - (used._sum.amountMicros ?? 0n) > BigInt(limit)) {
    throw new Error("Desktop tool model call exceeds the approved run budget");
  }
  if (run.desktopToolCreditLimitMicros === null) {
    await tx.run.update({ where: { id: runId }, data: { desktopToolCreditLimitMicros: approved } });
  }
}

/** A Space member's turns on a shared Mico went past what its owner allows them per UTC day. */
export class SharedMicoAllowanceError extends Error {
  constructor(readonly paused: boolean) {
    super(paused ? SHARED_MICO_PAUSED_ERROR : SHARED_MICO_ALLOWANCE_ERROR);
    this.name = "SharedMicoAllowanceError";
  }
}

/** What one member may hold or spend on one shared Mico since the start of the UTC day. */
export interface MemberAllowance {
  memberUserId: string;
  botId: string;
  limitMicros: bigint;
  since: Date;
}

/**
 * Credit microunits a member's turns on one Mico have held or spent since `since`: pending holds
 * at their reserved amount, settled ones at their cost. Holds are attributed through their run.
 */
export async function memberSpentMicros(
  db: Pick<PrismaClient, "$queryRaw">,
  input: { memberUserId: string; botId: string; since: Date },
): Promise<bigint> {
  const [row] = await db.$queryRaw<Array<{ spent: bigint | number | null }>>`
    SELECT COALESCE(SUM(-e."amountMicros"), 0)::bigint AS spent
    FROM model_credit_entries e
    JOIN runs r ON r.id = e."runId"
    WHERE e."requestedByUserId" = ${input.memberUserId}
      AND e."createdAt" >= ${input.since}
      AND e."amountMicros" < 0
      AND r."botId" = ${input.botId}`;
  return BigInt(row?.spent ?? 0);
}

/**
 * Atomic debit prevents concurrent calls from reserving the same available funds. A member's
 * call also has to fit what is left of their daily allowance; the account lock serializes that
 * check with every other hold of the payer.
 */
export async function reserveModelCredits(
  prisma: PrismaClient,
  organizationId: string,
  maxCostUsd: number,
  attribution?: ModelCreditAttribution,
  now = new Date(),
  allowance?: MemberAllowance,
) {
  if (!Number.isFinite(maxCostUsd) || maxCostUsd <= 0 || maxCostUsd > 10_000)
    throw new Error("This model has no reliable price. Connect your own API key to use it.");
  const amountMicros = BigInt(Math.ceil(maxCostUsd * MICROS_PER_DOLLAR));
  const callId = attribution?.callId ?? randomUUID();
  const source = "call:" + callId;
  const { desktopTool, ...entryAttribution } = attribution ?? {};
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "organizationId" FROM model_credit_accounts WHERE "organizationId"=${organizationId} FOR UPDATE`;
    const existing = await tx.modelCreditEntry.findUnique({ where: { callId } });
    if (existing) {
      if (existing.organizationId !== organizationId)
        throw new Error("Model call belongs to another account");
      if (desktopTool || existing.desktopTool) throw new Error("Desktop tool model call already admitted");
      return existing.id;
    }
    if (desktopTool && attribution) await checkDesktopToolCredits(tx, organizationId, attribution, amountMicros, now);
    if (allowance) {
      if (allowance.limitMicros <= 0n) throw new SharedMicoAllowanceError(true);
      const spent = await memberSpentMicros(tx, allowance);
      if (spent + amountMicros > allowance.limitMicros) throw new SharedMicoAllowanceError(false);
    }
    await prepareCreditLots(tx, organizationId, now);
    await expireCreditLots(tx, organizationId, now);
    const reserved = await tx.modelCreditAccount.updateMany({
      where: { organizationId, mode: "credits", balanceMicros: { gte: amountMicros } },
      data: { balanceMicros: { decrement: amountMicros } },
    });
    if (reserved.count !== 1)
      throw new Error(
        "Not enough model credits. Add credits in Billing or connect your own API key.",
      );
    const allocations = await allocateCreditLots(tx, organizationId, amountMicros, now);
    return (
      await tx.modelCreditEntry.create({
        data: {
          ...entryAttribution,
          ...(desktopTool ? { desktopTool: true } : {}),
          id: callId,
          callId,
          source,
          organizationId,
          amountMicros: -amountMicros,
          pending: true,
          allocations,
          fundedMicros: allocatedMicros(allocations),
          reconciliationState: "pending",
          nextReconcileAt: new Date(Date.now() + 5 * 60_000),
        },
      })
    ).id;
  });
}

/** The caller can combine usage insertion and settlement in the same transaction. */
export async function settleModelCreditsTx(
  tx: Prisma.TransactionClient,
  reservationId: string,
  costUsd: number | null,
  reconcile = false,
  now = new Date(),
) {
  if (costUsd === null) return;
  if (!Number.isFinite(costUsd) || costUsd < 0) throw new Error("Invalid model cost");
  const scope = await tx.modelCreditEntry.findUnique({ where: { id: reservationId } });
  if (!scope) return;
  await tx.$queryRaw`SELECT "organizationId" FROM model_credit_accounts WHERE "organizationId"=${scope.organizationId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM model_credit_entries WHERE id=${reservationId} FOR UPDATE`;
  await prepareCreditLots(tx, scope.organizationId, now);
  await expireCreditLots(tx, scope.organizationId, now);
  const entry = await tx.modelCreditEntry.findUnique({ where: { id: reservationId } });
  if (!entry || (!entry.pending && !reconcile)) return;
  const amountMicros = -BigInt(Math.ceil(costUsd * MICROS_PER_DOLLAR));
  if (!entry.pending && amountMicros === entry.amountMicros) return;
  let allocations = (entry.allocations ?? []) as CreditAllocation[];
  const difference = amountMicros - entry.amountMicros;
  if (difference > 0n) {
    const funded = allocatedMicros(allocations);
    const unfunded = -entry.amountMicros - funded;
    const refund = difference - (unfunded > 0n ? unfunded : 0n);
    if (refund > 0n) allocations = await returnCreditLots(tx, allocations, refund, now);
  } else if (difference < 0n) {
    allocations.push(...(await allocateCreditLots(tx, entry.organizationId, -difference, now)));
  }
  await tx.modelCreditEntry.update({
    where: { id: reservationId },
    data: { pending: false, amountMicros, allocations, fundedMicros: allocatedMicros(allocations) },
  });
  await tx.modelCreditAccount.update({
    where: { organizationId: entry.organizationId },
    data: { balanceMicros: { increment: amountMicros - entry.amountMicros } },
  });
  await syncLotBalance(tx, entry.organizationId);
}

/** Unknown usage leaves a visible hold; no timeout can invent a zero-cost result. */
export function settleModelCredits(
  prisma: PrismaClient,
  reservationId: string,
  costUsd: number | null,
  now = new Date(),
) {
  return prisma.$transaction((tx) => settleModelCreditsTx(tx, reservationId, costUsd, false, now));
}

/** A provider cost or a proven pre-generation stop can finalize accounting. */
export function hasFinalModelCost(
  usage: Pick<AgentUsage, "costUsd" | "costSource" | "usageSource">,
): boolean {
  return (
    usage.costUsd != null &&
    Number.isFinite(usage.costUsd) &&
    usage.costUsd >= 0 &&
    (usage.costSource === "provider-reported" ||
      (usage.costUsd === 0 &&
        ["not-started", "provider-rejected"].includes(usage.usageSource ?? "")))
  );
}

/** Persist a receipt before attempting the canonical usage + settlement transaction. */
export async function recordModelCreditReceipt(
  prisma: PrismaClient,
  id: string,
  usage: AgentUsage | null,
) {
  if (!usage) return;
  await prisma.modelCreditEntry.updateMany({
    where: { id, pending: true },
    data: {
      usage: JSON.parse(JSON.stringify(usage)),
      ...(usage.providerRequestId ? { providerRequestId: usage.providerRequestId } : {}),
    },
  });
  if (
    usage.costUsd === 0 &&
    (usage.usageSource === "not-started" || usage.usageSource === "provider-rejected")
  )
    await prisma.$transaction(async (tx) => {
      await settleModelCreditsTx(tx, id, 0);
      await tx.modelCreditEntry.updateMany({
        where: { id, reconciliationState: "pending" },
        data: { nextReconcileAt: new Date() },
      });
    });
}

/** Also called by billing reads and the background reconciler when no new invoice arrives. */
export async function expireModelCredits(
  prisma: PrismaClient,
  organizationId: string,
  now = new Date(),
) {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "organizationId" FROM model_credit_accounts WHERE "organizationId"=${organizationId} FOR UPDATE`;
    const account = await tx.modelCreditAccount.findUnique({ where: { organizationId } });
    if (!account) return;
    await prepareCreditLots(tx, organizationId, now);
    await expireCreditLots(tx, organizationId, now);
  });
}
