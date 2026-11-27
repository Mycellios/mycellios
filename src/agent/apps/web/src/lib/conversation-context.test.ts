import { describe, expect, it } from "vitest";
import { contextMeterState, contextRefreshKey } from "./conversation-context";

const context = (usedTokens: number, contextWindow: number | null) =>
  ({ model: "m", at: "2026-11-27T08:00:00.000Z", usedTokens, contextWindow });

describe("conversation context meter", () => {
  it("stays hidden without a known window or any usage", () => {
    expect(contextMeterState(null)).toBeNull();
    expect(contextMeterState(context(50_000, null))).toBeNull();
    expect(contextMeterState(context(0, 200_000))).toBeNull();
  });

  it("warns as the conversation fills and never passes 100 %", () => {
    expect(contextMeterState(context(50_000, 200_000))).toMatchObject({ percent: 25, level: "ok" });
    expect(contextMeterState(context(150_000, 200_000))).toMatchObject({ percent: 75, level: "high" });
    expect(contextMeterState(context(190_000, 200_000))).toMatchObject({ percent: 95, level: "full" });
    expect(contextMeterState(context(400_000, 200_000))).toMatchObject({ share: 1, percent: 100, level: "full" });
    expect(contextMeterState(context(10, 200_000))?.percent).toBe(1);
  });

  it("refreshes once a turn settles, not on every live event", () => {
    expect(contextRefreshKey(undefined)).toBe("idle");
    expect(contextRefreshKey({ id: "r", status: "running" })).toBe("active:r");
    expect(contextRefreshKey({ id: "r", status: "queued" })).toBe(contextRefreshKey({ id: "r", status: "leased" }));
    expect(contextRefreshKey({ id: "r", status: "completed" })).toBe("settled:r");
  });
});
