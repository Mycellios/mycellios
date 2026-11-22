// @vitest-environment jsdom
import type { RoutineRunOutcome } from "@mycellios/contracts";
import type { ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RoutineRunBlock } from "../lib/routine-run-groups";
import { RoutineRunMarker } from "./RoutineRunMarker";

vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: ReactNode }) => children,
  Plural: ({ value, one, other }: { value: number; one: string; other: string }) =>
    (value === 1 ? one : other).replace("#", String(value)),
  useLingui: () => ({
    i18n: { locale: "en" },
    t: (strings: TemplateStringsArray, ...values: unknown[]) => String.raw(strings, ...values),
  }),
}));

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const block = (runId: string, outcome: RoutineRunOutcome): RoutineRunBlock => ({
  kind: "routine_run",
  fromBotId: "mico-1",
  routineId: "routine-1",
  routineName: "Morning brief",
  taskId: "routine-thread-1",
  runId,
  status: outcome,
});
const run = (id: string, outcome: RoutineRunOutcome, createdAt = "2026-11-22T08:00:00.000Z") => ({
  id,
  createdAt,
  block: block(`run-${id}`, outcome),
});

function render(runs: ReturnType<typeof run>[]) {
  act(() =>
    root.render(
      <MemoryRouter>
        <RoutineRunMarker runs={runs} locale="en" />
      </MemoryRouter>,
    ),
  );
}

it.each([
  ["reported", "Morning brief ran"],
  ["quiet", "Morning brief ran, nothing new"],
  ["failed", "Morning brief failed"],
  ["paused", "Morning brief ran and paused itself"],
] as const)(
  "shows one %s run as a single line that opens the routine conversation",
  (outcome, text) => {
    render([run("a", outcome)]);
    const line = container.querySelector('[data-testid="routine-run-marker"]');
    expect(line?.getAttribute("data-outcome")).toBe(outcome);
    expect(line?.textContent).toContain(text);
    expect(container.querySelector('[data-testid="routine-run-open"]')?.getAttribute("href")).toBe(
      "/app/mico-1?task=routine-thread-1",
    );
    expect(container.querySelector('[data-testid="routine-run-group-toggle"]')).toBeNull();
  },
);

it("folds consecutive runs into one closed line that lists them when opened", () => {
  render([
    run("a", "reported"),
    run("b", "quiet", "2026-11-22T09:00:00.000Z"),
    run("c", "failed", "2026-11-22T10:00:00.000Z"),
  ]);
  const toggle = container.querySelector<HTMLButtonElement>(
    '[data-testid="routine-run-group-toggle"]',
  );
  expect(toggle?.textContent).toBe("3 runs of Morning brief");
  expect(toggle?.getAttribute("aria-expanded")).toBe("false");
  expect(toggle?.getAttribute("aria-label")).toBe("Show the runs of Morning brief");
  expect(container.querySelector('[data-testid="routine-run-group-list"]')).toBeNull();
  expect(container.querySelectorAll('[data-testid="routine-run-open"]')).toHaveLength(1);
  act(() => toggle?.click());
  expect(toggle?.getAttribute("aria-expanded")).toBe("true");
  const items = [...container.querySelectorAll('[data-testid="routine-run-group-list"] li')];
  expect(items.map((item) => item.getAttribute("data-outcome"))).toEqual([
    "reported",
    "quiet",
    "failed",
  ]);
  expect(items[1]?.textContent).toContain("Morning brief ran, nothing new");
  act(() => toggle?.click());
  expect(container.querySelector('[data-testid="routine-run-group-list"]')).toBeNull();
});
