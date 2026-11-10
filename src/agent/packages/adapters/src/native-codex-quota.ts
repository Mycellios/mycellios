import type { AccountPlanLimit, PlanLimitWindow } from "@rakazo/contracts";

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
/** Allowlist quota metadata only; never forward CLI account identity or credentials. */
export function nativeCodexQuota(value: unknown, now = Date.now()): AccountPlanLimit | null {
  const limits = record(record(value).rateLimits);
  const windows: PlanLimitWindow[] = [];
  for (const id of ["primary", "secondary"] as const) {
    const row = record(limits[id]);
    if (typeof row.usedPercent !== "number" || !Number.isFinite(row.usedPercent) || row.usedPercent < 0) continue;
    const duration = typeof row.windowDurationMins === "number" && Number.isFinite(row.windowDurationMins) && row.windowDurationMins > 0 ? row.windowDurationMins : null;
    const reset = typeof row.resetsAt === "number" ? new Date(row.resetsAt * 1000) : null;
    windows.push({ id, label: duration === 10080 ? "Weekly" : "Session", usedPercent: row.usedPercent,
      durationMinutes: duration, resetsAt: reset && Number.isFinite(reset.getTime()) ? reset.toISOString() : null, model: null });
  }
  if (!windows.length) return null;
  const stamp = new Date(now).toISOString();
  return { credentialId: "native:codex", provider: "openai-codex", label: "ChatGPT", authKind: "oauth",
    status: "available", plan: typeof limits.planType === "string" ? limits.planType.slice(0, 160) : null,
    windows, checkedAt: stamp, measuredAt: stamp, retryAt: null, reason: null };
}
