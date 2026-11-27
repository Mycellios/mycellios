import { describe, expect, it } from "vitest";
import { createGraphLayout } from "./memory-graph-layout";

const ids = Array.from({ length: 40 }, (_, index) => `note-${index}`);
const edges = ids.slice(1).map((_, index) => ({ source: index, target: index + 1 }));

describe("createGraphLayout", () => {
  it("is deterministic for the same notes", () => {
    const first = createGraphLayout(ids, edges);
    const second = createGraphLayout(ids, edges);
    first.settle(200);
    second.settle(200);
    expect([...first.x]).toEqual([...second.x]);
    expect([...first.y]).toEqual([...second.y]);
  });

  it("settles and stops ticking", () => {
    const layout = createGraphLayout(ids, edges);
    layout.settle(2000);
    expect(layout.step()).toBe(false);
    expect([...layout.x, ...layout.y].every(Number.isFinite)).toBe(true);
  });

  it("keeps linked notes closer than unlinked ones", () => {
    const layout = createGraphLayout(["a", "b", "c"], [{ source: 0, target: 1 }]);
    layout.settle(600);
    const distance = (i: number, j: number) =>
      Math.hypot(layout.x[i]! - layout.x[j]!, layout.y[i]! - layout.y[j]!);
    expect(distance(0, 1)).toBeLessThan(distance(0, 2));
  });

  it("holds a pinned note in place", () => {
    const layout = createGraphLayout(ids, edges);
    layout.pin(3, 500, -500);
    layout.settle(50);
    expect(layout.x[3]).toBe(500);
    expect(layout.y[3]).toBe(-500);
  });

  it("handles an empty graph", () => {
    const layout = createGraphLayout([], []);
    expect(layout.step()).toBe(false);
  });
});
