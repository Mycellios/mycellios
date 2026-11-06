import { i18n } from "@lingui/core";
import type { Routine } from "@rakazo/contracts";
import { expect, it, vi } from "vitest";
vi.mock("@lingui/react/macro", () => ({ useLingui: () => ({ i18n }), Trans: () => null }));
import { routineDiagramSummary } from "./routine-summary";

const routine = { id: "routine", crons: ["@once"], active: false, timezone: "Europe/Madrid", nextRunAt: null, lastRunAt: "2026-11-02T09:55:00Z" } as Routine;
it("shows a one-shot's real time in its own timezone even after it is paused", () => {
  i18n.load("es", { "One-time schedule": "Una vez" }); i18n.activate("es");
  const summary = routineDiagramSummary(routine, "es");
  expect(summary).toContain("One-time schedule");
  expect(summary).toContain("10:55");
  expect(summary).not.toContain("09:55");
});
it("uses the same schedule descriptions as the routine editor", () => {
  i18n.load("es", { "Weekdays": "Días laborables", "at {0}": "a las {0}" }); i18n.activate("es");
  expect(routineDiagramSummary({ ...routine, crons: ["0 9 * * 1-5"] }, "es")).toContain("Weekdays");
});
it("keeps external and change triggers visible instead of inventing a schedule", () => {
  i18n.load("en", {}); i18n.activate("en");
  expect(routineDiagramSummary({ ...routine, crons: [], webhookEnabled: true, watch: {} as Routine["watch"] }, "en")).toContain("When a webhook fires");
  expect(routineDiagramSummary({ ...routine, crons: [], webhookEnabled: true, watch: {} as Routine["watch"] }, "en")).toContain("When something changes");
});
