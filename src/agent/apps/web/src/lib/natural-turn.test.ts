import { expect, it } from "vitest";
import { naturalTurnLayout } from "./natural-turn";

const steps = (label: string, durationMs?: number) => ({ kind: "steps" as const, steps: [{ label, count: 1 }], durationMs });

it("merges every steps block into one summary with the total duration", () => {
  const layout = naturalTurnLayout([steps("A", 1000), { kind: "text", text: "Note one." }, steps("B", 500), { kind: "text", text: "Done." }], false);
  expect(layout.steps?.steps.map(step => step.label)).toEqual(["A", "B"]);
  expect(layout.steps?.durationMs).toBe(1500);
  expect(layout.notes).toEqual(["Note one."]);
  expect(layout.answer.map(block => block.text)).toEqual(["Done."]);
});

it("drops filler and repeated notes, and a placeholder answer", () => {
  const layout = naturalTurnLayout([
    { kind: "text", text: "x" },
    { kind: "text", text: "Checking  the build." },
    { kind: "text", text: "Checking the build." },
    steps("Build"),
    { kind: "text", text: "∅" },
  ], false);
  expect(layout.notes).toEqual([]);
  expect(layout.answer.map(block => block.text)).toEqual(["Checking  the build."]);
});

it("keeps a turn without tools as a plain answer and holds it while live", () => {
  expect(naturalTurnLayout([{ kind: "text", text: "Hola." }], false)).toEqual({ notes: [], steps: null, answer: [{ kind: "text", text: "Hola." }] });
  expect(naturalTurnLayout([{ kind: "progress", text: "Ho" }], true).answer).toEqual([]);
});

it("leaves provider tool status lines out of the notes", () => {
  const layout = naturalTurnLayout([{ kind: "progress", text: "Running shell", activity: true }, steps("Shell"), { kind: "text", text: "Ok." }], false);
  expect(layout.notes).toEqual([]);
});
