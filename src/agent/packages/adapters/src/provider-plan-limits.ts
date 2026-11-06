import type { AccountPlanLimit, PlanLimitWindow } from "@rakazo/contracts";

// Read-only fixed vendor endpoints. Never send a subscription bearer to a
// user-supplied compatible endpoint, follow redirects, or spend reset credits.
export const CODEX_PLAN_LIMITS_URL = "https://chatgpt.com/backend-api/wham/usage";
export const CLAUDE_PLAN_LIMITS_URL = "https://api.anthropic.com/api/oauth/usage";
const MAX_BYTES = 128 * 1024;
type QuotaValue = Pick<AccountPlanLimit, "status" | "windows" | "plan" | "reason" | "retryAt">;
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function finite(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.slice(0, 160) : null;
}
function iso(value: unknown, seconds = false) {
  const number = seconds ? finite(value) : null;
  const date =
    number !== null ? new Date(number * 1000) : typeof value === "string" ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
function windowValue(
  id: string,
  label: string,
  value: unknown,
  minutes: number | null,
  model: string | null = null,
): PlanLimitWindow | null {
  const raw = record(value);
  if (!raw) return null;
  const used = finite(raw.used_percent ?? raw.utilization);
  if (used === null || used < 0) return null;
  const duration = finite(raw.limit_window_seconds);
  return {
    id,
    label,
    durationMinutes: duration !== null && duration > 0 ? duration / 60 : minutes,
    usedPercent: used,
    resetsAt: iso(raw.reset_at, true) ?? iso(raw.resets_at),
    model,
  };
}
export function parseCodexPlanLimits(value: unknown): Pick<QuotaValue, "windows" | "plan"> {
  const body = record(value);
  const limits = record(body?.rate_limit);
  const windows: PlanLimitWindow[] = [];
  for (const [id, label] of [
    ["primary_window", "Session"],
    ["secondary_window", "Weekly"],
  ]) {
    const entry = windowValue(id!, label!, limits?.[id!], null);
    if (entry) windows.push(entry);
  }
  // Additional model buckets are not another account-wide window. Code review
  // limits are separately named so they cannot become a misleading general ring.
  const review = record(body?.code_review_rate_limit);
  for (const id of ["primary_window", "secondary_window"]) {
    const entry = windowValue(`review:${id}`, "Code review", review?.[id], null, "Code review");
    if (entry) windows.push(entry);
  }
  const additional = Array.isArray(body?.additional_rate_limits) ? body.additional_rate_limits : [];
  for (const [index, item] of additional.slice(0, 12).entries()) {
    const row = record(item);
    const model = text(row?.normal_model_slug) ?? text(row?.limit_name);
    if (!model) continue;
    const rate = record(row?.rate_limit) ?? record(row?.details);
    for (const id of ["primary_window", "secondary_window"]) {
      const entry = windowValue(`model:${index}:${id}`, model, rate?.[id], null, model);
      if (entry) windows.push(entry);
    }
  }
  return { windows: windows.slice(0, 32), plan: text(body?.plan_type) };
}
export function parseClaudePlanLimits(value: unknown): Pick<QuotaValue, "windows" | "plan"> {
  const body = record(value);
  const windows: PlanLimitWindow[] = [];
  for (const [id, label, minutes, model] of [
    ["five_hour", "5 hours", 300, null],
    ["seven_day", "Weekly", 10080, null],
    ["seven_day_opus", "Opus · Weekly", 10080, "Opus"],
    ["seven_day_sonnet", "Sonnet · Weekly", 10080, "Sonnet"],
    ["seven_day_oauth_apps", "OAuth apps · Weekly", 10080, "OAuth apps"],
    ["seven_day_cowork", "Cowork · Weekly", 10080, "Cowork"],
  ] as const) {
    const entry = windowValue(id, label, body?.[id], minutes, model);
    if (entry) windows.push(entry);
  }
  // No guess about plan type, money, or extra paid usage from utilization alone.
  return { windows, plan: null };
}
async function boundedJson(response: Response) {
  if (Number(response.headers.get("content-length")) > MAX_BYTES) {
    await response.body?.cancel();
    throw new Error("invalid_response");
  }
  if (!response.body) throw new Error("invalid_response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        throw new Error("invalid_response");
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new Error("invalid_response");
  }
}
function failed(
  status: QuotaValue["status"],
  reason: QuotaValue["reason"],
  retryAt: string | null = null,
): QuotaValue {
  return { status, reason, retryAt, windows: [], plan: null };
}

export async function readProviderPlanLimits(input: {
  provider: string;
  accessToken: string;
  accountId?: string;
  signal?: AbortSignal;
  fetch?: typeof fetch;
  now?: number;
  timeoutMs?: number;
}): Promise<QuotaValue> {
  const codex = input.provider === "openai-codex";
  const claude = input.provider === "anthropic";
  if (!codex && !claude) return failed("unsupported", "not_reported");
  if (codex && !input.accountId) return failed("unavailable", "permission");
  const now = input.now ?? Date.now();
  const controller = new AbortController();
  const signal = input.signal
    ? AbortSignal.any([controller.signal, input.signal])
    : controller.signal;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<QuotaValue>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(failed("unavailable", "timeout"));
    }, input.timeoutMs ?? 8000);
  });
  const read = async (): Promise<QuotaValue> => {
    try {
      const response = await (input.fetch ?? fetch)(
        codex ? CODEX_PLAN_LIMITS_URL : CLAUDE_PLAN_LIMITS_URL,
        {
          method: "GET",
          redirect: "error",
          signal,
          headers: {
            authorization: `Bearer ${input.accessToken}`,
            accept: "application/json",
            ...(codex
              ? { "chatgpt-account-id": input.accountId!, originator: "mycellios" }
              : { "anthropic-beta": "oauth-2025-04-20" }),
          },
        },
      );
      if (signal.aborted) {
        await response.body?.cancel().catch(() => undefined);
        return failed("unavailable", "timeout");
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        if (response.status === 401) return failed("reconnect", "expired");
        if (response.status === 403) return failed("unavailable", "permission");
        if (response.status === 429) {
          const raw = response.headers.get("retry-after");
          const seconds = raw && /^\d+$/.test(raw) ? Number(raw) : null;
          const date = raw ? Date.parse(raw) : NaN;
          const delay =
            seconds !== null ? seconds * 1000 : Number.isFinite(date) ? date - now : 90000;
          return failed(
            "rate_limited",
            "rate_limit",
            new Date(now + Math.max(60000, Math.min(delay, 3600000))).toISOString(),
          );
        }
        return failed("unavailable", "unreachable");
      }
      const value = await boundedJson(response);
      const parsed = codex ? parseCodexPlanLimits(value) : parseClaudePlanLimits(value);
      return {
        ...parsed,
        status: parsed.windows.length ? "available" : "unsupported",
        reason: parsed.windows.length ? null : "not_reported",
        retryAt: null,
      };
    } catch (error) {
      return failed(
        "unavailable",
        controller.signal.aborted || input.signal?.aborted
          ? "timeout"
          : error instanceof Error && error.message === "invalid_response"
            ? "invalid_response"
            : "unreachable",
      );
    }
  };
  try {
    return await Promise.race([read(), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
    controller.abort();
  }
}
