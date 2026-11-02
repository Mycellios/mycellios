import { describe, expect, it } from "vitest";
import { rootedNetworkGeometry } from "./rooted-network-geometry";

const layouts = [320, 390, 768, 1250, 1251, 1440, 1920].flatMap(width => [0, 240, 800].map(expansion => ({
  width, computeInset: Math.max(20, (width - 1150) / 2), questionInset: Math.max(20, (width - 760) / 2),
  computeBottom: width <= 760 ? 580 : 472, closingTop: (width <= 760 ? 1080 : 893) + expansion,
  emblemY: (width <= 760 ? 1230 : 1068) + expansion, headingY: (width <= 760 ? 1310 : 1183) + expansion,
})));

describe("rooted network topology", () => {
  it.each(layouts)("has one connected mesh without dangling endpoints at $width px (closing $closingTop)", layout => {
    const graph = rootedNetworkGeometry(layout), adjacent = new Map(Object.keys(graph.nodes).map(id => [id, new Set<string>()]));
    for (const { edge, points, d } of graph.curves) {
      expect(points[0]).toBe(graph.nodes[edge.from]);
      expect(points.at(-1)).toBe(graph.nodes[edge.to]);
      const numbers = d.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
      expect(numbers.slice(0, 2)).toEqual([graph.nodes[edge.from]!.x, graph.nodes[edge.from]!.y]);
      expect(numbers.slice(-2)).toEqual([graph.nodes[edge.to]!.x, graph.nodes[edge.to]!.y]);
      adjacent.get(edge.from)!.add(edge.to); adjacent.get(edge.to)!.add(edge.from);
      for (const point of points) {
        expect(point.x).toBeGreaterThanOrEqual(0); expect(point.x).toBeLessThanOrEqual(layout.width);
        expect(point.y).toBeGreaterThanOrEqual(0); expect(point.y).toBeLessThan(graph.height);
      }
    }
    for (const neighbors of adjacent.values()) expect(neighbors.size).toBeGreaterThanOrEqual(2);
    const visited = new Set<string>(), pending = ["mico"];
    while (pending.length) {
      const id = pending.pop()!;
      if (visited.has(id)) continue;
      visited.add(id); pending.push(...adjacent.get(id)!);
    }
    expect(visited.size).toBe(Object.keys(graph.nodes).length);
  });

  it.each(layouts)("keeps vertical roots outside the reading columns at $width px", layout => {
    for (const { edge, points } of rootedNetworkGeometry(layout).curves) {
      if (edge.closing || edge.id === "canopy" || edge.id === "bridge") continue;
      for (const point of points) {
        const inset = point.y < layout.computeBottom - 60 ? layout.computeInset : layout.questionInset;
        expect(Math.min(point.x, layout.width - point.x)).toBeLessThan(inset);
      }
    }
  });
});
