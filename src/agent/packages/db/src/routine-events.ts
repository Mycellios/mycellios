import type { RoutineEventFilter, RoutineEventIgnoredReason } from "@mycellios/contracts";
import {
  ROUTINE_EVENT_RECEIPT_DAYS,
  ROUTINE_EVENTS_PER_HOUR,
  RoutineEventFiltersSchema,
} from "@mycellios/contracts";
import { routineEventMatch } from "@mycellios/core";
import { getLogger } from "@mycellios/logging";
import type { PrismaClient } from "./client.js";

const HOUR_MS = 60 * 60 * 1000;
const RECEIPT_MS = ROUTINE_EVENT_RECEIPT_DAYS * 24 * HOUR_MS;

/** The receipts of signed routine events are kept this long. */
export function routineEventReceiptCutoff(now: Date): Date {
  return new Date(now.getTime() - RECEIPT_MS);
}

/** A routine's stored filters; null when they cannot be read, so its events are refused. */
export function routineEventFilters(value: unknown): RoutineEventFilter[] | null {
  if (value === null || value === undefined) return [];
  const parsed = RoutineEventFiltersSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** What a routine event runs with: the routine as it was when the event was accepted. */
export type RoutineEventRoutine = {
  id: string;
  botId: string;
  spaceId: string;
  userId: string;
  name: string;
  prompt: string;
  modelProvider: string | null;
  modelId: string | null;
  thinkingLevel: string | null;
};

export type RoutineEventClaim =
  /** The routine, its webhook or the secret that signed the event is gone. */
  | { kind: "refused" }
  | {
      kind: "duplicate";
      receiptId: string;
      result: "queued" | "ignored" | "paused";
      runId: string | null;
      routine: RoutineEventRoutine;
    }
  | { kind: "rate_limited"; retryAfterSeconds: number }
  | { kind: "ignored"; receiptId: string; reason: RoutineEventIgnoredReason }
  | { kind: "deliver"; receiptId: string; routine: RoutineEventRoutine };

const routineEventRoutineSelect = {
  id: true,
  botId: true,
  spaceId: true,
  userId: true,
  name: true,
  prompt: true,
  modelProvider: true,
  modelId: true,
  thinkingLevel: true,
} as const;

/**
 * Decide what a verified event does, before any run starts. One event at a time per routine (the
 * routine row is locked), so the hourly limit and the duplicate check are exact. A repeated
 * delivery id starts nothing; an event for a paused routine, of another type or that a filter
 * refuses is recorded and starts nothing. A test event skips the paused state and the filters.
 */
export async function claimRoutineEvent(
  prisma: PrismaClient,
  input: {
    routineId: string;
    /** The secret that verified the signature; a rotation past it or Revoke refuses the event. */
    secretId: string;
    /** SHA-256 (hex) of the delivery id. */
    keyDigest: string;
    payload: unknown;
    test?: boolean;
    now?: Date;
  },
): Promise<RoutineEventClaim> {
  if (!/^[a-f0-9]{64}$/.test(input.keyDigest)) throw new Error("Invalid routine event identity");
  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx): Promise<RoutineEventClaim> => {
    await tx.$queryRaw`SELECT id FROM routines WHERE id = ${input.routineId} FOR UPDATE`;
    const routine = await tx.routine.findFirst({
      where: { id: input.routineId, webhookEnabled: true, bot: { archivedAt: null } },
      select: {
        ...routineEventRoutineSelect,
        active: true,
        webhookEventType: true,
        webhookFilters: true,
        webhookSecrets: {
          where: { id: input.secretId, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
          select: { spaceId: true, userId: true },
        },
      },
    });
    const secret = routine?.webhookSecrets[0];
    if (!routine || !secret || secret.spaceId !== routine.spaceId || secret.userId !== routine.userId)
      return { kind: "refused" };
    const snapshot: RoutineEventRoutine = {
      id: routine.id,
      botId: routine.botId,
      spaceId: routine.spaceId,
      userId: routine.userId,
      name: routine.name,
      prompt: routine.prompt,
      modelProvider: routine.modelProvider,
      modelId: routine.modelId,
      thinkingLevel: routine.thinkingLevel,
    };
    // An expired receipt no longer makes its id a repeat.
    await tx.routineEventReceipt.deleteMany({
      where: { routineId: routine.id, createdAt: { lt: routineEventReceiptCutoff(now) } },
    });
    const existing = await tx.routineEventReceipt.findUnique({
      where: { routineId_keyDigest: { routineId: routine.id, keyDigest: input.keyDigest } },
      select: { id: true, result: true, runId: true },
    });
    if (existing) {
      return {
        kind: "duplicate",
        receiptId: existing.id,
        result: existing.result as "queued" | "ignored" | "paused",
        runId: existing.runId,
        routine: snapshot,
      };
    }
    const recent = await tx.routineEventReceipt.findMany({
      where: { routineId: routine.id, createdAt: { gt: new Date(now.getTime() - HOUR_MS) } },
      select: { createdAt: true },
      orderBy: { createdAt: "asc" },
      take: ROUTINE_EVENTS_PER_HOUR,
    });
    const oldest = recent[0];
    if (recent.length >= ROUTINE_EVENTS_PER_HOUR && oldest) {
      const wait = oldest.createdAt.getTime() + HOUR_MS - now.getTime();
      return { kind: "rate_limited", retryAfterSeconds: Math.max(1, Math.ceil(wait / 1000)) };
    }
    let reason: RoutineEventIgnoredReason | null = null;
    if (!input.test) {
      if (!routine.active) reason = "paused";
      else {
        const filters = routineEventFilters(routine.webhookFilters);
        const match = filters
          ? routineEventMatch({ eventType: routine.webhookEventType ?? null, filters }, input.payload)
          : ({ ok: false, reason: "filter" } as const);
        if (!match.ok) reason = match.reason;
      }
    }
    const receipt = await tx.routineEventReceipt.create({
      data: {
        spaceId: routine.spaceId,
        userId: routine.userId,
        routineId: routine.id,
        keyDigest: input.keyDigest,
        result: reason === null ? "queued" : reason === "paused" ? "paused" : "ignored",
        reason: reason === "event_type" || reason === "filter" ? reason : null,
        test: input.test === true,
        createdAt: now,
      },
      select: { id: true },
    });
    return reason === null
      ? { kind: "deliver", receiptId: receipt.id, routine: snapshot }
      : { kind: "ignored", receiptId: receipt.id, reason };
  });
}

