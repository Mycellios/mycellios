import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import {
  createRoutineWebhookSecret,
  matchRoutineEventSecret,
  mountRoutineEventRoutes,
  parseStandardWebhookHeaders,
  routineEventTimestampFresh,
  routineTestEventBody,
  routineWebhookState,
  signRoutineEvent,
} from "./routine-events.js";
import { WEBHOOK_MAX_BODY_BYTES, type WebhookDeps } from "./webhook-inbound.js";

// The example from the Standard Webhooks specification.
const EXAMPLE_SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
const EXAMPLE_ID = "msg_p5jXN8AQM9LWM0D4loKWxJek";
const EXAMPLE_TIMESTAMP = "1614265330";
const EXAMPLE_BODY = Buffer.from('{"test": 2432232314}');

function headersOf(values: Record<string, string>) {
  return (name: string) => values[name];
}

function signed(secret: string, body: Buffer, id = "msg_1", timestamp = String(Math.floor(Date.now() / 1000))) {
  return {
    "webhook-id": id,
    "webhook-timestamp": timestamp,
    "webhook-signature": signRoutineEvent(secret, id, timestamp, body),
  };
}

describe("Standard Webhooks signatures", () => {
  it("signs id.timestamp.body as the specification's example does", () => {
    expect(signRoutineEvent(EXAMPLE_SECRET, EXAMPLE_ID, EXAMPLE_TIMESTAMP, EXAMPLE_BODY)).toBe(
      "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=",
    );
  });

  it("creates whsec_ secrets from 32 random bytes", () => {
    const secret = createRoutineWebhookSecret();
    expect(secret).toMatch(/^whsec_[A-Za-z0-9+/]+={0,2}$/);
    expect(Buffer.from(secret.slice("whsec_".length), "base64")).toHaveLength(32);
    expect(createRoutineWebhookSecret()).not.toBe(secret);
  });

  it("accepts the valid signature and refuses a wrong secret or a changed body", () => {
    const other = createRoutineWebhookSecret();
    const headers = parseStandardWebhookHeaders(headersOf(signed(EXAMPLE_SECRET, EXAMPLE_BODY)))!;
    expect(matchRoutineEventSecret(headers, EXAMPLE_BODY, [EXAMPLE_SECRET])).toBe(0);
    expect(matchRoutineEventSecret(headers, EXAMPLE_BODY, [other])).toBe(-1);
    expect(matchRoutineEventSecret(headers, Buffer.from('{"test": 2432232315}'), [EXAMPLE_SECRET])).toBe(-1);
    // The exact bytes are signed: the same JSON written another way is a different body.
    expect(matchRoutineEventSecret(headers, Buffer.from('{"test":2432232314}'), [EXAMPLE_SECRET])).toBe(-1);
  });

  it("accepts the current and the previous secret during a rotation", () => {
    const current = createRoutineWebhookSecret();
    const fromPrevious = parseStandardWebhookHeaders(headersOf(signed(EXAMPLE_SECRET, EXAMPLE_BODY)))!;
    const fromCurrent = parseStandardWebhookHeaders(headersOf(signed(current, EXAMPLE_BODY)))!;
    expect(matchRoutineEventSecret(fromCurrent, EXAMPLE_BODY, [current, EXAMPLE_SECRET])).toBe(0);
    expect(matchRoutineEventSecret(fromPrevious, EXAMPLE_BODY, [current, EXAMPLE_SECRET])).toBe(1);
    expect(matchRoutineEventSecret(fromPrevious, EXAMPLE_BODY, [current])).toBe(-1);
  });

  it("takes any one of several signatures, as a sender lists them while it rotates", () => {
    const current = createRoutineWebhookSecret();
    const timestamp = String(Math.floor(Date.now() / 1000));
    const headers = parseStandardWebhookHeaders(
      headersOf({
        "webhook-id": "msg_2",
        "webhook-timestamp": timestamp,
        "webhook-signature": `v1a,ignored ${signRoutineEvent(createRoutineWebhookSecret(), "msg_2", timestamp, EXAMPLE_BODY)} ${signRoutineEvent(current, "msg_2", timestamp, EXAMPLE_BODY)}`,
      }),
    )!;
    expect(headers.signatures).toHaveLength(2);
    expect(matchRoutineEventSecret(headers, EXAMPLE_BODY, [current])).toBe(0);
  });

  it("reads only well-formed headers", () => {
    const valid = signed(EXAMPLE_SECRET, EXAMPLE_BODY);
    expect(parseStandardWebhookHeaders(headersOf(valid))).not.toBeNull();
    for (const broken of [
      { ...valid, "webhook-id": "" },
      { ...valid, "webhook-id": "has space" },
      { ...valid, "webhook-timestamp": "soon" },
      { ...valid, "webhook-signature": "sha256=abc" },
      { ...valid, "webhook-signature": "v1,c2hvcnQ=" },
      { "webhook-id": valid["webhook-id"], "webhook-timestamp": valid["webhook-timestamp"] },
    ]) {
      expect(parseStandardWebhookHeaders(headersOf(broken as Record<string, string>))).toBeNull();
    }
  });

  it("refuses timestamps more than 5 minutes from the server's clock, either way", () => {
    const now = new Date("2026-11-25T12:00:00Z");
    const at = (seconds: number) => String(Math.floor(now.getTime() / 1000) + seconds);
    expect(routineEventTimestampFresh(at(0), now)).toBe(true);
    expect(routineEventTimestampFresh(at(-300), now)).toBe(true);
    expect(routineEventTimestampFresh(at(300), now)).toBe(true);
    expect(routineEventTimestampFresh(at(-301), now)).toBe(false);
    expect(routineEventTimestampFresh(at(301), now)).toBe(false);
  });
});

