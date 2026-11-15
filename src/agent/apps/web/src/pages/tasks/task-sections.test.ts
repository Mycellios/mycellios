import type { InboxTask } from "@rakazo/contracts";
import { expect, it } from "vitest";
import { taskIsActive, taskSection } from "./task-sections";

const item = { status: "completed", unread: true, archivedAt: null } as InboxTask;
it("keeps answered conversations visible until explicitly archived, even after reading", () => {
  expect(taskSection(item)).toBe("newReplies");
  expect(taskSection({ ...item, unread: false })).toBe("pending");
  expect(taskSection({ ...item, status: "running" })).toBe("working");
  expect(taskSection({ ...item, status: "queued" })).toBe("waiting");
  expect(taskSection({ ...item, archivedAt: new Date().toISOString() })).toBe("archived");
});
it("lists named conversations without a run as not-started work, not completed work", () => {
  expect(taskSection({ ...item, status: null, runId: null })).toBe("pending");
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
  expect(taskSection({ ...item, archivedAt: new Date().toISOString(), status: "running" })).toBe("working");
});

it('keeps pinned conversations once at the top and prioritizes due reminders',()=>{
 expect(taskSection({...item,pinned:true})).toBe('pinned');
 expect(taskSection({...item,unread:false,remindAt:new Date(Date.now()-1000).toISOString()})).toBe('needsYou');
 expect(taskSection({...item,unread:false,remindAt:new Date(Date.now()+60000).toISOString()})).toBe('pending');
 expect(taskSection({...item,pinned:true,archivedAt:new Date().toISOString()})).toBe('archived');
});
