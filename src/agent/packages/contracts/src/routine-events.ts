import * as z from "zod";
import { Id, IsoDate } from "./ids.js";

/**
 * Signed webhook routines (specs/mico-automation phase 2): each webhook routine has its own URL
 * and a Standard Webhooks secret. Events are signed over `id.timestamp.body`.
 */

/** A routine checks at most this many filters on each event. */
export const ROUTINE_EVENT_FILTER_MAX = 32;
/** A routine accepts at most this many events in any hour; the next one is refused with 429. */
export const ROUTINE_EVENTS_PER_HOUR = 60;
/** How long a delivery id is remembered, so a repeat starts nothing. */
export const ROUTINE_EVENT_RECEIPT_DAYS = 7;
/** A rotated secret keeps working this long, so senders can switch without missing events. */
export const ROUTINE_WEBHOOK_PREVIOUS_SECRET_HOURS = 24;
/** A signed event's timestamp may be this far from the server's clock, either way. */
export const ROUTINE_EVENT_TOLERANCE_SECONDS = 5 * 60;

/** The URL path a routine's signed events are posted to. */
export function routineEventsPath(routineId: string): string {
  return `/api/v1/routines/${encodeURIComponent(routineId)}/events`;
}

/** A JSON Pointer (RFC 6901) into the event's `data`, with at least one step. */
export const RoutineEventPointerSchema = z
  .string()
  .max(256)
  .regex(/^(?:\/(?:[^~/]|~[01])*)+$/, "Use a JSON Pointer such as /status");

/** The value a filter wants, compared as JSON: "1" never matches 1. */
export const RoutineEventFilterValueSchema = z.union([
  z.string().max(1_000),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
export type RoutineEventFilterValue = z.infer<typeof RoutineEventFilterValueSchema>;

export const RoutineEventFilterSchema = z.object({
  pointer: RoutineEventPointerSchema,
  value: RoutineEventFilterValueSchema,
});
export type RoutineEventFilter = z.infer<typeof RoutineEventFilterSchema>;

export const RoutineEventFiltersSchema = z.array(RoutineEventFilterSchema).max(ROUTINE_EVENT_FILTER_MAX);

/** The Standard Webhooks `type` a routine waits for, such as invoice.paid. */
export const RoutineEventTypeSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[\x21-\x7e]+$/, "Use the event type exactly as the sender writes it");

/** Why a signed event started nothing; shown in the routine's history. */
export const ROUTINE_EVENT_IGNORED_REASONS = ["event_type", "filter", "paused"] as const;
export type RoutineEventIgnoredReason = (typeof ROUTINE_EVENT_IGNORED_REASONS)[number];

/** A routine's signed webhook as the app sees it. The secret itself is shown only once. */
export const RoutineWebhookStateSchema = z.object({
  /** When the current secret was created; null until one is created or after Revoke. */
  secretCreatedAt: IsoDate.nullable(),
  /** The secret replaced by the last rotation still works until this time. */
  previousSecretExpiresAt: IsoDate.nullable(),
  eventType: z.string().nullable(),
  filters: RoutineEventFiltersSchema,
});
export type RoutineWebhookState = z.infer<typeof RoutineWebhookStateSchema>;

/** A signed event that started nothing, from the routine's 7-day receipts. */
export const RoutineIgnoredEventSchema = z.object({
  id: Id,
  receivedAt: IsoDate,
  reason: z.enum(ROUTINE_EVENT_IGNORED_REASONS),
});
export type RoutineIgnoredEvent = z.infer<typeof RoutineIgnoredEventSchema>;
