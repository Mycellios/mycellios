// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_RAIL_PINS, railPinsKey, readRailPins, writeRailPins } from "./workspace-rail-pins";

const scope = JSON.stringify(["user-1", "space-1"]);

describe("workspace rail pins", () => {
  beforeEach(() => window.localStorage.clear());

  it("pins Memory by default", () => {
    expect(readRailPins(scope)).toEqual([...DEFAULT_RAIL_PINS]);
    expect(DEFAULT_RAIL_PINS).toContain("memory");
  });

  it("adds Memory once to pins saved before it existed", () => {
    window.localStorage.setItem(railPinsKey(scope), JSON.stringify(["tasks", "files"]));
    expect(readRailPins(scope)).toEqual(["tasks", "files", "memory"]);
    expect(JSON.parse(window.localStorage.getItem(railPinsKey(scope))!)).toEqual([
      "tasks",
      "files",
      "memory",
    ]);
  });

  it("respects unpinning Memory afterwards", () => {
    window.localStorage.setItem(railPinsKey(scope), JSON.stringify(["tasks"]));
    readRailPins(scope);
    writeRailPins(scope, ["tasks"]);
    expect(readRailPins(scope)).toEqual(["tasks"]);
  });

  it("does not add Memory to pins chosen after it existed", () => {
    writeRailPins(scope, ["usage"]);
    expect(readRailPins(scope)).toEqual(["usage"]);
  });

  it("keeps the old connections id migration", () => {
    writeRailPins(scope, []);
    window.localStorage.setItem(railPinsKey(scope), JSON.stringify(["connections"]));
    expect(readRailPins(scope)).toEqual(["marketplace"]);
  });
});