describe("routineWebhookState", () => {
  it("shows when the secret was made and until when the previous one works, never the secret", () => {
    const now = new Date("2026-11-25T12:00:00Z");
    const state = routineWebhookState(
      { webhookEventType: "invoice.paid", webhookFilters: [{ pointer: "/status", value: "paid" }] },
      [
        { createdAt: new Date("2026-11-25T11:00:00Z"), expiresAt: null },
        { createdAt: new Date("2026-11-20T11:00:00Z"), expiresAt: new Date("2026-11-26T11:00:00Z") },
        { createdAt: new Date("2026-11-01T11:00:00Z"), expiresAt: new Date("2026-11-25T11:59:00Z") },
      ],
      now,
    );
    expect(state).toEqual({
      secretCreatedAt: "2026-11-25T11:00:00.000Z",
      previousSecretExpiresAt: "2026-11-26T11:00:00.000Z",
      eventType: "invoice.paid",
      filters: [{ pointer: "/status", value: "paid" }],
    });
    expect(routineWebhookState({ webhookEventType: null, webhookFilters: null }, [], now)).toEqual({
      secretCreatedAt: null,
      previousSecretExpiresAt: null,
      eventType: null,
      filters: [],
    });
  });
});

describe("routineTestEventBody", () => {
  it("uses the routine's event type and marks the sample as a test", () => {
    const now = new Date("2026-11-25T12:00:00Z");
    expect(JSON.parse(routineTestEventBody("invoice.paid", now).toString())).toEqual({
      type: "invoice.paid",
      timestamp: "2026-11-25T12:00:00.000Z",
      data: { test: true },
    });
    expect(JSON.parse(routineTestEventBody(null, now).toString()).type).toBe("mycellios.test");
  });
});

describe("POST /api/v1/routines/:routineId/events", () => {
  const secret = createRoutineWebhookSecret();
  function deps(routine: unknown = null) {
    const findFirst = vi.fn(async () => routine);
    const transaction = vi.fn();
    const value = {
      prisma: { routine: { findFirst }, $transaction: transaction },
      secrets: { load: vi.fn(async () => secret) },
      events: { sendUserMessage: vi.fn() },
      jobs: { enqueue: vi.fn() },
    } as unknown as WebhookDeps;
    return { value, findFirst, transaction };
  }
  function app(webhookDeps: WebhookDeps) {
    const hono = new Hono();
    mountRoutineEventRoutes(hono, webhookDeps);
    return hono;
  }
  const routineWithSecret = {
    spaceId: "space-1",
    userId: "user-1",
    webhookSecrets: [{ id: "secret-1", ciphertext: "sealed", spaceId: "space-1", userId: "user-1" }],
  };
  const post = (hono: Hono, headers: Record<string, string>, body: BodyInit, routineId = "routine-1") =>
    hono.request(`/api/v1/routines/${routineId}/events`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body,
    });

  it("refuses an oversized body before looking up the routine", async () => {
    const d = deps(routineWithSecret);
    const response = await post(app(d.value), {}, "x".repeat(WEBHOOK_MAX_BODY_BYTES + 1));
    expect(response.status).toBe(413);
    expect(d.findFirst).not.toHaveBeenCalled();
  });

  it("answers every refusal with the same 401, whether or not the routine exists", async () => {
    const body = Buffer.from('{"type":"ping","data":{}}');
    const stale = String(Math.floor(Date.now() / 1000) - 600);
    const cases: Array<[unknown, Record<string, string>]> = [
      [null, signed(secret, body)],
      [routineWithSecret, signed(createRoutineWebhookSecret(), body)],
      [routineWithSecret, signed(secret, body, "msg_old", stale)],
      [routineWithSecret, {}],
      [{ ...routineWithSecret, webhookSecrets: [] }, signed(secret, body)],
      // A secret row that belongs to someone else is never used.
      [{ ...routineWithSecret, webhookSecrets: [{ ...routineWithSecret.webhookSecrets[0], userId: "other" }] }, signed(secret, body)],
    ];
    const answers = [];
    for (const [routine, headers] of cases) {
      const d = deps(routine);
      const response = await post(app(d.value), headers, body);
      answers.push([response.status, await response.text()]);
      expect(d.transaction).not.toHaveBeenCalled();
    }
    expect(new Set(answers.map((answer) => JSON.stringify(answer)))).toEqual(
      new Set([JSON.stringify([401, '{"error":"Unauthorized"}'])]),
    );
  });

  it("verifies the raw body before parsing it", async () => {
    const body = Buffer.from("not json");
    const forged = await post(app(deps(routineWithSecret).value), signed(createRoutineWebhookSecret(), body), body);
    expect(forged.status).toBe(401);
    const d = deps(routineWithSecret);
    const genuine = await post(app(d.value), signed(secret, body), body);
    expect(genuine.status).toBe(400);
    expect(d.transaction).not.toHaveBeenCalled();
  });
});
