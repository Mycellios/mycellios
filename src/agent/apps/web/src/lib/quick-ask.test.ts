import { expect, it } from "vitest";
import { chooseQuickAskBot, type QuickAskBot } from "./quick-ask";

const bots: QuickAskBot[] = [
  { id: "archived", name: "Old", archivedAt: "2026-01-01", pinned: true },
  { id: "first", name: "First", archivedAt: null, pinned: false },
  { id: "pinned", name: "Pinned", archivedAt: null, pinned: true },
];

it("asks the open Mico, then a pinned Mico, and skips archived ones", () => {
  expect(chooseQuickAskBot(bots, "first")?.id).toBe("first");
  expect(chooseQuickAskBot(bots, "archived")?.id).toBe("pinned");
  expect(chooseQuickAskBot(bots, null)?.id).toBe("pinned");
  expect(chooseQuickAskBot(bots, "../other")?.id).toBe("pinned");
  expect(
    chooseQuickAskBot([{ id: "only", name: "Only", archivedAt: null, pinned: false }], "missing")
      ?.id,
  ).toBe("only");
  expect(chooseQuickAskBot([], null)).toBeNull();
});
