import { expect, it } from "vitest";
import { earlierProgressNotes, naturalTurnLayout } from "./natural-turn";

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

it("joins a note a step split mid-word and hides it while it is still being written", () => {
  const split = [
    { kind: "text" as const, text: "Sigo" },
    steps("Search"),
    { kind: "text" as const, text: " donde lo dejé." },
    steps("Read"),
    { kind: "progress" as const, text: "Ahora" },
  ];
  // The first piece alone is half a sentence: nothing shows until it ends.
  expect(naturalTurnLayout(split.slice(0, 2), true).notes).toEqual([]);
  expect(naturalTurnLayout(split, true).notes).toEqual(["Sigo donde lo dejé."]);
  // A finished turn shows every note it wrote, complete or not.
  expect(naturalTurnLayout([{ kind: "text", text: "Reviso el código" }, steps("Read"), { kind: "text", text: "Listo." }], false).notes)
    .toEqual(["Reviso el código"]);
});

it("does not join two separate notes or repeat a note an earlier progress message showed", () => {
  const layout = naturalTurnLayout([
    { kind: "text", text: "Reviso el código" },
    steps("Read"),
    { kind: "text", text: "Sigo donde lo dejé." },
    steps("Search"),
    { kind: "text", text: "Compruebo la instalación." },
    steps("Run"),
  ], true, ["Sigo  donde lo dejé."]);
  expect(layout.notes).toEqual(["Reviso el código", "Compruebo la instalación."]);
});

it("lists the notes each message's turn already showed in progress messages", () => {
  const notes = earlierProgressNotes([
    { id: "a", role: "bot", runId: "r1", progress: true, blocks: [{ kind: "text", text: "Sigo donde lo dejé." }] },
    { id: "b", role: "bot", runId: "r2", blocks: [{ kind: "text", text: "Otra." }] },
    { id: "progress:r1", role: "bot", runId: "r1", blocks: [{ kind: "progress", text: "Sigo" }] },
  ]);
  expect(notes.get("a")).toBeUndefined();
  expect(notes.get("b")).toBeUndefined();
  expect(notes.get("progress:r1")).toEqual(["Sigo donde lo dejé."]);
});
