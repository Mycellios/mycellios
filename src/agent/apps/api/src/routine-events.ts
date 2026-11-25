import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { AdapterContext } from "@mycellios/adapter-kit";
import { SecretStoreUnavailableError } from "@mycellios/adapter-kit";
import type { RoutineEventIgnoredReason, RoutineWebhookState } from "@mycellios/contracts";
import {
  ROUTINE_EVENT_TOLERANCE_SECONDS,
  ROUTINE_EVENTS_PER_HOUR,
  ROUTINE_WEBHOOK_PREVIOUS_SECRET_HOURS,
} from "@mycellios/contracts";
import { ROUTINE_TEST_EVENT_NONCE_PREFIX } from "@mycellios/core";
import type { PrismaClient, RoutineEventRoutine } from "@mycellios/db";
import {
  claimRoutineEvent,
  ensureRoutineThread,
  recordRoutineEventRun,
  releaseRoutineEventClaim,
  routineEventFilters,
} from "@mycellios/db";
import { getLogger } from "@mycellios/logging";
import type { Hono } from "hono";
import { readBoundedBytes } from "./http-body.js";
import {
  deliverOneWebhookEvent,
  formatUntrustedDeliveryPayload,
  inboundEventName,
  loadWebhookSecret,
  WEBHOOK_MAX_BODY_BYTES,
  type WebhookDeps,
  type WebhookSecretCache,
} from "./webhook-inbound.js";

/** Standard Webhooks secrets are `whsec_` and the base64 of the key bytes. */
const SECRET_PREFIX = "whsec_";
const ROUTINE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const DELIVERY_ID = /^[\x21-\x7e]{1,256}$/;
/** Each signed event gets its own identity in the routine conversation; repeats reuse it. */
const ROUTINE_EVENT_NONCE_PREFIX = "routine-event:";

/** A new secret in the Standard Webhooks format, from 32 random bytes. */
export function createRoutineWebhookSecret(): string {
  return `${SECRET_PREFIX}${randomBytes(32).toString("base64")}`;
}

function secretKey(secret: string): Buffer | null {
  if (!secret.startsWith(SECRET_PREFIX)) return null;
  const encoded = secret.slice(SECRET_PREFIX.length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return null;
  const key = Buffer.from(encoded, "base64");
  return key.length >= 24 && key.length <= 64 ? key : null;
}

function signatureDigest(key: Buffer, id: string, timestamp: string, body: Uint8Array): Buffer {
  return createHmac("sha256", key).update(`${id}.${timestamp}.`).update(body).digest();
}

/** The `webhook-signature` value for an event: `v1,` and the base64 HMAC-SHA256 of `id.timestamp.body`. */
export function signRoutineEvent(
  secret: string,
  id: string,
  timestamp: string,
  body: Uint8Array,
): string {
  const key = secretKey(secret);
  if (!key) throw new Error("Invalid routine webhook secret");
  return `v1,${signatureDigest(key, id, timestamp, body).toString("base64")}`;
}

export type StandardWebhookHeaders = { id: string; timestamp: string; signatures: Buffer[] };

/** The three Standard Webhooks headers, or null when any is missing or malformed. */
export function parseStandardWebhookHeaders(
  header: (name: string) => string | undefined,
): StandardWebhookHeaders | null {
  const id = header("webhook-id")?.trim();
  const timestamp = header("webhook-timestamp")?.trim();
  const signature = header("webhook-signature");
  if (!id || !DELIVERY_ID.test(id)) return null;
  if (!timestamp || !/^[0-9]{1,12}$/.test(timestamp)) return null;
  if (!signature || signature.length > 2_048) return null;
  const signatures: Buffer[] = [];
  // A sender lists several signatures while it rotates; other versions are not HMAC.
  for (const part of signature.trim().split(/\s+/).slice(0, 8)) {
    if (!part.startsWith("v1,")) continue;
    const encoded = part.slice(3);
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) continue;
    const bytes = Buffer.from(encoded, "base64");
    if (bytes.length === 32) signatures.push(bytes);
  }
  return signatures.length ? { id, timestamp, signatures } : null;
}

