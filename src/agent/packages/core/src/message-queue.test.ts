import { MESSAGE_QUEUE_CONFLICT_CODES } from "@mycellios/contracts";
import { describe, expect, it } from "vitest";
import { reduceLiveMessageBlocks } from "./events.js";
import {
  framedSteeringText,
  MessageQueueConflictError,
  messageQueueConflictMessage,
  queueHoldingFailure,
  STEERING_FRAMING_NOTE,
} from "./message-queue.js";
import { HOSTED_MODEL_CREDITS_REQUIRED_ERROR } from "./run-error.js";

describe("queueHoldingFailure", () => {
  it("holds the queue after usage, credit and key limits", () => {
    expect(queueHoldingFailure(HOSTED_MODEL_CREDITS_REQUIRED_ERROR)).toBe("usage");
    expect(
      queueHoldingFailure(
        JSON.stringify({
          error: { code: "insufficient_quota", message: "You exceeded your current quota" },
        }),
      ),
    ).toBe("usage");
  });

  it("holds the queue when a sign-in or a working key is needed", () => {
    expect(
      queueHoldingFailure(
        "Install and sign in to codex on the computer running this server first.",
      ),
    ).toBe("signin");
  });

  it("lets the queue continue after other failures", () => {
    expect(queueHoldingFailure(null)).toBeNull();
    expect(queueHoldingFailure("")).toBeNull();
    expect(
      queueHoldingFailure("The model hit its output limit before writing a response."),
    ).toBeNull();
    expect(queueHoldingFailure("Backend maintenance in progress")).toBeNull();
  });
});

describe("steering framing", () => {
  it("puts the framing note before the person's own words", () => {
    const framed = framedSteeringText("Use March, not April.");
    expect(framed.startsWith("<mycellios_steering>")).toBe(true);
    expect(framed).toContain(STEERING_FRAMING_NOTE);
    expect(framed.endsWith("\n\nUse March, not April.")).toBe(true);
  });

  it("says what a steered message means: it adds, questions get short answers, corrections apply, work goes on", () => {
    expect(STEERING_FRAMING_NOTE).toMatch(/adds to the work in progress/);
    expect(STEERING_FRAMING_NOTE).toMatch(/answer it in a sentence or two/);
    expect(STEERING_FRAMING_NOTE).toMatch(/correction from this point on/);
    expect(STEERING_FRAMING_NOTE).toMatch(/unless the message asks you to stop/);
  });
});

describe("queue conflicts", () => {
  it("explains every conflict code", () => {
    for (const code of MESSAGE_QUEUE_CONFLICT_CODES) {
      expect(messageQueueConflictMessage(code).length).toBeGreaterThan(10);
      expect(new MessageQueueConflictError(code).code).toBe(code);
    }
    expect(messageQueueConflictMessage("routine")).toBe(
      "A routine is running now, so the message waits in the queue.",
    );
  });
});

describe("background work status", () => {
  it("keeps a timed status line while the turn waits for its own background work", () => {
    const blocks = reduceLiveMessageBlocks([], {
      type: "progress",
      payload: {
        text: "",
        activity: true,
        waiting: "background",
        since: "2026-11-22T10:00:00.000Z",
      },
    });
    expect(blocks).toEqual([
      {
        kind: "progress",
        text: "",
        activity: true,
        waiting: "background",
        since: "2026-11-22T10:00:00.000Z",
      },
    ]);
    // The next activity replaces it.
    expect(
      reduceLiveMessageBlocks(blocks, {
        type: "progress",
        payload: { text: "Reading files", activity: true },
      }),
    ).toEqual([{ kind: "progress", text: "Reading files", activity: true }]);
  });
});
