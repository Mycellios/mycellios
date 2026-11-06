import { describe, expect, it } from "vitest";
import {
  calendarDays,
  calendarRange,
  clockChange,
  dateInZone,
  shiftDay,
  shiftMonth,
} from "./calendar-dates";

describe("schedule calendar civil dates", () => {
  it("starts weeks on Monday, including a year boundary", () => {
    expect(calendarDays("2026-11-04", "week")).toEqual([
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
      "2026-11-06",
      "2026-11-07",
      "2026-11-08",
    ]);
    expect(calendarDays("2027-01-01", "week")[0]).toBe("2026-12-28");
  });
  it("fills the complete month without leaking the anchor day into the next month", () => {
    expect(calendarDays("2026-03-31", "month")).toHaveLength(42);
    expect(shiftMonth("2026-03-31", -1)).toBe("2026-02-01");
    expect(calendarDays("2027-02-28", "month")).toHaveLength(28);
  });
  it("keeps leap days and DST transitions as single civil days", () => {
    expect(shiftDay("2028-02-28", 1)).toBe("2028-02-29");
    expect(shiftDay("2026-03-29", 1)).toBe("2026-03-30");
    expect(clockChange(calendarDays("2026-03-29", "week"), "Europe/Madrid")).toBe("2026-03-29");
    expect(clockChange(calendarDays("2026-10-25", "week"), "Europe/Madrid")).toBe("2026-10-25");
    expect(clockChange(calendarDays("2026-11-04", "week"), "Europe/Madrid")).toBeUndefined();
  });
  it("places instants in the viewer zone and pads range edges for extreme offsets", () => {
    expect(dateInZone(new Date("2026-11-04T23:30:00Z"), "Europe/Madrid")).toBe("2026-11-05");
    expect(dateInZone(new Date("2026-11-04T01:00:00Z"), "America/Los_Angeles")).toBe("2026-11-03");
    expect(calendarRange(["2026-11-04"])).toEqual({
      from: "2026-11-03T00:00:00Z",
      to: "2026-11-06T00:00:00Z",
    });
  });
});
