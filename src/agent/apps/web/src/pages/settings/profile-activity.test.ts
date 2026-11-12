import { expect, it } from "vitest";
import { profileActivity, profileRange, profileShareSvg } from "./profile-activity";
import { profileReport, profileTotals } from "./profile-test-fixture";
import { dateInZone } from "../schedule/calendar-dates";
it.each(["Europe/Madrid", "Pacific/Kiritimati", "America/New_York"])("uses a 365-day civil range including today across DST in %s", zone => {
  const range = profileRange(new Date("2026-11-12T12:00:00Z"), zone);
  expect(dateInZone(new Date(range.input.from), zone)).toBe(range.first);
  expect(dateInZone(new Date(Date.parse(range.input.to) - 1), zone)).toBe(range.today);
  expect(Date.parse(range.input.to) - Date.parse(range.input.from)).toBeLessThan(367 * 86400000);
  expect(profileActivity(profileReport(), range.today).days).toHaveLength(365);
});
it("keeps yesterday's streak alive and computes the longest span without filling inactive gaps", () => {
  const report = profileReport();
  report.daily = ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-10", "2026-11-11"].map(id => ({ id, name: id, ...profileTotals(10) }));
  const stats = profileActivity(report, "2026-11-12");
  expect(stats.current).toBe(2); expect(stats.currentStart).toBe("2026-11-10"); expect(stats.longest).toBe(3); expect(stats.longestStart).toBe("2026-11-01");
  expect(profileActivity(report, "2026-11-13").current).toBe(0);
});
it("marks missing usage as partial activity without inventing tokens, peaks or rankings", () => {
  const report = profileReport(); report.daily = []; report.byModel = []; report.byProvider = []; report.byAgent = []; report.totals = { ...profileTotals(), processed: null }; report.missingRuns = 1; report.missingRunDays = ["2026-11-12"];
  const stats = profileActivity(report, "2026-11-12");
  expect(stats.partial).toBe(true); expect(stats.peak).toBeNull(); expect(stats.tokens).toBe(0); expect(stats.activeDays).toBe(1); expect(stats.models).toEqual([]);
});
it("ranks recorded processed tokens without modifying API rows or double-counting caches", () => {
  const report = profileReport(); const copy = JSON.stringify(report);
  expect(profileActivity(report, "2026-11-12").tokens).toBe(100); expect(profileActivity(report, "2026-11-12").models[0]!.knownProcessed).toBe(100);
  expect(JSON.stringify(report)).toBe(copy);
});
it("share images escape names and exclude email, identifiers and conversations", () => {
  const input = { name: '<script>alert("x")</script>', title: "Mycellios", subtitle: "Year", metrics: [{ label: "Tokens", value: "100" }], days: profileActivity(profileReport(), "2026-11-12").cells, partial: "Recorded" };
  const svg = profileShareSvg(input); expect(svg).not.toContain("<script>"); expect(svg).toContain("&lt;script&gt;"); expect(svg).not.toContain("href=");
  expect(profileShareSvg({ ...input, name: "private@example.invalid" })).not.toContain("private@example.invalid");
});
