// @vitest-environment jsdom

import type { AccountPlanLimit } from "@mycellios/contracts";
import { describe, expect, it } from "vitest";
import {
  freshQuota,
  quotaColor,
  quotaPreferencesKey,
  readQuotaPreferences,
  remainingQuota,
  ringWindows,
  sameQuotaAccount,
} from "./quota-view";

const now = Date.now();
const account: AccountPlanLimit = {
  credentialId: "one",
  provider: "openai-codex",
  label: "Work",
  authKind: "oauth",
  plan: "plus",
  status: "available",
  checkedAt: new Date(now).toISOString(),
  measuredAt: new Date(now).toISOString(),
  retryAt: null,
  reason: null,
  windows: [
    {
      id: "short",
      label: "Session",
      usedPercent: 85,
      durationMinutes: 300,
      resetsAt: new Date(now + 60000).toISOString(),
      model: null,
    },
    {
      id: "long",
      label: "Weekly",
      usedPercent: 25,
      durationMinutes: 10080,
      resetsAt: null,
      model: null,
    },
    {
      id: "review",
      label: "Review",
      usedPercent: 100,
      durationMinutes: 10080,
      resetsAt: null,
      model: "Code review",
    },
  ],
};
it("puts the long window outside, excludes model buckets and clamps percent", () => {
  expect(ringWindows(account, now).map((w) => w.id)).toEqual(["long", "short"]);
  expect(remainingQuota({ ...account.windows[0]!, usedPercent: 105 })).toBe(0);
  expect(quotaColor(15)).toBe("var(--warning)");
  expect(quotaColor(9)).toBe("var(--destructive)");
});
it("never treats failed, stale or elapsed reset windows as a fresh green allowance", () => {
  expect(ringWindows({ ...account, status: "unavailable" }, now)).toEqual([]);
  expect(freshQuota(account, now + 121000)).toBe(false);
  expect(ringWindows(account, now + 61000).map((w) => w.id)).toEqual(["long"]);
});
it("isolates account choice and automatic refresh per scope, including broken or unavailable storage", () => {
  localStorage.clear();
  localStorage.setItem(
    quotaPreferencesKey("alice/one"),
    JSON.stringify({ accountId: "work", autoRefresh: false }),
  );
  expect(readQuotaPreferences("alice/one")).toEqual({ accountId: "work", autoRefresh: false });
  expect(readQuotaPreferences("bob/one")).toEqual({ accountId: "", autoRefresh: true });
  localStorage.setItem(quotaPreferencesKey("alice/one"), "{");
  expect(readQuotaPreferences("alice/one").autoRefresh).toBe(true);
});

describe("the PC's own Codex beside a saved ChatGPT account", () => {
  const account = (credentialId: string, usedPercent: number, resetsAt: string) => ({
    credentialId, provider: "openai-codex", label: "ChatGPT", authKind: "oauth", status: "available",
    windows: [{ id: "secondary_window", label: "Weekly", durationMinutes: 10080, usedPercent, resetsAt, model: null }],
    plan: null, checkedAt: new Date().toISOString(), measuredAt: new Date().toISOString(), retryAt: null, reason: null,
  }) as AccountPlanLimit;
  it("is the same account when its use and reset match, and another one when they differ", () => {
    const saved = account("saved", 100, "2026-11-29T13:00:00.000Z");
    expect(sameQuotaAccount(saved, account("native", 100, "2026-11-29T13:00:40.000Z"))).toBe(true);
    expect(sameQuotaAccount(saved, account("native", 40, "2026-11-29T13:00:00.000Z"))).toBe(false);
    expect(sameQuotaAccount(saved, account("native", 100, "2026-12-01T13:00:00.000Z"))).toBe(false);
  });
});
