import type { MessageBlock } from "@mycellios/contracts";

type TextBlock = Extract<MessageBlock, { kind: "text" | "progress" }>;
type StepsBlock = Extract<MessageBlock, { kind: "steps" }>;

/** How the natural response style draws one bot turn: short notes, one steps summary, one answer. */
export interface NaturalTurnLayout {
  /** The short lines the agent wrote between its steps, without filler or repeats. */
  notes: string[];
  /** Every steps block of the turn as one summary, or null when the turn used no tools. */
  steps: StepsBlock | null;
  /** The answer: the text after the turn's last step. */
  answer: TextBlock[];
}

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/gu;

function noteKey(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

/** A note with fewer than two letters or digits says nothing. */
function isFiller(text: string): boolean {
  return (noteKey(text).match(LETTER_OR_DIGIT)?.length ?? 0) < 2;
}

/**
 * Split a bot turn the way the natural style shows it. Text before the last steps block is
 * narration: it becomes small notes, without filler and without lines the turn already showed.
 * Text after the last step is the answer. While the turn is live, the answer is held until it is
 * complete, so it appears once instead of growing. A finished turn that wrote nothing after its
 * last step answers with its latest note.
 */
export function naturalTurnLayout(blocks: readonly MessageBlock[], live: boolean): NaturalTurnLayout {
  const lastSteps = blocks.reduce((last, block, index) => (block.kind === "steps" ? index : last), -1);
  const stepBlocks = blocks.filter((block): block is StepsBlock => block.kind === "steps");
  const isText = (block: MessageBlock): block is TextBlock =>
    (block.kind === "text" || (block.kind === "progress" && !block.activity)) && block.text.trim().length > 0;
  const narration = blocks.slice(0, Math.max(lastSteps, 0)).filter(isText);
  // An answer with no letter or digit at all, such as "∅", is a placeholder, not an answer.
  const after = blocks.slice(lastSteps + 1).filter(isText)
    .filter((block) => (block.text.match(LETTER_OR_DIGIT)?.length ?? 0) > 0);
  const shown = new Set<string>();
  const notes: string[] = [];
  for (const block of narration) {
    const key = noteKey(block.text);
    if (isFiller(block.text) || shown.has(key)) continue;
    shown.add(key);
    notes.push(block.text.trim());
  }
  let answer: TextBlock[] = live ? [] : after;
  if (!live && answer.length === 0 && notes.length > 0) {
    answer = [{ kind: "text", text: notes.pop()! }];
  }
  const steps: StepsBlock | null = stepBlocks.length === 0
    ? null
    : {
        kind: "steps",
        steps: stepBlocks.flatMap((block) => block.steps),
        tools: stepBlocks.some((block) => block.tools)
          ? stepBlocks.flatMap((block) => block.tools ?? [])
          : undefined,
        durationMs: stepBlocks.some((block) => block.durationMs !== undefined)
          ? stepBlocks.reduce((sum, block) => sum + (block.durationMs ?? 0), 0)
          : undefined,
      };
  return { notes, steps, answer };
}
