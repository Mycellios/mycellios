import { describe, expect, it } from "vitest";
import { MessageBlock } from "./events.js";
import {
  encodeLocationAnswer,
  locationAskOutcome,
  parseLocationAnswer,
  roundLocationCoordinate,
} from "./location-request.js";

describe("location answers", () => {
  it("rounds coordinates to about 100 m and never reports finer accuracy", () => {
    expect(roundLocationCoordinate(40.416775)).toBe(40.417);
    expect(roundLocationCoordinate(-0.0004)).toBe(0);
    expect(
      JSON.parse(
        encodeLocationAnswer({
          kind: "position",
          latitude: 51.500729,
          longitude: -0.124625,
          accuracyMeters: 8,
        }),
      ),
    ).toEqual({ kind: "position", latitude: 51.501, longitude: -0.125, accuracyMeters: 100 });
    expect(
      parseLocationAnswer(
        JSON.stringify({
          kind: "position",
          latitude: 1.23456,
          longitude: 2.34567,
          accuracyMeters: 1234,
        }),
      ),
    ).toEqual({ kind: "position", latitude: 1.235, longitude: 2.346, accuracyMeters: 1240 });
  });

  it("reads typed places, refusals and plain text, and rejects anything else", () => {
    expect(parseLocationAnswer(encodeLocationAnswer({ kind: "place", place: " Lisbon " }))).toEqual(
      {
        kind: "place",
        place: "Lisbon",
      },
    );
    expect(parseLocationAnswer('{"kind":"declined"}')).toEqual({ kind: "declined" });
    expect(parseLocationAnswer("Near the station")).toEqual({
      kind: "place",
      place: "Near the station",
    });
    for (const raw of [
      "",
      "{not json",
      '{"kind":"position","latitude":91,"longitude":0}',
      '{"kind":"declined","extra":1}',
      "x".repeat(201),
    ])
      expect(parseLocationAnswer(raw), raw).toBeNull();
  });

  it("maps answers to the outcome kept on the card", () => {
    expect(locationAskOutcome({ kind: "position", latitude: 0, longitude: 0 })).toBe("shared");
    expect(locationAskOutcome({ kind: "place", place: "Rome" })).toBe("typed");
    expect(locationAskOutcome({ kind: "declined" })).toBe("declined");
  });

  it("keeps the card's outcome in the message block contract", () => {
    const block = MessageBlock.parse({
      kind: "ask",
      text: "Where?",
      status: "answered",
      answer: "",
      location: { outcome: "shared" },
    });
    expect(block).toMatchObject({ location: { outcome: "shared" } });
    expect(
      MessageBlock.safeParse({ kind: "ask", text: "Where?", location: { outcome: "elsewhere" } })
        .success,
    ).toBe(false);
  });
});
