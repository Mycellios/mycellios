import type { Routine } from "@mycellios/contracts";
import { expect, it } from "vitest";
import { NEW_ROUTINE_LINK, routineLinkTarget } from "./routine-link.js";

const saved = { id: "routine-1", botId: "mico", name: "Morning briefing" } as Routine;

it("opens a new draft from the Schedule without waiting for the saved list", () => {
  expect(routineLinkTarget(NEW_ROUTINE_LINK, null)).toEqual({ routine: undefined });
  expect(routineLinkTarget(NEW_ROUTINE_LINK, [saved])).toEqual({ routine: undefined });
});

it("waits for the Mico's routines, then opens the same saved routine", () => {
  expect(routineLinkTarget(saved.id, null)).toBeNull();
  expect(routineLinkTarget(saved.id, [saved])).toEqual({ routine: saved });
});

it("reports a deleted routine as missing", () => {
  expect(routineLinkTarget(saved.id, [])).toBe("missing");
});
