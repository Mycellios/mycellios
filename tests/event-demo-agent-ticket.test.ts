import { expect, it } from "vitest";
import { openEventAgentTicket, sealEventAgentTicket } from "../src/core/event-demo-agent-ticket.js";
import { eventAgentAccess } from "../src/coordinator/event-demo-agent-access.js";

const now = Date.now(), key = "ab".repeat(32), guest = "12345678-1234-4234-8234-123456789012";
const value = { event: "test-only-event", guest, accountId: `demo:test-only-event:${guest}`, name: "Invitado 01",
  endsAt: now + 3600_000, issuedAt: now, origin: "https://example.invalid",
  model: "mycellios/managed/antseed/deepseek-v4-flash" as const, apiKey: "myc_live_abcdefghij_" + "a".repeat(43) };
it("encrypts the bounded handoff and rejects tampering, wrong origin/key, stale tickets and extended events", () => {
  const ticket = sealEventAgentTicket(key, value);
  expect(ticket).not.toContain(value.apiKey);
  expect(openEventAgentTicket(key, ticket, value.origin, now)).toEqual(value);
  for (const run of [() => openEventAgentTicket("cd".repeat(32), ticket, value.origin, now),
    () => openEventAgentTicket(key, ticket, "https://elsewhere.invalid", now),
    () => openEventAgentTicket(key, ticket, value.origin, now + 60_001),
    () => openEventAgentTicket(key, "x" + ticket.slice(1), value.origin, now),
    () => openEventAgentTicket(key, sealEventAgentTicket(key, { ...value, endsAt: now + 49 * 3600_000 }), value.origin, now),
    () => openEventAgentTicket(key, sealEventAgentTicket(key, { ...value, accountId: "another-account" }), value.origin, now)]) expect(run).toThrow();
});
it("restricts native event keys to their existing guest, model, time window and read/payment-safe routes", async () => {
  const config = { id: value.event, startsAt: now - 1000, endsAt: value.endsAt, model: value.model } as never;
  const db = { raw: { prepare: () => ({ get: async () => ({ id: guest }) }) } } as never;
  const principal = { userId: value.accountId, apiKeyId: "demo-agent:" + guest };
  const request = { url: "/v1/chat/completions", method: "POST", body: { model: value.model } };
  expect(await eventAgentAccess(config, db, principal, request, now)).toBe(true);
  for (const update of [{ url: "/v1/api-keys" }, { url: "/v1/admin" }, { body: { model: "unfunded-model" } },
    { method: "DELETE" }, { url: "/v1/managed/models", method: "GET" }])
    expect(await eventAgentAccess(config, db, principal, { ...request, ...update }, now)).toBe(false);
  expect(await eventAgentAccess(config, db, principal, request, value.endsAt)).toBe(false);
  expect(await eventAgentAccess(undefined, db, principal, request, now)).toBe(false);
  expect(await eventAgentAccess(config, db, { ...principal, apiKeyId: "ordinary-key" }, request, now)).toBe(false);
  expect(await eventAgentAccess(undefined, db, { userId: "ordinary-account", apiKeyId: "ordinary-key" }, request, now)).toBe(true);
});
