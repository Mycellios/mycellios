/** Operator-configured model budgets. Unlisted models keep the global deadline. */
export function parseModelRequestTimeouts(value: string | undefined): Record<string, number> {
  if (!value?.trim()) return {};
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid model request deadlines");
  const entries = Object.entries(parsed);
  if (entries.length > 100 || entries.some(([model, ms]) => !model.trim() || model.length > 256
    || ["__proto__", "constructor", "prototype"].includes(model)
    || typeof ms !== "number" || !Number.isSafeInteger(ms) || ms < 1_000 || ms > 3_600_000)) {
    throw new Error("Invalid model request deadlines");
  }
  return Object.fromEntries(entries);
}

export function modelRequestTimeout(model: string, budgets: Readonly<Record<string, number>> | undefined, fallback: number): number {
  return budgets && Object.hasOwn(budgets, model) ? budgets[model]! : fallback;
}

/** Preserve explicit client deadlines, including shorter cancellation budgets. */
export function withModelRequestDeadline(body: unknown, budgets: Readonly<Record<string, number>> | undefined): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const input = body as Record<string, unknown>;
  if (typeof input.model !== "string" || input.deadline_ms !== undefined || !budgets || !Object.hasOwn(budgets, input.model)) return body;
  return { ...input, deadline_ms: budgets[input.model] };
}
