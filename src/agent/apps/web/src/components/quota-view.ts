import type { AccountPlanLimit, PlanLimitWindow } from "@mycellios/contracts";

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
/**
 * The PC's own Codex reports no account identity. When its account-wide windows match a saved
 * account of the same provider (same use and reset), it is that account: show it once.
 */
export function sameQuotaAccount(saved: AccountPlanLimit, native: AccountPlanLimit, now = Date.now()) {
  // A stale saved reading keeps the PC's fresher one visible.
  if (saved.provider !== native.provider || !freshQuota(saved, now) || native.status !== "available") return false;
  const general = native.windows.filter(window => !window.model);
  return general.length > 0 && general.every(window => saved.windows.some(other =>
    !other.model && other.durationMinutes === window.durationMinutes &&
    Math.abs(other.usedPercent - window.usedPercent) < 1 &&
    (other.resetsAt === window.resetsAt ||
      Math.abs(Date.parse(other.resetsAt ?? "") - Date.parse(window.resetsAt ?? "")) <= 120_000)));
}
export function providerName(provider: string) {
  return provider === "openai-codex" ? "ChatGPT" : provider === "anthropic" ? "Claude"
    : provider === "opencode-go" || provider === "opencode" ? "OpenCode" : provider;
}