/** Signed within 5 minutes of the server's clock, either way. */
export function routineEventTimestampFresh(timestamp: string, now: Date): boolean {
  return Math.abs(now.getTime() / 1000 - Number(timestamp)) <= ROUTINE_EVENT_TOLERANCE_SECONDS;
}

/**
 * The index of the secret that signed this exact body, or -1. Every secret and signature is
 * compared in constant time, so the answer takes as long whichever one matches.
 */
export function matchRoutineEventSecret(
  headers: StandardWebhookHeaders,
  body: Uint8Array,
  secrets: readonly string[],
): number {
  let matched = -1;
  secrets.forEach((secret, index) => {
    const key = secretKey(secret);
    if (!key) return;
    const expected = signatureDigest(key, headers.id, headers.timestamp, body);
    for (const signature of headers.signatures) {
      if (timingSafeEqual(signature, expected) && matched < 0) matched = index;
    }
  });
  return matched;
}

/** The event as the routine's run reads it: fenced as untrusted data, labelled by its type. */
export function formatRoutineEventPrompt(payload: Record<string, unknown>): string {
  return formatUntrustedDeliveryPayload(`[Inbound Event: ${inboundEventName(payload.type)}]`, payload);
}

function keyDigest(id: string): string {
  return createHash("sha256").update(id).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** The routine's secrets that still work, decrypted, newest first; null when none can sign. */
async function loadRoutineEventSecrets(
  deps: Pick<WebhookDeps, "prisma" | "secrets">,
  cache: WebhookSecretCache,
  routineId: string,
  now: Date,
): Promise<Array<{ id: string; value: string }> | null> {
  const routine = await deps.prisma.routine.findFirst({
    where: { id: routineId, webhookEnabled: true, bot: { archivedAt: null } },
    select: {
      spaceId: true,
      userId: true,
      webhookSecrets: {
        where: { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        select: { id: true, ciphertext: true, spaceId: true, userId: true },
        orderBy: { createdAt: "desc" },
        take: 2,
      },
    },
  });
  if (!routine) return null;
  const owned = routine.webhookSecrets.filter(
    (secret) => secret.spaceId === routine.spaceId && secret.userId === routine.userId,
  );
  const loaded = await Promise.all(
    owned.map(async (secret) => ({
      id: secret.id,
      value: await loadWebhookSecret(deps.secrets, cache, secret.id, secret),
    })),
  );
  const usable = loaded.filter((secret): secret is { id: string; value: string } => secret.value !== null);
  return usable.length ? usable : null;
}

export type RoutineEventOutcome =
  | { status: 202; body: { ok: true; status: "queued"; runId: string | null } }
  | { status: 202; body: { ok: true; status: "ignored"; reason: RoutineEventIgnoredReason } }
  | {
      status: 200;
      body: { ok: true; duplicate: true; status: "queued" | "ignored"; runId: string | null };
    }
  | { status: 400; body: { error: string } }
  | { status: 401; body: { error: string } }
  | { status: 429; body: { error: string }; retryAfterSeconds: number };

const UNAUTHORIZED = { status: 401, body: { error: "Unauthorized" } } as const;

/** Start the routine's run for an accepted event, once per delivery id. */
async function deliverRoutineEvent(
  deps: WebhookDeps,
  claim: { receiptId: string; routine: RoutineEventRoutine },
  payload: Record<string, unknown>,
  digest: string,
  test: boolean,
): Promise<string | null> {
  const { routine } = claim;
  const bot = { id: routine.botId, spaceId: routine.spaceId, userId: routine.userId };
  const scope = { spaceId: routine.spaceId, userId: routine.userId, botId: routine.botId };
  const clientNonce = `${test ? ROUTINE_TEST_EVENT_NONCE_PREFIX : ROUTINE_EVENT_NONCE_PREFIX}${routine.id}:${Buffer.from(digest, "hex").toString("base64url")}`;
  try {
    // Runs keep this identity even when their conversation is cleared.
    const accepted = await deps.prisma.run.findFirst({
      where: { ...scope, routineId: routine.id, clientNonce },
      select: { id: true },
    });
    let runId = accepted?.id ?? null;
    if (!accepted) {
      const thread = await ensureRoutineThread(deps.prisma, scope, routine.id);
      const sent = await deliverOneWebhookEvent(
        deps,
        { bot, threadId: thread.id },
        {
          prompt: formatRoutineEventPrompt(payload),
          routines: [routine],
          source: "webhook",
          clientNonce,
          ...(test ? { routineTestEvent: true as const } : {}),
        },
        { id: routine.id, source: "webhook" },
      );
      runId = sent.runId;
    }
    await recordRoutineEventRun(deps.prisma, claim.receiptId, runId);
    return runId;
  } catch (error) {
    // Nothing started: forget the id so the sender's retry of it can start the run.
    await releaseRoutineEventClaim(deps.prisma, claim.receiptId).catch(() => undefined);
    throw error;
  }
}

/**
 * Verify a Standard Webhooks event against the routine's secrets before reading its body, then
 * decide and start its run. Every refusal is the same 401, so it never tells whether the routine
 * exists. Logs name the Mico, routine and result, never the body.
 */
export async function acceptRoutineEvent(
  deps: WebhookDeps,
  cache: WebhookSecretCache,
  request: { routineId: string; header: (name: string) => string | undefined; body: Uint8Array },
  options: { test?: boolean; now?: Date } = {},
): Promise<RoutineEventOutcome> {
  const now = options.now ?? new Date();
  const test = options.test === true;
  const headers = parseStandardWebhookHeaders(request.header);
  if (!headers || !routineEventTimestampFresh(headers.timestamp, now) || !ROUTINE_ID.test(request.routineId))
    return UNAUTHORIZED;
  const secrets = await loadRoutineEventSecrets(deps, cache, request.routineId, now);
  if (!secrets) return UNAUTHORIZED;
  const signer = secrets[matchRoutineEventSecret(headers, request.body, secrets.map((secret) => secret.value))];
  if (!signer) return UNAUTHORIZED;

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(request.body));
  } catch {
    return { status: 400, body: { error: "The body must be a JSON object." } };
  }
  if (!isRecord(payload)) return { status: 400, body: { error: "The body must be a JSON object." } };

  const digest = keyDigest(headers.id);
  const claim = await claimRoutineEvent(deps.prisma, {
    routineId: request.routineId,
    secretId: signer.id,
    keyDigest: digest,
    payload,
    test,
    now,
  });
  const log = (result: string, routine?: RoutineEventRoutine) =>
    getLogger().info("routine.event", {
      "routine.id": request.routineId,
      ...(routine ? { "bot.id": routine.botId } : {}),
      "routine.event.result": result,
      ...(test ? { "routine.event.test": true } : {}),
    });
  switch (claim.kind) {
    case "refused":
      return UNAUTHORIZED;
    case "rate_limited":
      log("rate_limited");
      return {
        status: 429,
        body: { error: `This routine accepts at most ${ROUTINE_EVENTS_PER_HOUR} events an hour.` },
        retryAfterSeconds: claim.retryAfterSeconds,
      };
    case "ignored":
      log(`ignored:${claim.reason}`);
      return { status: 202, body: { ok: true, status: "ignored", reason: claim.reason } };
    case "duplicate": {
      let runId = claim.runId;
      // The first delivery of this id stopped before its run was recorded: finish it, once.
      if (claim.result === "queued" && !runId) {
        runId = await deliverRoutineEvent(deps, claim, payload, digest, test);
      }
      log("duplicate", claim.routine);
      return {
        status: 200,
        body: {
          ok: true,
          duplicate: true,
          status: claim.result === "queued" ? "queued" : "ignored",
          runId,
        },
      };
    }
    case "deliver": {
      const runId = await deliverRoutineEvent(deps, claim, payload, digest, test);
      log("queued", claim.routine);
      return { status: 202, body: { ok: true, status: "queued", runId } };
    }
  }
}

