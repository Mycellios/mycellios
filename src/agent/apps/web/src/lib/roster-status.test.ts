import { describe, expect, it, vi } from "vitest";
import {
  compactRosterStatusLabel,
  rosterConversationStatusLabel,
  rosterHasUndismissedRunError,
  rosterRowSignal,
  rosterWorkStatusLabel,
  unreadBadgeText,
} from "./roster-status";

vi.mock("@lingui/core/macro", () => ({
  t: (strings: TemplateStringsArray, ...values: unknown[]) => String.raw(strings, ...values),
}));

describe("rosterHasUndismissedRunError", () => {
  it("shows a failure only until its run ID is dismissed", () => {
    expect(rosterHasUndismissedRunError("run-failed", new Set())).toBe(true);
    expect(rosterHasUndismissedRunError("run-failed", new Set(["run-failed"]))).toBe(false);
    expect(rosterHasUndismissedRunError(null, new Set())).toBe(false);
  });
});

describe("rosterWorkStatusLabel", () => {
  it("names queued, leased, and running work for the sidebar", () => {
    expect(rosterWorkStatusLabel("queued")).toBe("Waiting in line…");
    expect(rosterWorkStatusLabel("leased")).toBe("Starting…");
    expect(rosterWorkStatusLabel("running")).toBe("Working…");
  });

  it("leaves other statuses to the message preview", () => {
    expect(rosterWorkStatusLabel("idle")).toBeNull();
    expect(rosterWorkStatusLabel("waiting_input")).toBeNull();
    expect(rosterWorkStatusLabel("waiting_takeover")).toBeNull();
    expect(rosterWorkStatusLabel("completed")).toBeNull();
    expect(rosterWorkStatusLabel("failed")).toBeNull();
    expect(rosterWorkStatusLabel("cancelled")).toBeNull();
    expect(rosterWorkStatusLabel("")).toBeNull();
  });
});

describe("compactRosterStatusLabel", () => {
  it("keeps work, human-wait, and error states visible without a preview", () => {
    expect(compactRosterStatusLabel("queued")).toBe("Waiting in line…");
    expect(compactRosterStatusLabel("leased")).toBe("Starting…");
    expect(compactRosterStatusLabel("running")).toBe("Working…");
    expect(compactRosterStatusLabel("waiting_input")).toBe("Needs an answer");
    expect(compactRosterStatusLabel("waiting_takeover")).toBe("Needs you");
    expect(compactRosterStatusLabel("failed")).toBe("Error");
  });

  it("does not add status text to idle rows", () => {
    expect(compactRosterStatusLabel("idle")).toBeNull();
  });
});

describe("rosterRowSignal", () => {
  const conversations = (extra: Partial<{ unread: number; waiting: number; working: number }> = {}) =>
    ({ unread: 0, waiting: 0, working: 0, ...extra });
  it("puts what waits for the person first, then failures, work, main-chat replies and conversation replies", () => {
    expect(rosterRowSignal({ status: "waiting_input", unread: true, conversations: conversations({ waiting: 1 }) }, true)).toBe("answer");
    expect(rosterRowSignal({ status: "waiting_takeover" })).toBe("takeover");
    expect(rosterRowSignal({ status: "running", conversations: conversations({ waiting: 1 }) }, true)).toBe("conversation-waiting");
    expect(rosterRowSignal({ status: "running", unread: true }, true)).toBe("error");
    expect(rosterRowSignal({ status: "queued", unread: true })).toBe("working");
    expect(rosterRowSignal({ status: "idle", unread: true, conversations: conversations({ working: 1 }) })).toBe("working");
    expect(rosterRowSignal({ status: "idle", unread: true, unreadCount: 3, conversations: conversations({ unread: 2 }) })).toBe("unread");
    expect(rosterRowSignal({ status: "idle", conversations: conversations({ unread: 2 }) })).toBe("conversation-unread");
    expect(rosterRowSignal({ status: "idle", conversations: conversations() })).toBeNull();
  });

  it("shows a number for main-chat replies only, capped at 99+", () => {
    expect(unreadBadgeText(undefined)).toBeNull();
    expect(unreadBadgeText(0)).toBeNull();
    expect(unreadBadgeText(7)).toBe("7");
    expect(unreadBadgeText(100)).toBe("99+");
  });

  it("names a conversation's state only while the main chat is idle", () => {
    expect(rosterConversationStatusLabel({ status: "idle", conversations: conversations({ waiting: 1, working: 1 }) })).toBe("A conversation needs you");
    expect(rosterConversationStatusLabel({ status: "idle", conversations: conversations({ working: 2 }) })).toBe("Working in a conversation…");
    expect(rosterConversationStatusLabel({ status: "running", conversations: conversations({ waiting: 1 }) })).toBeNull();
    expect(rosterConversationStatusLabel({ status: "idle" })).toBeNull();
  });
});
