import { describe, expect, it } from "vitest";
import { containScene, createGrowthField, growthAlpha, interpolateRect } from "./forest-growth";

describe("Forest loading preview", () => {
  it("replays the same organic growth and reaches both exact end states", () => {
    const field = createGrowthField(32, 16);
    expect(createGrowthField(32, 16)).toEqual(field);
    for (const arrival of field) {
      expect(Number.isFinite(arrival)).toBe(true);
      expect(growthAlpha(arrival, 0)).toBe(0);
      expect(growthAlpha(arrival, 1)).toBe(255);
      expect(growthAlpha(arrival, .3)).toBeLessThanOrEqual(growthAlpha(arrival, .7));
    }
  });

  it("colonizes the roots before the tops of the tree trunks", () => {
    const field = createGrowthField(101, 101);
    expect(field[100 * 101 + 52]!).toBeLessThan(field[13]!);
    expect(field[100 * 101 + 52]!).toBeLessThan(field[86]!);
  });

  it.each([[1440, 900], [768, 1024], [390, 844]])("keeps the complete equipment composition inside %i × %i", (width, height) => {
    const rect = containScene(width, height);
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.y).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(width);
    expect(rect.y + rect.height).toBeLessThanOrEqual(height);
    expect(rect.width / rect.height).toBe(2);
  });

  it("lands at the actual page illustration without mutating its layout", () => {
    const start = { x: 0, y: 100, width: 1440, height: 720 };
    const end = { x: 80, y: 440, width: 1280, height: 640 };
    expect(interpolateRect(start, end, -1)).toEqual(start);
    expect(interpolateRect(start, end, 2)).toEqual(end);
    expect(start.y).toBe(100);
    expect(end.y).toBe(440);
  });

  it("fits the dedicated portrait scene without cropping equipment on mobile", () => {
    const rect = containScene(390, 844, 2 / 3);
    expect(rect).toEqual({ x: 0, y: 129.5, width: 390, height: 585 });
  });
});
