import type { UsageDashboard } from "@rakazo/contracts";
import { civilDate, dateInZone, shiftDay } from "../schedule/calendar-dates";
import { usageDayStart } from "../usage/usage-chart";

export function profileRange(now: Date, timeZone: string) {
  const today = dateInZone(now, timeZone), first = shiftDay(today, -364);
  return { today, first, input: { from: usageDayStart(first, timeZone).toISOString(), to: usageDayStart(shiftDay(today, 1), timeZone).toISOString(), timeZone } };
}
export function profileActivity(report: UsageDashboard, today: string) {
  const first = shiftDay(today, -364), byDay = new Map(report.daily.map(row => [row.id, row]));
  const missing = new Set(report.missingRunDays);
  const days = Array.from({ length: 365 }, (_, i) => {
    const date = shiftDay(first, i), row = byDay.get(date);
    return { date, tokens: row?.knownProcessed ?? 0, active: Boolean(row?.calls || missing.has(date)), partial: Boolean(missing.has(date) || row?.processed === null) };
  });
  let longest = 0, length = 0, start = "", longestStart = "", longestEnd = "";
  for (const day of days) {
    if (day.active) { if (!length) start = day.date; length++; if (length >= longest) { longest = length; longestStart = start; longestEnd = day.date; } }
    else length = 0;
  }
  let index = days.length - 1;
  if (!days[index]!.active) index--;
  let current = 0, currentStart = "";
  while (index >= 0 && days[index]!.active) { current++; currentStart = days[index--]!.date; }
  const peak = days.filter(day => day.tokens > 0).sort((a, b) => b.tokens - a.tokens || b.date.localeCompare(a.date))[0] ?? null;
  const weekdays = Array<number>(7).fill(0);
  for (const day of days) weekdays[civilDate(day.date).getUTCDay()]! += day.tokens;
  const busiest = Math.max(...weekdays) > 0 ? weekdays.indexOf(Math.max(...weekdays)) : null;
  const rank = <T extends { knownProcessed: number }>(rows: T[]) => [...rows].filter(row => row.knownProcessed > 0).sort((a, b) => b.knownProcessed - a.knownProcessed);
  const padding = civilDate(first).getUTCDay();
  const cells = [...Array<null>(padding).fill(null), ...days];
  while (cells.length % 7) cells.push(null);
  return { days, cells, activeDays: days.filter(day => day.active).length, peak, current, currentStart, longest, longestStart, longestEnd, busiest,
    providers: rank(report.byProvider), models: rank(report.byModel), agents: rank(report.byAgent).filter(row => row.botId !== null),
    partial: report.totals.processed === null || report.missingRuns > 0 || report.totals.incompleteCalls > 0,
    tokens: report.totals.knownProcessed };
}

const escape = (text: string) => text.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[character]!));
/** Only a display name and the reviewed aggregate figures enter this local image. */
export function profileShareSvg(input: { name: string; title: string; subtitle: string; metrics: { label: string; value: string }[]; days: ReturnType<typeof profileActivity>["cells"]; partial: string }) {
  const name = input.name.includes("@") ? "Mycellios" : input.name;
  const max = Math.max(1, ...input.days.map(day => day?.tokens ?? 0));
  const cells = input.days.map((day, i) => day ? `<rect x="${60 + Math.floor(i / 7) * 20}" y="${430 + (i % 7) * 20}" width="15" height="15" rx="4" fill="${day.active ? ["#cae2d3", "#94c7aa", "#58a881", "#25774f"][Math.min(3, Math.floor(day.tokens / max * 3))] : "#e6e5df"}"/>` : "").join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="680" viewBox="0 0 1200 680"><rect width="1200" height="680" rx="28" fill="#f8f5ef"/><g fill="#20352b" font-family="system-ui,sans-serif"><text x="60" y="78" font-size="28" font-weight="600">Mycellios</text><text x="60" y="150" font-size="38" font-weight="600">${escape(name.slice(0, 50))}</text><text x="60" y="194" font-size="22">${escape(input.title)}</text><text x="60" y="230" font-size="18">${escape(input.subtitle)}</text>${input.metrics.slice(0, 5).map((metric, i) => `<text x="${60 + i * 222}" y="310" font-size="16">${escape(metric.label)}</text><text x="${60 + i * 222}" y="355" font-size="29" font-weight="600">${escape(metric.value)}</text>`).join("")}${cells}<text x="60" y="625" font-size="16">${escape(input.partial)}</text></g></svg>`;
}
