import { describe, expect, it } from "vitest";
import { evaluate, summarize } from "../../../scripts/memory-recall-bench/evaluate.js";
import { MEMORY_RECALL_BENCH } from "../../../scripts/memory-recall-bench/dataset.js";
import { datasetProblems } from "../../../scripts/memory-recall-bench/validate.js";

/**
 * Recall benchmark guard (specs/mico-memory-graph). The candidate ranker must not fall below
 * the baseline or below its measured result on either split. Raise the floors when a change
 * measurably improves them; tune only on dev. Details: npx tsx scripts/memory-recall-bench/run.ts
 */
const FLOORS = {
  dev: { complete: 55, noisyChitchat: 5 },
  holdout: { complete: 39, noisyChitchat: 3 },
} as const;

describe("memory recall benchmark", () => {
  it("has facts that are literal text of their notes", () => {
    expect(datasetProblems()).toEqual([]);
  });

  it("keeps the candidate ranker at or above the baseline and its measured floor", async () => {
    const baseline = await evaluate(MEMORY_RECALL_BENCH, "baseline");
    const candidate = await evaluate(MEMORY_RECALL_BENCH, "candidate");
    for (const split of ["dev", "holdout"] as const) {
      const before = summarize(baseline.filter((result) => result.split === split));
      const after = summarize(candidate.filter((result) => result.split === split));
      expect(after.complete).toBeGreaterThanOrEqual(Math.max(before.complete, FLOORS[split].complete));
      expect(after.factRecall).toBeGreaterThanOrEqual(before.factRecall);
      expect(after.noisyChitchat).toBeLessThanOrEqual(Math.min(before.noisyChitchat, FLOORS[split].noisyChitchat));
      expect(after.meanBytes).toBeLessThanOrEqual(before.meanBytes);
    }
  });
});
