import { afterEach, expect, it, vi } from "vitest";
vi.mock("../../lib/rpc", () => ({
  rpc: {},
  createSpaceRpc: () => ({}),
  rpcForSpace: () => ({}),
  selectedSpaceId: () => null,
}));
import { queryClient, setQueryUser } from "../../lib/query";
import { hasUnsavedEditorWork } from "../../lib/unsaved-editor-work";
import { blankState, clearCadencia, readCadencia, saveCadencia } from "./state";

afterEach(() => queryClient.clear());
it("retains private file and cut choices across navigation, isolated by account/Space", () => {
  const file = new File([new Uint8Array([1, 2])], "private.webm");
  const state = {
    ...blankState(),
    file,
    cuts: [
      { id: "cut", kind: "silence" as const, start: 1, end: 2, enabled: false },
    ],
  };
  saveCadencia("user:space", state);
  expect(readCadencia("user:space").file).toBe(file);
  expect(readCadencia("user:space").cuts[0]!.enabled).toBe(false);
  expect(readCadencia("other:space").file).toBeUndefined();
  expect(readCadencia("user:other-space").file).toBeUndefined();
  expect(hasUnsavedEditorWork()).toBe(true);
  clearCadencia("user:space");
  expect(hasUnsavedEditorWork()).toBe(false);
});
it("releases imported private media and reload guard on account switch", () => {
  setQueryUser("cadencia-owner");
  saveCadencia("cadencia-owner:space", {
    ...blankState(),
    file: new File(["private"], "private.wav"),
  });
  setQueryUser("another-owner");
  expect(readCadencia("cadencia-owner:space").file).toBeUndefined();
  expect(hasUnsavedEditorWork()).toBe(false);
});
