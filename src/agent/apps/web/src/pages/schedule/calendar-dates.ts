export type CalendarView = "day" | "week" | "month";
const DAY = 86_400_000;
const formatters = new Map<string, Intl.DateTimeFormat>();
export function dateInZone(instant: Date, timeZone: string): string {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    if (formatters.size > 8) formatters.clear();
    formatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(instant);
  const part = (type: string) => parts.find((item) => item.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export const civilDate = (day: string) => new Date(`${day}T12:00:00Z`);
export function shiftDay(day: string, count: number): string {
  return new Date(civilDate(day).getTime() + count * DAY).toISOString().slice(0, 10);
}
export function shiftMonth(day: string, count: number): string {
  const date = civilDate(day);
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + count);
  return date.toISOString().slice(0, 10);
}
export function calendarDays(anchor: string, view: CalendarView): string[] {
  if (view === "day") return [anchor];
  const start = view === "month" ? `${anchor.slice(0, 7)}-01` : anchor;
  const first = shiftDay(start, -((civilDate(start).getUTCDay() + 6) % 7));
  const last = view === "week" ? shiftDay(first, 6) : shiftDay(shiftMonth(start, 1), -1);
  const count =
    view === "week"
      ? 7
      : Math.ceil(
          (Math.round((civilDate(last).getTime() - civilDate(first).getTime()) / DAY) + 1) / 7,
        ) * 7;
  return Array.from({ length: count }, (_, index) => shiftDay(first, index));
}
export function calendarRange(days: string[]) {
  // Civil days at UTC+14/UTC-12 cross UTC midnight. The server reads a padded
  // range and the UI groups exact instants in the viewer's zone.
  return {
    from: `${shiftDay(days[0]!, -1)}T00:00:00Z`,
    to: `${shiftDay(days.at(-1)!, 2)}T00:00:00Z`,
  };
}
export function clockChange(days: string[], timeZone: string): string | undefined {
  const offset = (day: string) =>
    new Intl.DateTimeFormat("en", { timeZone, timeZoneName: "longOffset" })
      .formatToParts(civilDate(day))
      .find((part) => part.type === "timeZoneName")?.value;
  return days.find((day) => offset(day) !== offset(shiftDay(day, -1)));
}
