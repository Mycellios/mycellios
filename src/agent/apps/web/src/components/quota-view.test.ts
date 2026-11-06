// @vitest-environment jsdom

import type { AccountPlanLimit } from "@rakazo/contracts";
import { expect, it } from "vitest";
import {
  freshQuota,
  quotaColor,
  quotaPreferencesKey,
  readQuotaPreferences,
  remainingQuota,
  ringWindows,
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
