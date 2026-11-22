import type { InboxTask } from "@mycellios/contracts";
import { expect, it } from "vitest";
import { taskIsActive, taskOutcome, taskSection, taskTone } from "./task-sections";

const item = { status: "completed", unread: true, archivedAt: null } as InboxTask;
it("keeps answered conversations visible until explicitly archived, even after reading", () => {
  expect(taskSection(item)).toBe("newReplies");
  expect(taskSection({ ...item, unread: false })).toBe("pending");
  expect(taskSection({ ...item, status: "running" })).toBe("working");
  expect(taskSection({ ...item, status: "queued" })).toBe("waiting");
  expect(taskSection({ ...item, archivedAt: new Date().toISOString() })).toBe("archived");
});
it("puts conversations that have not started yet in Waiting, not in To continue", () => {
  expect(taskSection({ ...item, status: null, runId: null })).toBe("waiting");
  expect(taskSection({ ...item, status: null, runId: null, outcome: null })).toBe("waiting");
  expect(taskOutcome({ ...item, status: null, runId: null })).toBeNull();
  expect(taskIsActive({ ...item, status: null, runId: null })).toBe(false);
  expect(taskSection({ ...item, status: "cancelled", unread: false })).toBe("pending");
});
it.each(["waiting_input", "waiting_takeover", "failed"] as const)(
  "keeps %s tasks visible as needing attention",
  (status) => expect(taskSection({ ...item, status })).toBe("needsYou"),
);
it("does not allow a still-running task to be archived", () => {
  expect(taskIsActive({ ...item, status: "waiting_input" })).toBe(true);
  expect(taskIsActive({ ...item, status: "completed" })).toBe(false);
});

it("keeps work resumed from its existing Mico tab visible even when its earlier inbox entry was archived", () => {
  expect(taskSection({ ...item, archivedAt: new Date().toISOString(), status: "running" })).toBe(
    "working",
  );
});

it("keeps pinned conversations once at the top and prioritizes due reminders", () => {
  expect(taskSection({ ...item, pinned: true })).toBe("pinned");
  expect(
    taskSection({ ...item, unread: false, remindAt: new Date(Date.now() - 1000).toISOString() }),
  ).toBe("needsYou");
  expect(
    taskSection({ ...item, unread: false, remindAt: new Date(Date.now() + 60000).toISOString() }),
  ).toBe("pending");
  expect(taskSection({ ...item, pinned: true, archivedAt: new Date().toISOString() })).toBe(
    "archived",
  );
});

it("reads how the last turn ended from the conversation before the latest run", () => {
  // Background work after a failed turn does not hide the failure.
  expect(taskOutcome({ ...item, status: "completed", outcome: "failed" })).toBe("failed");
  expect(taskSection({ ...item, status: "completed", outcome: "failed" })).toBe("needsYou");
  expect(taskOutcome({ ...item, status: "completed", outcome: "interrupted" })).toBe("stopped");
  expect(taskOutcome({ ...item, status: "failed", outcome: "completed" })).toBe("answered");
  // Servers without the conversation's record fall back to the latest run.
  expect(taskOutcome({ ...item, status: "cancelled" })).toBe("stopped");
  expect(taskOutcome({ ...item, status: "failed", outcome: null })).toBe("failed");
  expect(taskOutcome({ ...item, status: "running", outcome: "failed" })).toBeNull();
});

it("colours failed and stopped work red, work that needs the person amber, and unread replies blue", () => {
  expect(taskTone({ ...item, status: "failed" })).toBe("danger");
  expect(taskTone({ ...item, status: "cancelled", unread: false })).toBe("danger");
  expect(taskTone({ ...item, status: "waiting_input" })).toBe("attention");
  expect(taskTone({ ...item, status: "waiting_takeover", pinned: true })).toBe("attention");
  expect(
    taskTone({ ...item, unread: false, remindAt: new Date(Date.now() - 1000).toISOString() }),
  ).toBe("attention");
  expect(taskTone(item)).toBe("reply");
  expect(taskTone({ ...item, unread: false })).toBeNull();
  expect(taskTone({ ...item, status: "running" })).toBeNull();
  expect(taskTone({ ...item, status: null, runId: null })).toBeNull();
});
