import { UsageDashboardInputSchema } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import { emptyUsageTotals, mergeUsageTotals, normalizeUsageBucket } from "./usage-dashboard.js";

function bucket(input: Partial<Parameters<typeof normalizeUsageBucket>[0]> = {}) {
  return normalizeUsageBucket({
    ...emptyUsageTotals(),
    day: "2026-11-04",
    botId: "a",
    provider: "codex",
    model: "fixture",
    calls: 1,
    pricedCalls: 1,
    input: 100,
    output: 5,
    cacheRead: 200,
    cacheWrite: 10,
    tokens: 115,
    processed: 315,
    inputCount: 1,
    outputCount: 1,
    cacheReadCount: 1,
    cacheWriteCount: 1,
    tokensCount: 1,
    processedCount: 1,
    knownUsd: 0.03,
    confirmedUsd: 0.03,
    ...input,
  });
}
describe("usage dashboard totals", () => {
  it("keeps cache reads outside token totals and cache/reasoning subsets outside additions", () => {
    expect(bucket()).toMatchObject({ tokens: 115, processed: 315, cacheRead: 200, cacheWrite: 10 });
    expect(mergeUsageTotals([bucket(), bucket()])).toMatchObject({
      calls: 2,
      tokens: 230,
      processed: 630,
      knownUsd: 0.06,
    });
  });
  it("retains partial token and money subtotals without treating unknown as free", () => {
    const unknown = bucket({
      pricedCalls: 0,
      knownUsd: 0,
      confirmedUsd: 0,
      pendingCalls: 1,
      input: 0,
      inputCount: 0,
      tokens: 0,
      tokensCount: 0,
    });
    const result = mergeUsageTotals([bucket(), unknown]);
    expect(result).toMatchObject({
      costUsd: null,
      knownUsd: 0.03,
      pendingCalls: 1,
      tokens: null,
      knownTokens: 130,
      input: null,
    });
  });
  it("separates confirmed cost and estimates and preserves legitimate zero observations", () => {
    const estimate = bucket({
      estimatedCalls: 1,
      knownUsd: 0.02,
      estimatedUsd: 0.02,
      confirmedUsd: 0,
    });
    expect(mergeUsageTotals([bucket(), estimate])).toMatchObject({
      knownUsd: 0.05,
      confirmedUsd: 0.03,
      estimatedUsd: 0.02,
      costUsd: 0.05,
    });
    expect(emptyUsageTotals().costUsd).toBe(0);
    expect(bucket({ knownUsd: 0, confirmedUsd: 0 }).costUsd).toBe(0);
  });
  it("bounds ranges and validates viewer zones", () => {
    const from = "2026-01-01T00:00:00Z";
    expect(
      UsageDashboardInputSchema.safeParse({
        from,
        to: "2027-01-01T00:00:00Z",
        timeZone: "Europe/Madrid",
      }).success,
    ).toBe(true);
    expect(
      UsageDashboardInputSchema.safeParse({
        from,
        to: "2028-01-01T00:00:00Z",
        timeZone: "Europe/Madrid",
      }).success,
    ).toBe(false);
    expect(UsageDashboardInputSchema.safeParse({ from, to: from, timeZone: "UTC" }).success).toBe(
      false,
    );
    expect(
      UsageDashboardInputSchema.safeParse({
        from,
        to: "2026-02-01T00:00:00Z",
        timeZone: "invalid/zone",
      }).success,
    ).toBe(false);
  });
});
