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

/** A note is complete once it ends a sentence (or introduces what follows with a colon). */
const NOTE_END = /[.!?:…]["'”’)\]»]*\s*$/u;
/** Text that carries on the sentence before it: lowercase, or punctuation that cannot start one. */
const CONTINUES = /^(?:\s*\p{Ll}|\s*[,;)\]»”’])/u;

/**
 * Split a bot turn the way the natural style shows it. Text before the last steps block is
 * narration: it becomes small notes, without filler and without lines the turn already showed,
 * here or in `earlierNotes` (the turn's earlier progress messages). A step that landed mid-sentence
 * does not split a note: its pieces join into one line. While the turn is live, a note that is
 * still being written stays hidden until it ends its sentence, so it never shows half a word, and
 * the answer is held until it is complete, so it appears once instead of growing. A finished turn
 * that wrote nothing after its last step answers with its latest note.
 */
export function naturalTurnLayout(
  blocks: readonly MessageBlock[],
  live: boolean,
  earlierNotes: readonly string[] = [],
): NaturalTurnLayout {
  const lastSteps = blocks.reduce((last, block, index) => (block.kind === "steps" ? index : last), -1);
  const stepBlocks = blocks.filter((block): block is StepsBlock => block.kind === "steps");
  const isText = (block: MessageBlock): block is TextBlock =>
    (block.kind === "text" || (block.kind === "progress" && !block.activity)) && block.text.trim().length > 0;
  const narration = blocks.slice(0, Math.max(lastSteps, 0)).filter(isText);
  // Drop the empty-answer sentinel without dropping symbol-only replies, such as emoji.
  const after = blocks.slice(lastSteps + 1).filter(isText)
    .filter((block) => block.text.trim() !== "∅");
  // Join the pieces of a sentence that a step interrupted, as the agent wrote it.
  const pieces: string[] = [];
  for (const block of narration) {
    const previous = pieces.at(-1);
    if (previous !== undefined && !NOTE_END.test(previous) && CONTINUES.test(block.text)) pieces[pieces.length - 1] = previous + block.text;
    else pieces.push(block.text);
  }
  // While live, the newest piece may still be growing: show it once its sentence ends.
  if (live && pieces.length > 0 && !NOTE_END.test(pieces.at(-1)!)) pieces.pop();
  const shown = new Set(earlierNotes.map(noteKey));
  const notes: string[] = [];
  for (const text of pieces) {
    const key = noteKey(text);
    if (isFiller(text) || shown.has(key)) continue;
    shown.add(key);
    notes.push(text.trim());
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

/**
 * For each bot message, the notes its turn already showed in earlier durable progress messages,
 * so a note the agent repeats later in the same turn appears once. Messages of other runs, user
 * messages and messages with no earlier note get no entry.
 */
export function earlierProgressNotes(
  messages: readonly { id: string; role: string; runId?: string; progress?: true; blocks: readonly MessageBlock[] }[],
): Map<string, readonly string[]> {
  const byRun = new Map<string, readonly string[]>();
  const result = new Map<string, readonly string[]>();
  for (const message of messages) {
    if (message.role !== "bot" || !message.runId) continue;
    const seen = byRun.get(message.runId);
    // The array is replaced on append, so messages can share the same note history.
    if (seen?.length) result.set(message.id, seen);
    if (!message.progress) continue;
    const texts = message.blocks
      .filter((block): block is TextBlock => block.kind === "text" && block.text.trim().length > 0)
      .map((block) => block.text);
    if (texts.length) byRun.set(message.runId, [...(seen ?? []), ...texts]);
  }
  return result;
}
