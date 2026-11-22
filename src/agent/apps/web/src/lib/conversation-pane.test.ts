// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { BESIDE_LIMIT, closeBeside, NO_BESIDE, openBeside, pruneBeside, readBeside, showBeside, updateBeside } from "./conversation-pane";

beforeEach(() => sessionStorage.clear());

describe("conversations beside the chat", () => {
  it("opens a conversation as the shown tab and keeps at most a few", () => {
    let state = openBeside(NO_BESIDE, "a");
    state = openBeside(state, "b");
    expect(state).toEqual({ ids: ["a", "b"], active: "b" });
    expect(openBeside(state, "a")).toEqual({ ids: ["a", "b"], active: "a" });
    for (let index = 0; index < BESIDE_LIMIT + 2; index += 1) state = openBeside(state, `x${index}`);
    expect(state.ids).toHaveLength(BESIDE_LIMIT);
    expect(state.active).toBe(`x${BESIDE_LIMIT + 1}`);
  });

  it("shows the right-hand neighbour after closing the shown one, else the left one, else the list", () => {
    const state = { ids: ["a", "b", "c"], active: "b" };
    expect(closeBeside(state, "b")).toEqual({ ids: ["a", "c"], active: "c" });
    expect(closeBeside({ ids: ["a", "b", "c"], active: "c" }, "c")).toEqual({ ids: ["a", "b"], active: "b" });
    expect(closeBeside({ ids: ["a"], active: "a" }, "a")).toEqual({ ids: [], active: null });
    // Closing one that is not shown keeps the shown one; the list stays shown too.
    expect(closeBeside(state, "a")).toEqual({ ids: ["b", "c"], active: "b" });
    expect(closeBeside({ ids: ["a", "b"], active: null }, "a")).toEqual({ ids: ["b"], active: null });
    expect(closeBeside(state, "missing")).toBe(state);
  });

  it("switches between the list and a tab, and lets closed conversations leave", () => {
    const state = { ids: ["a", "b"], active: "a" };
    expect(showBeside(state, null)).toEqual({ ids: ["a", "b"], active: null });
    expect(showBeside(state, "zzz")).toBe(state);
    expect(pruneBeside(state, id => id !== "a")).toEqual({ ids: ["b"], active: "b" });
  });

  it("keeps the state per Mico for this browser tab", () => {
    updateBeside("scope-1", current => openBeside(current, "a"));
    expect(readBeside("scope-1")).toEqual({ ids: ["a"], active: "a" });
    expect(readBeside("scope-2")).toBe(NO_BESIDE);
  });
});
