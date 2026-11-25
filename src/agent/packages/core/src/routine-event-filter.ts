import type {
  RoutineEventFilter,
  RoutineEventFilterValue,
  RoutineEventIgnoredReason,
} from "@mycellios/contracts";

const MISSING = Symbol("missing");

/** The value a JSON Pointer (RFC 6901) names in `document`, reading only its own keys. */
export function jsonPointerValue(document: unknown, pointer: string): unknown {
  if (pointer === "") return document;
  if (!pointer.startsWith("/")) return MISSING;
  let current = document;
  for (const raw of pointer.slice(1).split("/")) {
    const key = raw.replaceAll("~1", "/").replaceAll("~0", "~");
    if (Array.isArray(current)) {
      if (!/^(?:0|[1-9][0-9]*)$/.test(key)) return MISSING;
      const index = Number(key);
      if (index >= current.length) return MISSING;
      current = current[index];
    } else if (current !== null && typeof current === "object") {
      if (!Object.hasOwn(current, key)) return MISSING;
      current = (current as Record<string, unknown>)[key];
    } else {
      return MISSING;
    }
  }
  return current;
}

/** Equal as JSON values of the same type: "1" never matches 1, and objects never match. */
function sameJsonValue(actual: unknown, expected: RoutineEventFilterValue): boolean {
  if (expected === null) return actual === null;
  return typeof actual === typeof expected && actual === expected;
}

/**
 * Whether a signed event reaches the routine: its `type` must be the routine's event type when
 * one is set, and every filter must find its value in `data`. Decided before any run starts.
 */
export function routineEventMatch(
  routine: { eventType: string | null; filters: readonly RoutineEventFilter[] },
  payload: unknown,
): { ok: true } | { ok: false; reason: Exclude<RoutineEventIgnoredReason, "paused"> } {
  const event =
    payload !== null && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};
  if (routine.eventType !== null && event.type !== routine.eventType) {
    return { ok: false, reason: "event_type" };
  }
  const data = Object.hasOwn(event, "data") ? event.data : MISSING;
  for (const filter of routine.filters) {
    const actual = data === MISSING ? MISSING : jsonPointerValue(data, filter.pointer);
    if (actual === MISSING || !sameJsonValue(actual, filter.value)) {
      return { ok: false, reason: "filter" };
    }
  }
  return { ok: true };
}
