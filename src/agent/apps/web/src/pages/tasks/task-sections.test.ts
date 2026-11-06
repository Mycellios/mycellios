import type { InboxTask } from "@rakazo/contracts";
import { expect, it } from "vitest";
import { taskIsActive, taskSection } from "./task-sections";

const item = { status: "completed", unread: true, archivedAt: null } as InboxTask;
it("separates new answers, read work, active work and archived conversations", () => {
  expect(taskSection(item)).toBe("unread");
  expect(taskSection({ ...item, unread: false })).toBe("read");
  expect(taskSection({ ...item, status: "running" })).toBe("working");
  expect(taskSection({ ...item, status: "queued" })).toBe("waiting");
  expect(taskSection({ ...item, archivedAt: new Date().toISOString() })).toBe("archived");
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
  expect(taskSection({ ...item, archivedAt: new Date().toISOString(), status: "running" })).toBe("working");
});