/** POST /api/v1/routines/:routineId/events, signed with the routine's own secret. */
export function mountRoutineEventRoutes(
  app: Hono,
  deps: WebhookDeps,
  cache: WebhookSecretCache = new Map(),
) {
  app.post("/api/v1/routines/:routineId/events", async (c) => {
    // Reject oversized bodies before any lookup, so the size limit says nothing about routines.
    const body = await readBoundedBytes(c.req.raw, WEBHOOK_MAX_BODY_BYTES);
    if (body === null) return c.json({ error: "Payload too large" }, 413);
    let outcome: RoutineEventOutcome;
    try {
      outcome = await acceptRoutineEvent(deps, cache, {
        routineId: c.req.param("routineId"),
        header: (name) => c.req.header(name),
        body,
      });
    } catch (error) {
      if (error instanceof SecretStoreUnavailableError) {
        return c.json({ error: "Service unavailable" }, 503);
      }
      throw error;
    }
    if (outcome.status === 429) {
      return c.json(outcome.body, 429, { "Retry-After": String(outcome.retryAfterSeconds) });
    }
    return c.json(outcome.body, outcome.status);
  });
}

/** What the app shows of a routine's webhook without reading the secret. */
export function routineWebhookState(
  routine: { webhookEventType: string | null; webhookFilters: unknown },
  secrets: ReadonlyArray<{ createdAt: Date; expiresAt: Date | null; revealUntil?: Date | null }>,
  now = new Date(),
): RoutineWebhookState {
  const current = secrets.find((secret) => secret.expiresAt === null);
  const previous = secrets
    .filter((secret) => secret.expiresAt !== null && secret.expiresAt > now)
    .sort((a, b) => b.expiresAt!.getTime() - a.expiresAt!.getTime())[0];
  return {
    secretCreatedAt: current?.createdAt.toISOString() ?? null,
    previousSecretExpiresAt: previous?.expiresAt?.toISOString() ?? null,
    eventType: routine.webhookEventType,
    filters: routineEventFilters(routine.webhookFilters) ?? [],
    revealUntil: current?.revealUntil && current.revealUntil > now
      ? current.revealUntil.toISOString()
      : null,
  };
}

