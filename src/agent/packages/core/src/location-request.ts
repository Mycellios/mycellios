import type { LocationAnswer } from "@mycellios/contracts";

/** Name of the model tool that pauses a turn on a location card. */
export const ASK_LOCATION_TOOL = "ask_location";

/** Starts every task prompt a location card writes, so previews can show something neutral. */
export const LOCATION_ANSWER_MARKER = "[Location request]";

/**
 * What the stored task holds after a position or place was given. The location itself waits
 * encrypted with the run and the executor puts it in this note's place for the resumed turn; a
 * turn that runs without it (a retry after the run lost it) reads this note.
 */
export const LOCATION_ANSWER_NOTE = `${LOCATION_ANSWER_MARKER} The person answered your location request. If their answer is not given here, it is no longer available: ask again if you still need it.`;

export const LOCATION_DECLINED_PROMPT = `${LOCATION_ANSWER_MARKER} The person chose not to share their location. Continue without it: answer as well as you can, or ask them to name a place.`;

export function isLocationAskBlock(block: { kind: string; location?: unknown }): boolean {
  return block.kind === "ask" && Boolean(block.location);
}

/** A task prompt written by a location card, never the person's own words. */
export function isLocationAnswerPrompt(prompt: string): boolean {
  return prompt.trimStart().startsWith(LOCATION_ANSWER_MARKER);
}

/** The stored task prompt for a location answer: only a note, or the refusal. */
export function locationAnswerTaskPrompt(answer: LocationAnswer): string {
  return answer.kind === "declined" ? LOCATION_DECLINED_PROMPT : LOCATION_ANSWER_NOTE;
}

/** What the resumed turn reads in place of LOCATION_ANSWER_NOTE. */
export function locationAnswerPrompt(answer: LocationAnswer): string {
  if (answer.kind === "declined") return LOCATION_DECLINED_PROMPT;
  const use =
    "Use it only for this request. Do not save it to memory, files, notes, schedules or messages for later.";
  if (answer.kind === "place")
    return `${LOCATION_ANSWER_MARKER} The person typed this place: ${JSON.stringify(answer.place)}. ${use}`;
  const accuracy = answer.accuracyMeters ? ` (within about ${answer.accuracyMeters} m)` : "";
  return `${LOCATION_ANSWER_MARKER} The person shared their current location once: latitude ${answer.latitude}, longitude ${answer.longitude}${accuracy}. ${use}`;
}

/** The turn's prompt with the decrypted answer in place of the stored note. */
export function withLocationAnswer(prompt: string, answer: LocationAnswer | null): string {
  if (!answer || answer.kind === "declined" || !prompt.includes(LOCATION_ANSWER_NOTE))
    return prompt;
  return prompt.replace(LOCATION_ANSWER_NOTE, () => locationAnswerPrompt(answer));
}

/**
 * The text forms of an answer that tool activity kept in the chat (steps, commands, output,
 * labels) hides. Single coordinates count only with enough digits to be specific.
 */
export function locationRedactionValues(answer: LocationAnswer): string[] {
  if (answer.kind === "declined") return [];
  if (answer.kind === "place") return answer.place.trim().length >= 3 ? [answer.place.trim()] : [];
  const latitude = String(answer.latitude);
  const longitude = String(answer.longitude);
  return [
    `${latitude},${longitude}`,
    `${latitude}, ${longitude}`,
    `${latitude} ${longitude}`,
    ...[latitude, longitude].filter((value) => /\.\d{2,}$/.test(value) && value.length >= 5),
  ];
}
