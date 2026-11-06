import { usageSeriesColors } from "@rakazo/ui-tokens";
import type { UsageDashboard } from "@rakazo/contracts";
import { civilDate, dateInZone, shiftDay } from "../schedule/calendar-dates";
export type UsageMetric = "cost" | "tokens";
const providerNames: Record<string, string> = {
  codex: "Codex CLI",
  "openai-codex": "OpenAI Codex",
  "claude-code": "Claude Code",
  openai: "OpenAI",
  anthropic: "Anthropic",
  antseed: "AntSeed",
  "openai-compatible": "OpenAI Compatible",
};
export const providerName = (key: string) =>
  Object.hasOwn(providerNames, key) ? providerNames[key]! : key;
export function usageDayStart(day: string, zone: string): Date {
  let low = civilDate(day).getTime() - 2 * 86_400_000,
    high = civilDate(day).getTime() + 2 * 86_400_000;
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (dateInZone(new Date(mid), zone) < day) low = mid;
    else high = mid;
  }
  return new Date(high);
}
const colors = usageSeriesColors;
export function providerColor(key: string) {
  const known: Record<string, string> = {
    codex: colors[0]!,
    "openai-codex": colors[5]!,
    openai: colors[1]!,
    "openai-compatible": colors[2]!,
    anthropic: colors[4]!,
    "claude-code": colors[3]!,
    antseed: colors[2]!,
  };
  if (Object.hasOwn(known, key)) return known[key]!;
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return colors[hash % colors.length]!;
}
export function usageDays(report: UsageDashboard) {
  const first = dateInZone(new Date(report.from), report.timeZone),
    last = dateInZone(new Date(Date.parse(report.to) - 1), report.timeZone);
  const days: string[] = [];
  for (let day = first; day <= last && days.length < 369; day = shiftDay(day, 1)) days.push(day);
  return days;
}
export function chartSeries(report: UsageDashboard, metric: UsageMetric) {
  const providers = report.byProvider.map((row) => row.id);
  const cells = new Map(
    report.providerDaily.map((row) => [JSON.stringify([row.day, row.provider]), row]),
  );
  return {
    providers,
    rows: usageDays(report).map((day) => ({
      day,
      values: providers.map((provider) => {
        if (report.missingRunDays.includes(day)) return null;
        const row = cells.get(JSON.stringify([day, provider]));
        return row ? (metric === "cost" ? row.costUsd : row.tokens) : 0;
      }),
    })),
  };
}
type Point = { x: number; y: number };
/** Shape-preserving cubic interpolation, split at unknown values before drawing. */
export function monotoneLine(points: Point[]): string {
  if (!points.length) return "";
  if (points.length === 1) return `M${points[0]!.x},${points[0]!.y}`;
  const deltas = points
    .slice(1)
    .map((point, i) => (point.y - points[i]!.y) / (point.x - points[i]!.x));
  const slopes = points.map((_, i) =>
    i === 0
      ? deltas[0]!
      : i === points.length - 1
        ? deltas.at(-1)!
        : deltas[i - 1]! * deltas[i]! <= 0
          ? 0
          : (deltas[i - 1]! + deltas[i]!) / 2,
  );
  for (let i = 0; i < deltas.length; i++) {
    if (!deltas[i]) {
      slopes[i] = 0;
      slopes[i + 1] = 0;
      continue;
    }
    const magnitude = Math.hypot(slopes[i]! / deltas[i]!, slopes[i + 1]! / deltas[i]!);
    if (magnitude > 3) {
      slopes[i] = (slopes[i]! * 3) / magnitude;
      slopes[i + 1] = (slopes[i + 1]! * 3) / magnitude;
    }
  }
  let path = `M${points[0]!.x},${points[0]!.y}`;
  for (let i = 1; i < points.length; i++) {
    const before = points[i - 1]!,
      after = points[i]!,
      dx = (after.x - before.x) / 3;
    path += `C${before.x + dx},${before.y + slopes[i - 1]! * dx} ${after.x - dx},${after.y - slopes[i]! * dx} ${after.x},${after.y}`;
  }
  return path;
}
export function knownSegments(
  values: Array<number | null>,
): Array<Array<{ index: number; value: number }>> {
  const segments: Array<Array<{ index: number; value: number }>> = [];
  let current: Array<{ index: number; value: number }> = [];
  for (const [index, value] of values.entries()) {
    if (value === null) {
      if (current.length) segments.push(current);
      current = [];
    } else current.push({ index, value });
  }
  if (current.length) segments.push(current);
  return segments;
}
