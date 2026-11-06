import type { AccountPlanLimit, PlanLimitWindow } from "@rakazo/contracts";

export const quotaPreferencesKey = (scope: string) => `mycellios:plan-limits:v1:${scope}`;
export function readQuotaPreferences(scope: string): { accountId: string; autoRefresh: boolean } {
  try {
    const value = JSON.parse(localStorage.getItem(quotaPreferencesKey(scope)) || "null");
    return {
      accountId: typeof value?.accountId === "string" ? value.accountId : "",
      autoRefresh: value?.autoRefresh !== false,
    };
  } catch {
    return { accountId: "", autoRefresh: true };
  }
}
export function remainingQuota(window: PlanLimitWindow) {
  return Math.max(0, Math.min(100, 100 - window.usedPercent));
}
export function freshQuota(account: AccountPlanLimit | undefined, now: number) {
  return (
    !!account &&
    account.status === "available" &&
    !!account.measuredAt &&
    now - Date.parse(account.measuredAt) < 120_000
  );
}
export function usableWindow(window: PlanLimitWindow, now: number) {
  return !window.resetsAt || Date.parse(window.resetsAt) > now;
}
export function ringWindows(account: AccountPlanLimit | undefined, now: number) {
  if (!freshQuota(account, now)) return [];
  return account!.windows
    .filter((window) => !window.model && usableWindow(window, now))
    .sort((a, b) => (b.durationMinutes ?? 0) - (a.durationMinutes ?? 0))
    .slice(0, 2);
}
export function quotaColor(remaining: number) {
  return remaining < 10 ? "var(--destructive)" : remaining < 30 ? "var(--warning)" : "var(--success)";
}
export function providerName(provider: string) {
  return provider === "openai-codex" ? "ChatGPT" : provider === "anthropic" ? "Claude" : provider;
}
