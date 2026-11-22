import { describe, expect, it } from "vitest";
import { createGroupNoticeGate, createTeammateRunTracker, groupWorkStillRunning, isCompletionEvent } from "./notification-gates";

const reply = (runId: string, blocks: unknown[] = [{ kind: "text", text: "Done" }]) =>
  ({ type: "thread.message.created" as const, runId, payload: { role: "bot", blocks } });
const completed = (runId: string) => ({ type: "run.completed" as const, runId, payload: {} });

describe("teammate-started turns", () => {
  it("finish quietly while their failures, questions and failed helpers still alert", () => {
    const tracker = createTeammateRunTracker();
    tracker.observe({ type: "run.started", runId: "peer", payload: { trigger: "bot_message" } });
    tracker.observe({ type: "run.started", runId: "mine", payload: { trigger: "user" } });
    expect(tracker.quiet(reply("peer"))).toBe(true);
    expect(tracker.quiet(completed("peer"))).toBe(true);
    expect(tracker.quiet({ type: "run.failed", runId: "peer", payload: {} })).toBe(false);
    expect(tracker.quiet({ type: "thread.ask", runId: "peer", payload: {} })).toBe(false);
    expect(tracker.quiet(reply("peer", [{ kind: "subagent", status: "failed" }]))).toBe(false);
    expect(tracker.quiet(reply("mine"))).toBe(false);
  });
  it("recognizes a delegated turn from the snapshot or the message that woke it", () => {
    const tracker = createTeammateRunTracker();
    tracker.seed([{ id: "delegated", trigger: "delegated_task" }, { id: "own", trigger: "user" }]);
    tracker.observe({ type: "thread.message.created", runId: "woken", payload: { role: "user", blocks: [{ kind: "bot_message_received" }] } });
    expect(tracker.quiet(completed("delegated"))).toBe(true);
    expect(tracker.quiet(completed("woken"))).toBe(true);
    expect(tracker.quiet(completed("own"))).toBe(false);
  });
});

describe("group notices", () => {
  it("hold member replies until the group's last working turn ends, then alert once", () => {
    const gate = createGroupNoticeGate<ReturnType<typeof reply> | ReturnType<typeof completed>>();
    expect(gate(reply("a"), true)).toEqual({ hold: true });
    expect(gate(completed("a"), true)).toEqual({ hold: true });
    const last = reply("b");
    expect(gate(last, false)).toEqual({ hold: true });
    expect(gate(completed("b"), false)).toEqual({ hold: false, release: last });
    expect(gate(completed("c"), false)).toEqual({ hold: false });
  });
  it("keeps holding after a handoff until the next member's turn has run", () => {
    type Event = { type: "thread.message.created" | "run.completed" | "run.started" | "group.handoff"; runId: string; payload: Record<string, unknown> };
    const gate = createGroupNoticeGate<Event>(60_000);
    const first = reply("a") as Event;
    gate(first, false, 0);
    gate({ type: "group.handoff", runId: "a", payload: {} }, false, 1);
    expect(gate(completed("a") as Event, false, 2)).toEqual({ hold: true });
    gate({ type: "run.started", runId: "b", payload: {} }, false, 3);
    const last = reply("b") as Event;
    gate(last, false, 4);
    expect(gate(completed("b") as Event, false, 5)).toEqual({ hold: false, release: last });
    // A handoff whose turn never starts stops holding after the window.
    gate({ type: "group.handoff", runId: "c", payload: {} }, false, 10);
    expect(gate(completed("c") as Event, false, 70_011)).toEqual({ hold: false });
  });
  it("lets a failed helper through and only counts working member turns", () => {
    const gate = createGroupNoticeGate<ReturnType<typeof reply>>();
    expect(gate(reply("a", [{ kind: "subagent", status: "failed" }]), true)).toEqual({ hold: false });
    expect(isCompletionEvent(reply("a"))).toBe(true);
    const runs = [{ id: "a", status: "completed" }, { id: "b", status: "waiting_input" }, { id: "c", status: "running" }] as const;
    expect(groupWorkStillRunning(runs, "c")).toBe(false);
    expect(groupWorkStillRunning(runs, "a")).toBe(true);
  });
});
