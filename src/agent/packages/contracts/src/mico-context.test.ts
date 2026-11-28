import { describe, expect, it } from "vitest";
import {
  isSmallMicoContext,
  knownModelContextWindow,
  MAX_MODEL_CONTEXT_WINDOW,
  MICO_MIN_CONTEXT_TOKENS,
  ModelCatalogEntrySchema,
} from "./domain.js";

const entry = { provider: "p", id: "m", label: "M", billing: "b" };

describe("Mico minimum context", () => {
  it("covers the measured Mico prompt (about 27,700 tokens) with headroom", () => {
    expect(MICO_MIN_CONTEXT_TOKENS).toBe(32_000);
    expect(MICO_MIN_CONTEXT_TOKENS).toBeGreaterThan(27_700);
  });

  it("flags only a known window below the threshold", () => {
    expect(isSmallMicoContext(8_192)).toBe(true);
    expect(isSmallMicoContext(MICO_MIN_CONTEXT_TOKENS - 1)).toBe(true);
    expect(isSmallMicoContext(1)).toBe(true);
  });

  it("does not flag the threshold itself or anything larger", () => {
    expect(isSmallMicoContext(MICO_MIN_CONTEXT_TOKENS)).toBe(false);
    expect(isSmallMicoContext(MICO_MIN_CONTEXT_TOKENS + 1)).toBe(false);
    expect(isSmallMicoContext(1_000_000)).toBe(false);
  });

  it("never flags an unknown or unusable window", () => {
    for (const value of [undefined, null, 0, -1, 12.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(isSmallMicoContext(value as number | null | undefined), String(value)).toBe(false);
    }
  });

  it("accepts only a positive whole number within range as a known window", () => {
    expect(knownModelContextWindow(32_000)).toBe(32_000);
    expect(knownModelContextWindow(MAX_MODEL_CONTEXT_WINDOW)).toBe(MAX_MODEL_CONTEXT_WINDOW);
    for (const value of [undefined, null, "32000", 0, -5, 1.5, MAX_MODEL_CONTEXT_WINDOW + 1]) {
      expect(knownModelContextWindow(value), String(value)).toBeUndefined();
    }
  });
});

describe("catalog entry context window", () => {
  it("stays compatible with entries that do not carry one", () => {
    const parsed = ModelCatalogEntrySchema.parse(entry);
    expect(parsed).not.toHaveProperty("contextWindow");
  });

  it("keeps a reported window and rejects an invalid one", () => {
    expect(ModelCatalogEntrySchema.parse({ ...entry, contextWindow: 16_384 }).contextWindow).toBe(16_384);
    expect(ModelCatalogEntrySchema.safeParse({ ...entry, contextWindow: 0 }).success).toBe(false);
    expect(ModelCatalogEntrySchema.safeParse({ ...entry, contextWindow: 1.5 }).success).toBe(false);
  });
});
