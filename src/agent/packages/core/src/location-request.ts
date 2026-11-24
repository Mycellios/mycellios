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

/** Typed places, or parts of one, shorter than this ("home", "casa") are too common to hide. */
export const LOCATION_PLACE_MIN_HIDDEN_LENGTH = 5;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Spaces and commas as people, URLs and query strings write them. */
const SPACE = String.raw`(?:\s+|%20|\+|_)`;
const COMMA = String.raw`(?:\s*(?:,|%2C)(?:\s+|%20|\+)?)`;

function placePattern(place: string): string {
  return place
    .trim()
    .split(/(\s*,\s*|\s+)/)
    .filter(Boolean)
    .map((part) =>
      /^\s*,\s*$/.test(part) ? COMMA : /^\s+$/.test(part) ? SPACE : escapeRegExp(part),
    )
    .join("");
}

function coordinatePattern(value: number): string {
  // Further digits are the same place written more precisely.
  return `${escapeRegExp(String(value))}\\d*`;
}

/**
 * Patterns for the forms of an answer that tool activity kept in the chat (steps, commands,
 * output, labels) hides: case-insensitive, URL-encoded spaces and commas included, and never
 * inside a longer word or number. A typed place is hidden whole and by each of its
 * comma-separated parts; parts and single coordinates count only when specific enough.
 */
export function locationRedactionPatterns(answer: LocationAnswer): RegExp[] {
  if (answer.kind === "declined") return [];
  const sources: string[] = [];
  if (answer.kind === "place") {
    const parts = [answer.place, ...answer.place.split(",")]
      .map((part) => part.trim())
      .filter((part) => part.replace(/\s/g, "").length >= LOCATION_PLACE_MIN_HIDDEN_LENGTH);
    for (const part of new Set(parts)) {
      sources.push(placePattern(part));
      // Letters outside ASCII as a URL writes them (spaces and commas are covered above).
      const encoded = encodeURIComponent(part).replace(/%20/g, " ").replace(/%2C/gi, ",");
      if (encoded !== part) sources.push(placePattern(encoded));
    }
  } else {
    const latitude = coordinatePattern(answer.latitude);
    const longitude = coordinatePattern(answer.longitude);
    sources.push(`${latitude}(?:${COMMA}|${SPACE}|;)${longitude}`);
    for (const value of [answer.latitude, answer.longitude])
      if (/\.\d{2,}$/.test(String(value))) sources.push(coordinatePattern(value));
  }
  // Longest first, so a whole place goes before its parts.
  return sources
    .sort((a, b) => b.length - a.length)
    .map((source) => new RegExp(`(?<![\\p{L}\\p{N}.])${source}(?![\\p{L}\\p{N}])`, "giu"));
}

/** Replaces every match of the answer's patterns with [redacted]. */
export function hideLocationValues(text: string, patterns: readonly RegExp[]): string {
  return patterns.reduce((hidden, pattern) => hidden.replace(pattern, "[redacted]"), text);
}