export const routineWebhookSecretsSelect = {
  select: { createdAt: true, expiresAt: true, revealUntil: true },
} as const;

/**
 * Replace the routine's secret. The new one is returned once and stored encrypted; the one it
 * replaces keeps working for 24 hours, and any older one ends now.
 */
export async function rotateRoutineWebhookSecret(
  deps: Pick<WebhookDeps, "prisma" | "secrets">,
  routine: { id: string; spaceId: string; userId: string },
  context: AdapterContext,
  now = new Date(),
): Promise<string> {
  const plaintext = createRoutineWebhookSecret();
  const stored = await deps.secrets.put(plaintext, context);
  await deps.prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM routines WHERE id = ${routine.id} AND "spaceId" = ${routine.spaceId} AND "userId" = ${routine.userId} FOR UPDATE`;
    await tx.routineWebhookSecret.deleteMany({
      where: { routineId: routine.id, NOT: { expiresAt: null } },
    });
    await tx.routineWebhookSecret.updateMany({
      where: { routineId: routine.id, expiresAt: null },
      data: {
        expiresAt: new Date(now.getTime() + ROUTINE_WEBHOOK_PREVIOUS_SECRET_HOURS * 60 * 60 * 1000),
        revealUntil: null,
      },
    });
    await tx.routineWebhookSecret.create({
      data: {
        id: stored.id,
        spaceId: routine.spaceId,
        userId: routine.userId,
        routineId: routine.id,
        ciphertext: stored.ciphertext,
        createdAt: now,
      },
    });
  });
  return plaintext;
}

/** Claim a chat-created secret exactly once for the routine's owner. */
export async function revealRoutineWebhookSecret(
  deps: Pick<WebhookDeps, "prisma" | "secrets">,
  routine: { id: string; spaceId: string; userId: string },
): Promise<string | null> {
  return deps.prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM routines WHERE id = ${routine.id} AND "spaceId" = ${routine.spaceId}
      AND "userId" = ${routine.userId} AND "webhookEnabled" = TRUE FOR UPDATE
    `;
    if (!locked.length) return null;
    const where = {
      routineId: routine.id,
      spaceId: routine.spaceId,
      userId: routine.userId,
      expiresAt: null,
      revealUntil: { gt: new Date() },
    };
    const secret = await tx.routineWebhookSecret.findFirst({
      where,
      select: { id: true, ciphertext: true },
    });
    if (!secret) return null;
    const consumed = await tx.routineWebhookSecret.updateMany({
      where: { ...where, id: secret.id },
      data: { revealUntil: null },
    });
    if (consumed.count !== 1) return null;
    // If decryption fails, the transaction rolls back and the user can try again.
    return deps.secrets.load(secret.ciphertext, secret.id);
  });
}

