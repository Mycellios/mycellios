import { describe, expect, it } from "vitest";
import { jsonPointerValue, routineEventMatch } from "./routine-event-filter.js";

const event = {
  type: "invoice.paid",
  timestamp: "2026-11-25T10:00:00Z",
  data: {
    status: "paid",
    amount: 42,
    live: true,
    note: null,
    "a/b": "slash",
    "m~n": "tilde",
    items: [{ sku: "first" }, { sku: "second" }],
  },
};

describe("jsonPointerValue", () => {
  it("follows RFC 6901 steps through objects and arrays", () => {
    expect(jsonPointerValue(event.data, "/status")).toBe("paid");
    expect(jsonPointerValue(event.data, "/items/1/sku")).toBe("second");
    expect(jsonPointerValue(event.data, "/a~1b")).toBe("slash");
    expect(jsonPointerValue(event.data, "/m~0n")).toBe("tilde");
    expect(jsonPointerValue(event.data, "")).toBe(event.data);
  });

  it("finds nothing outside the document's own keys", () => {
    for (const pointer of ["/missing", "/items/2", "/items/-", "/items/01", "/status/0", "/__proto__", "/constructor", "status"]) {
      expect(typeof jsonPointerValue(event.data, pointer)).toBe("symbol");
    }
  });
});

describe("routineEventMatch", () => {
  const routine = (eventType: string | null, filters: Array<{ pointer: string; value: string | number | boolean | null }> = []) => ({
    eventType,
    filters,
  });

  it("takes any event without a type or filters", () => {
    expect(routineEventMatch(routine(null), event)).toEqual({ ok: true });
    expect(routineEventMatch(routine(null), { data: 1 })).toEqual({ ok: true });
  });

  it("needs the exact event type when the routine names one", () => {
    expect(routineEventMatch(routine("invoice.paid"), event)).toEqual({ ok: true });
    expect(routineEventMatch(routine("invoice.failed"), event)).toEqual({ ok: false, reason: "event_type" });
    expect(routineEventMatch(routine("invoice.paid"), { ...event, type: undefined })).toEqual({
      ok: false,
      reason: "event_type",
    });
  });

  it("needs every filter to find an equal value of the same JSON type in data", () => {
    const all = routine("invoice.paid", [
      { pointer: "/status", value: "paid" },
      { pointer: "/amount", value: 42 },
      { pointer: "/live", value: true },
      { pointer: "/note", value: null },
      { pointer: "/items/0/sku", value: "first" },
    ]);
    expect(routineEventMatch(all, event)).toEqual({ ok: true });
    for (const filter of [
      { pointer: "/amount", value: "42" },
      { pointer: "/live", value: "true" },
      { pointer: "/note", value: "null" },
      { pointer: "/status", value: "Paid" },
      { pointer: "/missing", value: null },
      { pointer: "/items", value: "first" },
    ]) {
      expect(routineEventMatch(routine(null, [filter]), event)).toEqual({ ok: false, reason: "filter" });
    }
  });

  it("refuses filters when the event has no data", () => {
    expect(
      routineEventMatch(routine(null, [{ pointer: "/status", value: "paid" }]), { type: "invoice.paid" }),
    ).toEqual({ ok: false, reason: "filter" });
    expect(routineEventMatch(routine(null, [{ pointer: "/0", value: 1 }]), [1])).toEqual({
      ok: false,
      reason: "filter",
    });
  });
});
