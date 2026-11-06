import type { UsageDashboard } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import {
  chartSeries,
  knownSegments,
  monotoneLine,
  providerName,
  usageDayStart,
} from "./usage-chart";

describe("usage chart", () => {
  it("renders unknown provider identifiers as text, including object property names", () => {
    expect(providerName("__proto__")).toBe("__proto__");
    expect(providerName("constructor")).toBe("constructor");
  });
  it("uses real local day boundaries through daylight-saving time and extreme offsets", () => {
    expect(usageDayStart("2026-03-29", "Europe/Madrid").toISOString()).toBe(
      "2026-03-28T23:00:00.000Z",
    );
    expect(usageDayStart("2026-03-30", "Europe/Madrid").toISOString()).toBe(
      "2026-03-29T22:00:00.000Z",
    );
    expect(usageDayStart("2026-10-26", "Europe/Madrid").toISOString()).toBe(
      "2026-10-25T23:00:00.000Z",
    );
    expect(usageDayStart("2026-11-04", "Pacific/Kiritimati").toISOString()).toBe(
      "2026-11-03T10:00:00.000Z",
    );
  });
  it("draws gaps for unknown prices and missing runs, and zero only for an absent provider cell", () => {
    const report = {
      from: "2026-11-01T00:00:00Z",
      to: "2026-11-04T00:00:00Z",
      timeZone: "UTC",
      byProvider: [{ id: "a" }],
      providerDaily: [{ day: "2026-11-02", provider: "a", costUsd: null, tokens: 4 }],
      missingRunDays: ["2026-11-03"],
    } as UsageDashboard;
    expect(chartSeries(report, "cost").rows.map((row) => row.values[0])).toEqual([0, null, null]);
    expect(chartSeries(report, "tokens").rows.map((row) => row.values[0])).toEqual([0, 4, null]);
    expect(knownSegments([0, null, 3, 4, null, 0])).toHaveLength(3);
  });
  it("keeps flat sections flat instead of overshooting a cost spike", () => {
    expect(
      monotoneLine([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 3 },
        { x: 3, y: 0 },
        { x: 4, y: 0 },
      ]),
    ).toContain("C0.3333333333333333,0");
    expect(monotoneLine([])).toBe("");
    expect(monotoneLine([{ x: 2, y: 4 }])).toBe("M2,4");
  });
});
