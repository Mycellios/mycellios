import type { TaskCost } from "@rakazo/contracts";

export type TaskCostRow = {
  id: string;
  runId: string | null;
  parentRunId: string | null;
  costUsd: number | null;
  costSource: string | null;
  usageSource: string | null;
  costPending?: boolean;
};

/** Descendants and intermediate model calls count once, including failed attempts. */
export function summarizeTaskCost(runId: string, status: string, rows: TaskCostRow[]): TaskCost {
  const descendants = new Set([runId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows)
      if (
        row.parentRunId &&
        descendants.has(row.parentRunId) &&
        row.runId &&
        !descendants.has(row.runId)
      ) {
        descendants.add(row.runId);
        changed = true;
      }
  }
  const unique = new Map(
    rows
      .filter(
        (row) =>
          (row.runId && descendants.has(row.runId)) ||
          (row.parentRunId && descendants.has(row.parentRunId)),
      )
      .map((row) => [row.id, row]),
  );
  let amount = 0;
  let unpriced = 0;
  let estimated = false;
  let pending = false;
  for (const row of unique.values()) {
    const real =
      row.costSource === "provider-reported" ||
      (row.costUsd === 0 && ["provider-rejected", "not-started"].includes(row.usageSource ?? ""));
    const estimate = row.costSource === "pi-catalog-estimate";
    if (
      row.costUsd === null ||
      !Number.isFinite(row.costUsd) ||
      row.costUsd < 0 ||
      (!real && !estimate)
    ) {
      unpriced++;
      pending ||= row.costPending === true;
      continue;
    }
    amount += row.costUsd;
    estimated ||= !real;
  }
  const active = !["completed", "failed", "cancelled"].includes(status);
  const complete = unique.size > 0 && unpriced === 0 && Number.isFinite(amount);
  return {
    runId,
    state:
      active || pending
        ? "pending"
        : !complete
          ? "unavailable"
          : estimated
            ? "estimated"
            : "confirmed",
    amountUsd: !active && complete ? Number(amount.toPrecision(12)) : null,
    modelCalls: unique.size,
    unpricedCalls: unpriced,
  };
}

export function formatTaskCostAmount(amount: number, locale: string): string {
  const format = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
  return amount > 0 && amount < 0.000001 ? "<" + format.format(0.000001) : format.format(amount);
}

export function taskCostMessageId(
  messages: ReadonlyArray<{
    id: string;
    role: string;
    runId?: string;
    blocks: ReadonlyArray<{ kind: string }>;
  }>,
): Map<string, string> {
  const last = new Map<string, string>();
  for (const message of messages)
    if (
      message.role === "bot" &&
      message.runId &&
      !message.id.startsWith("progress:") &&
      message.blocks.some((b) => b.kind === "text")
    )
      last.set(message.runId, message.id);
  return last;
}
