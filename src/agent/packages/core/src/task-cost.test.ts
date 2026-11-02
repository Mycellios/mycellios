import { describe, expect, it } from "vitest";
import type { TaskCostRow } from "./task-cost.js";
import { formatTaskCostAmount, summarizeTaskCost, taskCostMessageId } from "./task-cost.js";

const row = (
  id: string,
  costUsd: number | null,
  extra: Partial<TaskCostRow> = {},
): TaskCostRow => ({
  id,
  runId: "root",
  parentRunId: "root",
  costUsd,
  costSource: "provider-reported",
  usageSource: "provider-reported-via-pi",
  ...extra,
});
describe("task cost totals", () => {
  it("includes intermediate, retried and nested calls only once", () => {
    const a = row("a", 0.001),
      b = row("b", 0.002, { runId: "child" }),
      c = row("c", 0.003, { runId: "grandchild", parentRunId: "child" });
    expect(
      summarizeTaskCost("root", "completed", [
        a,
        b,
        c,
        a,
        row("other", 99, { runId: "other", parentRunId: "other" }),
      ]),
    ).toMatchObject({ state: "confirmed", amountUsd: 0.006, modelCalls: 3, unpricedCalls: 0 });
  });
  it("keeps a confirmed free task distinct from missing cost", () => {
    expect(summarizeTaskCost("root", "completed", [row("a", 0)])).toMatchObject({
      state: "confirmed",
      amountUsd: 0,
    });
    expect(summarizeTaskCost("root", "completed", [row("a", null)])).toMatchObject({
      state: "unavailable",
      amountUsd: null,
    });
    expect(summarizeTaskCost("root", "completed", [])).toMatchObject({
      state: "unavailable",
      amountUsd: null,
    });
  });
  it("does not call an incomplete or unproven zero total free", () => {
    expect(summarizeTaskCost("root", "completed", [row("a", 0.3), row("b", null)])).toMatchObject({
      state: "unavailable",
      amountUsd: null,
      unpricedCalls: 1,
    });
    expect(
      summarizeTaskCost("root", "completed", [row("a", 0, { costSource: null })]).amountUsd,
    ).toBeNull();
  });
  it("labels estimates, running work and delayed settlement", () => {
    expect(
      summarizeTaskCost("root", "completed", [
        row("a", 0.2, { costSource: "pi-catalog-estimate" }),
      ]),
    ).toMatchObject({ state: "estimated", amountUsd: 0.2 });
    expect(summarizeTaskCost("root", "running", [row("a", 0.2)])).toMatchObject({
      state: "pending",
      amountUsd: null,
    });
    expect(
      summarizeTaskCost("root", "completed", [row("a", null, { costPending: true })]).state,
    ).toBe("pending");
    expect(
      summarizeTaskCost("root", "completed", [
        row("a", null),
        row("other", null, { runId: "other", parentRunId: "other", costPending: true }),
      ]).state,
    ).toBe("unavailable");
  });
  it.each([NaN, Infinity, -1])("refuses invalid cost %s", (cost) =>
    expect(summarizeTaskCost("root", "failed", [row("a", cost)]).amountUsd).toBeNull(),
  );
  it("retains sub-micro amounts instead of rounding them to zero", () => {
    expect(summarizeTaskCost("root", "completed", [row("a", 1e-8)]).amountUsd).toBe(1e-8);
    expect(formatTaskCostAmount(1e-8, "en-US")).toBe("<$0.000001");
    expect(formatTaskCostAmount(0, "en-US")).toBe("$0.00");
  });
  it("attaches one total to the last persisted assistant reply per task", () => {
    const blocks = [{ kind: "text" }];
    const ids = taskCostMessageId([
      { id: "a", role: "bot", runId: "root", blocks },
      { id: "user", role: "user", runId: "root", blocks },
      { id: "b", role: "bot", runId: "root", blocks },
      { id: "progress:root", role: "bot", runId: "root", blocks },
    ]);
    expect([...ids]).toEqual([["root", "b"]]);
  });
});
