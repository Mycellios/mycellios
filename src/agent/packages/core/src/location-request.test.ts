import { describe, expect, it } from "vitest";
import { dismissableAskMessageIds } from "./answerable-ask.js";
import { blocksToAgentHistoryText } from "./attachments.js";
import {
  isLocationAskBlock,
  LOCATION_ANSWER_MARKER,
  locationAnswerPrompt,
  withoutLocationAnswer,
} from "./location-request.js";

describe("location request prompts", () => {
  it("tells the turn the shared position once and keeps it out of later use", () => {
    const prompt = locationAnswerPrompt({
      kind: "position",
      latitude: 40.417,
      longitude: -3.704,
      accuracyMeters: 100,
    });
    expect(prompt.startsWith(LOCATION_ANSWER_MARKER)).toBe(true);
    expect(prompt).toContain("latitude 40.417, longitude -3.704 (within about 100 m)");
    expect(prompt).toContain("Do not save it");
    expect(locationAnswerPrompt({ kind: "place", place: 'Gran "Via"' })).toContain(
      '"Gran \\"Via\\""',
    );
    expect(locationAnswerPrompt({ kind: "declined" })).not.toContain(LOCATION_ANSWER_MARKER);
  });

  it("stores the prompt without the location, once and idempotently", () => {
    const shared = locationAnswerPrompt({ kind: "place", place: "Madrid" });
    const stored = withoutLocationAnswer(`Earlier task\n\nWhere?\nAnswer: ${shared}`);
    expect(stored.startsWith("Earlier task\n\nWhere?\nAnswer: ")).toBe(true);
    expect(stored).not.toContain("Madrid");
    expect(stored).toContain("not kept");
    expect(withoutLocationAnswer(stored)).toBe(stored);
    expect(withoutLocationAnswer("restaurants near me")).toBe("restaurants near me");
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
