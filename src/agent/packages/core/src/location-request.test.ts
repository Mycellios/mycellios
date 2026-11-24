import { describe, expect, it } from "vitest";
import { dismissableAskMessageIds } from "./answerable-ask.js";
import { blocksToAgentHistoryText } from "./attachments.js";
import { redactSecrets } from "./events.js";
import {
  isLocationAnswerPrompt,
  isLocationAskBlock,
  LOCATION_ANSWER_MARKER,
  LOCATION_ANSWER_NOTE,
  LOCATION_DECLINED_PROMPT,
  locationAnswerPrompt,
  locationAnswerTaskPrompt,
  locationRedactionValues,
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

  it("hides the answer in kept tool activity", () => {
    const hide = (text: string, answer: Parameters<typeof locationRedactionValues>[0]) =>
      redactSecrets(text, locationRedactionValues(answer));
    expect(hide("Searching the web: restaurants near 40.417,-3.704", position)).toBe(
      "Searching the web: restaurants near [redacted]",
    );
    expect(hide("Running: curl wttr.in/40.417, -3.704?format=3", position)).not.toMatch(
      /40\.417|-3\.704/,
    );
    expect(hide("lat=40.417&lon=-3.704", position)).toBe("lat=[redacted]&lon=[redacted]");
    expect(
      hide("Searching the web: tapas Gran Via, Madrid", {
        kind: "place",
        place: "Gran Via, Madrid",
      }),
    ).toBe("Searching the web: tapas [redacted]");
    // Short coordinates alone would hide unrelated numbers; only the pair is hidden.
    expect(locationRedactionValues({ kind: "position", latitude: 1.5, longitude: 0 })).toEqual([
      "1.5,0",
      "1.5, 0",
      "1.5 0",
    ]);
    expect(locationRedactionValues({ kind: "declined" })).toEqual([]);
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
