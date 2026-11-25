import * as z from "zod";

/**
 * A Mico's one-time location request (ask_location). The person answers on the card with the
 * device's current position, a place they type, or a refusal. Coordinates are rounded to three
 * decimals (about 100 m) before they leave the device and again on the server.
 */
export const LOCATION_COORDINATE_DECIMALS = 3;
/** The accuracy reported to the Mico never claims more precision than the rounding keeps. */
export const LOCATION_MIN_ACCURACY_METERS = 100;
export const LOCATION_PLACE_MAX_LENGTH = 200;
export const LOCATION_REASON_MAX_LENGTH = 240;

export const LocationAskOutcome = z.enum(["shared", "typed", "declined"]);
export type LocationAskOutcome = z.infer<typeof LocationAskOutcome>;

export const LocationAnswer = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("position"),
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      accuracyMeters: z.number().nonnegative().max(1_000_000).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("place"),
      place: z.string().trim().min(1).max(LOCATION_PLACE_MAX_LENGTH),
    })
    .strict(),
  z.object({ kind: z.literal("declined") }).strict(),
]);
export type LocationAnswer = z.infer<typeof LocationAnswer>;

export function roundLocationCoordinate(value: number): number {
  const factor = 10 ** LOCATION_COORDINATE_DECIMALS;
  const rounded = Math.round(value * factor) / factor;
  // Avoid "-0" in the text the Mico reads.
  return Object.is(rounded, -0) ? 0 : rounded;
}

/** Rounds a position answer; other answers pass through unchanged. */
export function normalizeLocationAnswer(answer: LocationAnswer): LocationAnswer {
  if (answer.kind !== "position") return answer;
  const accuracy = Math.max(answer.accuracyMeters ?? 0, LOCATION_MIN_ACCURACY_METERS);
  return {
    kind: "position",
    latitude: roundLocationCoordinate(answer.latitude),
    longitude: roundLocationCoordinate(answer.longitude),
    accuracyMeters: Math.ceil(accuracy / 10) * 10,
  };
}

export function encodeLocationAnswer(answer: LocationAnswer): string {
  return JSON.stringify(normalizeLocationAnswer(LocationAnswer.parse(answer)));
}

/**
 * Reads a card answer. Plain text (a client without the location card, or the composer) is a
 * typed place. Returns null for an empty or invalid answer.
 */
export function parseLocationAnswer(raw: string): LocationAnswer | null {
  const text = raw.trim();
  if (!text) return null;
  if (text.startsWith("{")) {
    try {
      const parsed = LocationAnswer.safeParse(JSON.parse(text));
      return parsed.success ? normalizeLocationAnswer(parsed.data) : null;
    } catch {
      return null;
    }
  }
  const place = LocationAnswer.safeParse({ kind: "place", place: text });
  return place.success ? place.data : null;
}

export function locationAskOutcome(answer: LocationAnswer): LocationAskOutcome {
  if (answer.kind === "position") return "shared";
  if (answer.kind === "place") return "typed";
  return "declined";
}