/** The run an accepted event started, answered to its repeats. */
export async function recordRoutineEventRun(
  prisma: PrismaClient,
  receiptId: string,
  runId: string | null,
): Promise<void> {
  await prisma.routineEventReceipt.updateMany({ where: { id: receiptId }, data: { runId } });
}

/** The routine was paused or its webhook turned off before the run could start. */
export async function recordRoutineEventPaused(prisma: PrismaClient, receiptId: string) {
  await prisma.routineEventReceipt.updateMany({
    where: { id: receiptId, runId: null },
    data: { result: "paused", reason: null },
  });
}

/** Forget an event whose run could not start, so the sender's retry of that id can start it. */
export async function releaseRoutineEventClaim(prisma: PrismaClient, receiptId: string) {
  await prisma.routineEventReceipt.deleteMany({ where: { id: receiptId, runId: null } });
}

/** Signed events that started nothing in the last 7 days, newest first, for the history. */
export async function listRoutineIgnoredEvents(
  prisma: PrismaClient,
  scope: { spaceId: string; userId: string; routineId: string },
  now = new Date(),
) {
  const rows = await prisma.routineEventReceipt.findMany({
    where: {
      routineId: scope.routineId,
      spaceId: scope.spaceId,
      userId: scope.userId,
      result: { in: ["ignored", "paused"] },
      createdAt: { gte: routineEventReceiptCutoff(now) },
    },
    select: { id: true, createdAt: true, result: true, reason: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 100,
  });
  return rows.map((row) => ({
    id: row.id,
    receivedAt: row.createdAt.toISOString(),
    reason: (row.result === "paused"
      ? "paused"
      : row.reason === "event_type"
        ? "event_type"
        : "filter") as RoutineEventIgnoredReason,
  }));
}

/** Drop receipts past their 7 days and previous secrets past their 24 hours. */
export async function pruneRoutineEvents(prisma: PrismaClient, now = new Date()) {
  const receipts = await prisma.routineEventReceipt.deleteMany({
    where: { createdAt: { lt: routineEventReceiptCutoff(now) } },
  });
  const secrets = await prisma.routineWebhookSecret.deleteMany({
    where: { expiresAt: { lte: now } },
  });
  return { receipts: receipts.count, secrets: secrets.count };
}

/** A pruner for a frequent reconciler tick that only touches the tables about once an hour. */
export function createRoutineEventPruner(
  prisma: PrismaClient,
  options: { intervalMs?: number; now?: () => Date } = {},
): () => Promise<void> {
  const intervalMs = options.intervalMs ?? HOUR_MS;
  const now = options.now ?? (() => new Date());
  let lastRun: number | undefined;
  return async () => {
    const at = now();
    if (lastRun !== undefined && at.getTime() - lastRun < intervalMs) return;
    lastRun = at.getTime();
    const removed = await pruneRoutineEvents(prisma, at);
    if (removed.receipts > 0 || removed.secrets > 0)
      getLogger().info("routine.event.pruned", {
        "routine.event.receipts": removed.receipts,
        "routine.event.secrets": removed.secrets,
      });
  };
}
