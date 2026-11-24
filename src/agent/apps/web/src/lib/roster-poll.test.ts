import { describe, expect, it } from "vitest";
import { ROSTER_POLL_ACTIVE_MS, ROSTER_POLL_IDLE_MS, rosterPollInterval } from "./roster-poll";

const summary = (working: number) => ({ open: 1, unread: 0, waiting: 0, working, revision: "r" });

describe("rosterPollInterval", () => {
  it("checks often while a Mico or one of its conversations works", () => {
    expect(rosterPollInterval([{ status: "idle" }, { status: "running" }])).toBe(ROSTER_POLL_ACTIVE_MS);
    expect(rosterPollInterval([{ status: "queued" }])).toBe(ROSTER_POLL_ACTIVE_MS);
    expect(rosterPollInterval([{ status: "idle", conversations: summary(1) }])).toBe(
      ROSTER_POLL_ACTIVE_MS,
    );
  });

  it("slows down when nothing works, including Micos waiting for the person", () => {
    expect(rosterPollInterval([])).toBe(ROSTER_POLL_IDLE_MS);
    expect(
      rosterPollInterval([
        { status: "idle", conversations: summary(0) },
        { status: "waiting_input" },
        { status: "waiting_takeover" },
      ]),
    ).toBe(ROSTER_POLL_IDLE_MS);
  });
});
