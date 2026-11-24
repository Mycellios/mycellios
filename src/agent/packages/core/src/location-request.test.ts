import { describe, expect, it } from "vitest";
import { dismissableAskMessageIds } from "./answerable-ask.js";
import { blocksToAgentHistoryText } from "./attachments.js";
import {
  hideLocationValues,
  isLocationAnswerPrompt,
  isLocationAskBlock,
  LOCATION_ANSWER_MARKER,
  LOCATION_ANSWER_NOTE,
  LOCATION_DECLINED_PROMPT,
  locationAnswerPrompt,
  locationAnswerTaskPrompt,
  locationRedactionPatterns,
  withLocationAnswer,
} from "./location-request.js";

const position = {
  kind: "position" as const,
  latitude: 40.417,
  longitude: -3.704,
  accuracyMeters: 100,
};

describe("location request prompts", () => {
  it("stores only a note in the task and gives the turn the location in its place", () => {
    expect(locationAnswerTaskPrompt(position)).toBe(LOCATION_ANSWER_NOTE);
    expect(locationAnswerTaskPrompt({ kind: "place", place: "Madrid" })).toBe(LOCATION_ANSWER_NOTE);
    expect(locationAnswerTaskPrompt({ kind: "declined" })).toBe(LOCATION_DECLINED_PROMPT);
    expect(LOCATION_ANSWER_NOTE).not.toMatch(/\d/);

    const turn = withLocationAnswer(`${LOCATION_ANSWER_NOTE}\n\nAttached files: none`, position);
    expect(turn).toContain("latitude 40.417, longitude -3.704 (within about 100 m)");
    expect(turn).toContain("Do not save it");
    expect(turn).not.toContain(LOCATION_ANSWER_NOTE);
    expect(turn.endsWith("Attached files: none")).toBe(true);
    expect(locationAnswerPrompt({ kind: "place", place: 'Gran "Via"' })).toContain(
      '"Gran \\"Via\\""',
    );
  });

  it("leaves other prompts and a lost answer as they are", () => {
    expect(withLocationAnswer("restaurants near me", position)).toBe("restaurants near me");
    expect(withLocationAnswer(LOCATION_ANSWER_NOTE, null)).toBe(LOCATION_ANSWER_NOTE);
    expect(isLocationAnswerPrompt(LOCATION_ANSWER_NOTE)).toBe(true);
    expect(isLocationAnswerPrompt(LOCATION_DECLINED_PROMPT)).toBe(true);
    expect(isLocationAnswerPrompt(`Please look up ${LOCATION_ANSWER_MARKER}`)).toBe(false);
  });

  it("hides the answer in kept tool activity, in the forms commands and URLs write it", () => {
    const hide = (text: string, answer: Parameters<typeof locationRedactionPatterns>[0]) =>
      hideLocationValues(text, locationRedactionPatterns(answer));
    expect(hide("Searching the web: restaurants near 40.417,-3.704", position)).toBe(
      "Searching the web: restaurants near [redacted]",
    );
    expect(hide("Running: curl wttr.in/40.417, -3.704?format=3", position)).toBe(
      "Running: curl wttr.in/[redacted]?format=3",
    );
    expect(hide("GET /forecast?q=40.417%2C-3.704&u=m", position)).toBe(
      "GET /forecast?q=[redacted]&u=m",
    );
    expect(hide("lat=40.417&lon=-3.704", position)).toBe("lat=[redacted]&lon=[redacted]");
    // The same place written more precisely is still the place.
    expect(hide("lat=40.41712", position)).toBe("lat=[redacted]");

    const place = { kind: "place" as const, place: "Gran Via, Madrid" };
    expect(hide("Searching the web: tapas Gran Via, Madrid", place)).toBe(
      "Searching the web: tapas [redacted]",
    );
    expect(hide("Searching the web: tapas gran via, madrid", place)).toBe(
      "Searching the web: tapas [redacted]",
    );
    expect(hide("Reading page: maps.example/search?q=Gran%20Via%2C%20Madrid", place)).toBe(
      "Reading page: maps.example/search?q=[redacted]",
    );
    expect(hide("q=gran+via&city=madrid", place)).toBe("q=[redacted]&city=[redacted]");
    expect(hide("Reading page: example.test/M%C3%A1laga", { kind: "place", place: "Málaga" })).toBe(
      "Reading page: example.test/[redacted]",
    );
  });

  it("does not hide unrelated words or numbers", () => {
    const hide = (text: string, answer: Parameters<typeof locationRedactionPatterns>[0]) =>
      hideLocationValues(text, locationRedactionPatterns(answer));
    // Short places are too common to hide at all.
    expect(hide("Running: ls /home/user", { kind: "place", place: "home" })).toBe(
      "Running: ls /home/user",
    );
    expect(locationRedactionPatterns({ kind: "place", place: "casa" })).toEqual([]);
    // Never inside a longer word or number.
    expect(hide("Madrider Str. 4", { kind: "place", place: "Madrid" })).toBe("Madrider Str. 4");
    const short = { kind: "position" as const, latitude: 40.42, longitude: -3.7 };
    expect(hide("id 140.4217 and 40.425", short)).toBe("id 140.4217 and [redacted]");
    expect(hide("140.417 x40.417 40.4", position)).toBe("140.417 x40.417 40.4");
    // A coordinate with one decimal is hidden only beside the other one.
    expect(hide("3.7 km away; 40.42, -3.7", short)).toBe("3.7 km away; [redacted]");
    expect(locationRedactionPatterns({ kind: "declined" })).toEqual([]);
  });

  it("lets later turns know only how a location card was answered", () => {
    const text = blocksToAgentHistoryText([
      {
        kind: "ask",
        text: "Where are you?",
        status: "answered",
        answer: "",
        location: { outcome: "shared" },
      },
      {
        kind: "ask",
        text: "Which city?",
        status: "answered",
        answer: "",
        location: { outcome: "declined" },
      },
    ]);
    expect(text).toContain("Where are you?\nAnswer: a location was shared for that request only");
    expect(text).toContain("Which city?\nAnswer: the person did not share a location");
  });

  it("gives the location controls only to the run's own user", () => {
    const snapshot = {
      messages: [
        {
          id: "m1",
          runId: "r1",
          blocks: [{ kind: "ask", text: "Where?", status: "pending", location: {} }],
        },
      ],
      activeRuns: [{ id: "r1", status: "waiting_input", userId: "owner" }],
    };
    expect(isLocationAskBlock(snapshot.messages[0]!.blocks[0]!)).toBe(true);
    expect(dismissableAskMessageIds(snapshot, "owner")).toEqual(new Set(["m1"]));
    expect(dismissableAskMessageIds(snapshot, "member")).toEqual(new Set());
  });
});