/** End the routine's current and previous secrets at once. */
export async function revokeRoutineWebhookSecrets(
  prisma: PrismaClient,
  routine: { id: string; spaceId: string; userId: string },
): Promise<void> {
  await prisma.routineWebhookSecret.deleteMany({
    where: { routineId: routine.id, spaceId: routine.spaceId, userId: routine.userId },
  });
}

/** The sample event Send test event signs: the routine's event type, marked as a test. */
export function routineTestEventBody(eventType: string | null, now: Date): Buffer {
  return Buffer.from(
    JSON.stringify({
      type: eventType ?? "mycellios.test",
      timestamp: now.toISOString(),
      data: { test: true },
    }),
  );
}

export class RoutineTestEventError extends Error {
  constructor(
    readonly code: "NO_WEBHOOK" | "NO_SECRET" | "RATE_LIMITED",
    message: string,
  ) {
    super(message);
    this.name = "RoutineTestEventError";
  }
}

/**
 * Sign a sample event with the routine's current secret and pass it through the same checks
 * as any event, as a test: it runs even while the routine is paused and skips its filters.
 * A retry with the same client nonce returns the same run.
 */
export async function sendRoutineTestEvent(
  deps: WebhookDeps,
  routine: {
    id: string;
    webhookEnabled: boolean;
    webhookEventType: string | null;
    secret: { id: string; ciphertext: string } | null;
  },
  clientNonce: string | undefined,
  now = new Date(),
): Promise<string> {
  if (!routine.webhookEnabled)
    throw new RoutineTestEventError("NO_WEBHOOK", "Add a webhook trigger to this routine first.");
  if (!routine.secret)
    throw new RoutineTestEventError("NO_SECRET", "Create a secret for this routine first.");
  const secret = await deps.secrets.load(routine.secret.ciphertext, routine.secret.id);
  const id = `msg_test_${createHash("sha256")
    .update(`${routine.id}:${clientNonce ?? randomUUID()}`)
    .digest("hex")
    .slice(0, 32)}`;
  const timestamp = String(Math.floor(now.getTime() / 1000));
  const body = routineTestEventBody(routine.webhookEventType, now);
  const headers: Record<string, string> = {
    "webhook-id": id,
    "webhook-timestamp": timestamp,
    "webhook-signature": signRoutineEvent(secret, id, timestamp, body),
  };
  const outcome = await acceptRoutineEvent(
    deps,
    new Map(),
    { routineId: routine.id, header: (name) => headers[name], body },
    { test: true, now },
  );
  if (outcome.status === 429)
    throw new RoutineTestEventError(
      "RATE_LIMITED",
      `This routine received ${ROUTINE_EVENTS_PER_HOUR} events in the last hour. Try again later.`,
    );
  if ((outcome.status === 200 || outcome.status === 202) && "runId" in outcome.body && outcome.body.runId)
    return outcome.body.runId;
  // The secret changed or ended while the test was signed.
  throw new RoutineTestEventError("NO_SECRET", "Create a secret for this routine first.");
}
