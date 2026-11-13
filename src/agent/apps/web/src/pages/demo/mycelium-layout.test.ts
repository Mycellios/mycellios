import { expect, it } from "vitest";
import { myceliumLayout, myceliumPoint, myceliumSeed } from "./mycelium-layout";

it("keeps every guest at the same bounded position across arrivals, departures and reordered snapshots", () => {
  for (const n of Array.from({ length: 50 }, (_, i) => i + 1)) {
    const point = myceliumPoint(n);
    expect(point.x).toBeGreaterThan(45); expect(point.x).toBeLessThan(955);
    expect(point.y).toBeGreaterThan(40); expect(point.y).toBeLessThan(600);
    expect(myceliumLayout([50, n, 1]).points.find(p => p.number === n)).toEqual(point);
  }
});
it("grows a bounded peer mesh with only actual guest endpoints, never a central-server star", () => {
  for (const count of [0, 1, 15, 50]) {
    const numbers = Array.from({ length: count }, (_, i) => i + 1);
    const graph = myceliumLayout(numbers);
    expect(graph.points).toHaveLength(count);
    expect(graph.branches).toHaveLength(count < 2 ? 0 : 2 * count - 3);
    expect(new Set(graph.branches.map(b => b.key)).size).toBe(graph.branches.length);
    for (const branch of graph.branches) {
      expect(numbers).toContain(branch.a); expect(numbers).toContain(branch.b);
      expect(branch.a).not.toBe(branch.b); expect(branch.path).not.toMatch(/NaN|Infinity/);
    }
    if (count > 1) {
      const reached = new Set([1]);
      for (const b of graph.branches) { expect(reached.has(b.a)).toBe(true); reached.add(b.b); }
      expect(reached.size).toBe(count);
    }
  }
});
it("deduplicates and rejects invalid ordinals without inventing participants", () => {
  expect(myceliumLayout([1, 1, 0, -1, 51, NaN, 1.5]).points.map(p => p.number)).toEqual([1]);
  expect(myceliumSeed()).toHaveLength(18);
  expect(myceliumSeed().join("")).not.toMatch(/NaN|Infinity/);
});
