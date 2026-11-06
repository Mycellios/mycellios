import { afterEach, describe, expect, it, vi } from "vitest";
import type { Routine, RoutineRun } from "@rakazo/contracts";
import { fitDiagram, MAX_SCALE, MIN_SCALE, nodePoint, ownedRoutines, readPositions, routineCanRun, zoomDiagram } from "./routine-diagram";

afterEach(() => vi.unstubAllGlobals());
describe("routine diagram geometry", () => {
  it("fits real node bounds and keeps zoom anchored under the pointer", () => {
    const view = fitDiagram([{ x: 80, y: 80 }, { x: 420, y: 80 }], 700, 500);
    expect(view.scale).toBeLessThanOrEqual(1);
    const pointer = { x: 130, y: 230 };
    const next = zoomDiagram(view, pointer, 1.2);
    expect((pointer.x - next.x) / next.scale).toBeCloseTo((pointer.x - view.x) / view.scale);
    expect((pointer.y - next.y) / next.scale).toBeCloseTo((pointer.y - view.y) / view.scale);
    expect(zoomDiagram(view, pointer, 1e9).scale).toBe(MAX_SCALE);
    expect(zoomDiagram(view, pointer, 1e-9).scale).toBe(MIN_SCALE);
  });
  it("restores only finite bounded positions and preserves a routine's own layout", () => {
    vi.stubGlobal("localStorage", { getItem: (key: string) => key === "scope-a" ? '{"one:trigger":{"x":50,"y":90},"bad":{"x":null,"y":0},"huge":{"x":9999999,"y":0}}' : 'invalid' });
    const positions = readPositions("scope-a");
    expect(positions).toEqual({ "one:trigger": { x: 50, y: 90 } });
    expect(nodePoint(positions, "one", "trigger", 4)).toEqual({ x: 50, y: 90 });
    expect(readPositions("scope-b")).toEqual({});
  });
  it("does not expose another bot's routine or offer a second execution while one is active", () => {
    const own = { id: "own", botId: "bot-a" } as Routine;
    expect(ownedRoutines([own, { id: "foreign", botId: "bot-b" } as Routine], "bot-a")).toEqual([own]);
    for (const status of ["queued", "leased", "running", "waiting_input", "waiting_takeover"] as const) expect(routineCanRun({ status } as RoutineRun)).toBe(false);
    for (const status of ["completed", "failed", "cancelled"] as const) expect(routineCanRun({ status } as RoutineRun)).toBe(true);
  });
});
