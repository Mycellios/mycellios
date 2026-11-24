import type { LocationAnswer } from "@mycellios/contracts";

/** Name of the model tool that pauses a turn on a location card. */
export const ASK_LOCATION_TOOL = "ask_location";

/**
 * Starts the part of a resumed turn's prompt that carries a shared location. The executor keeps
 * that part for the attempt that reads it and stores the prompt without it.
 */
export const LOCATION_ANSWER_MARKER = "[Location for this request only]";
const LOCATION_ANSWER_RELEASED = `${LOCATION_ANSWER_MARKER} The person answered the location request. That location is not kept; ask again if you still need it.`;

export function isLocationAskBlock(block: { kind: string; location?: unknown }): boolean {
  return block.kind === "ask" && Boolean(block.location);
}

/** What the paused Mico reads when the person answers its location card. */
export function locationAnswerPrompt(answer: LocationAnswer): string {
  if (answer.kind === "declined")
    return "The person chose not to share their location. Continue without it: answer as well as you can, or ask them to name a place.";
  const use =
    "Use it only for this request. Do not save it to memory, files, notes, schedules or messages for later.";
  if (answer.kind === "place")
    return `${LOCATION_ANSWER_MARKER} The person typed this place: ${JSON.stringify(answer.place)}. ${use}`;
  const accuracy = answer.accuracyMeters ? ` (within about ${answer.accuracyMeters} m)` : "";
  return `${LOCATION_ANSWER_MARKER} The person shared their current location once: latitude ${answer.latitude}, longitude ${answer.longitude}${accuracy}. ${use}`;
}

/** The stored form of a prompt: a shared location is replaced by a note that it was answered. */
export function withoutLocationAnswer(prompt: string): string {
  const start = prompt.indexOf(LOCATION_ANSWER_MARKER);
  if (start < 0 || prompt.slice(start) === LOCATION_ANSWER_RELEASED) return prompt;
  return `${prompt.slice(0, start)}${LOCATION_ANSWER_RELEASED}`;
}
