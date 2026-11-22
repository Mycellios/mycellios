// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  adoptNewConversation, capConversationTabs, closeOtherTabs, closeTabsToRight, conversationStatus, type ConversationRow,
  type ConversationTabs, EMPTY_CONVERSATION_TABS, forgetNewConversationRequest, moveTab, NEW_CONVERSATION_TAB,
  newConversationRequest, parkTab, parseConversationTabs, pickerConversations, placeTab, readConversationTabs,
  reconcileConversationTabs, STORED_TAB_LIMIT, unparkTab, updateConversationTabs,
} from "./thread-tabs";

const tabs = (ids: string[], extra: Partial<ConversationTabs> = {}): ConversationTabs =>
  ({ ...EMPTY_CONVERSATION_TABS, ids, agentSince: new Date(0).toISOString(), ...extra });
const row = (threadId: string, extra: Partial<ConversationRow> = {}): ConversationRow =>
  ({ threadId, title: threadId, createdAt: "2026-11-20T10:00:00.000Z", ...extra });

beforeEach(() => localStorage.clear());

describe("conversation tab storage", () => {
  it("reads the plain id list older versions stored and keeps order, active tab and parked places", () => {
    expect(parseConversationTabs(JSON.stringify(["a", "b", "a", 4]))).toMatchObject({ ids: ["a", "b"], active: null, agentSince: null });
    expect(parseConversationTabs("{broken")).toBe(EMPTY_CONVERSATION_TABS);
    updateConversationTabs("scope", () => tabs(["b", "a"], { active: "a", parked: [{ id: "c", index: 1 }] }));
    expect(readConversationTabs("scope")).toMatchObject({ ids: ["b", "a"], active: "a", parked: [{ id: "c", index: 1 }] });
    expect(JSON.parse(localStorage.getItem("mycellios:open-task-tabs:scope")!)).toMatchObject({ v: 2, ids: ["b", "a"], active: "a" });
  });

  it("stores at most fifty ids but keeps the active tab, without limiting conversations", () => {
    const ids = Array.from({ length: 60 }, (_, index) => `t${index}`);
    const capped = capConversationTabs(tabs(ids, { active: "t0" }));
    expect(capped.ids).toHaveLength(STORED_TAB_LIMIT);
    expect(capped.ids[0]).toBe("t0");
    expect(capped.ids.at(-1)).toBe("t59");
    expect(capConversationTabs(tabs(ids.slice(0, 50)))).toEqual(tabs(ids.slice(0, 50)));
  });

  it("closes others and tabs to the right, also from the main tab", () => {
    const state = tabs(["a", "b", "c"]);
    expect(closeOtherTabs(state, "b").ids).toEqual(["b"]);
    expect(closeOtherTabs(state, null).ids).toEqual([]);
    expect(closeTabsToRight(state, "a").ids).toEqual(["a"]);
    expect(closeTabsToRight(state, null).ids).toEqual([]);
    expect(closeTabsToRight(state, "c")).toBe(state);
  });

  it("moves and places tabs within bounds", () => {
    const state = tabs(["a", "b", "c"]);
    expect(moveTab(state, "a", 1).ids).toEqual(["b", "a", "c"]);
    expect(moveTab(state, "a", -1)).toBe(state);
    expect(placeTab(state, "c", 0).ids).toEqual(["c", "a", "b"]);
    expect(placeTab(state, "a", 9).ids).toEqual(["b", "c", "a"]);
  });

  it("parks a tab at its place and puts it back there", () => {
    const parked = parkTab(tabs(["a", "b", "c"]), "b");
    expect(parked).toMatchObject({ ids: ["a", "c"], parked: [{ id: "b", index: 1 }] });
    expect(unparkTab(parked, "b")).toMatchObject({ ids: ["a", "b", "c"], parked: [] });
  });

  it("turns the draft tab into the conversation its first message made, in the same place", () => {
    expect(adoptNewConversation(tabs(["a", NEW_CONVERSATION_TAB, "b"]), "new")).toMatchObject({ ids: ["a", "new", "b"], active: "new" });
    expect(adoptNewConversation(tabs(["a"]), "new")).toMatchObject({ ids: ["a", "new"], active: "new" });
  });

  it("reuses the draft's request key until it is forgotten", () => {
    const first = newConversationRequest("scope", "mico");
    expect(first).toMatch(/^mico-task:mico:/);
    expect(newConversationRequest("scope", "mico")).toBe(first);
    forgetNewConversationRequest("scope");
    expect(newConversationRequest("scope", "mico")).not.toBe(first);
    expect(newConversationRequest("scope", "other")).toMatch(/^mico-task:other:/);
  });
});

describe("reconciling tabs with the server", () => {
  it("only records the newest time on the first list, then opens new Mico-started conversations in the background", () => {
    const first = reconcileConversationTabs(EMPTY_CONVERSATION_TABS, [row("old", { startedBy: "agent" })]);
    expect(first).toMatchObject({ ids: [], agentSince: "2026-11-20T10:00:00.000Z" });
    const rows = [
      row("old", { startedBy: "agent" }),
      row("mine", { startedBy: "user", createdAt: "2026-11-21T10:00:00.000Z" }),
      row("task-b", { startedBy: "agent", createdAt: "2026-11-21T12:00:00.000Z" }),
      row("task-a", { startedBy: "agent", createdAt: "2026-11-21T11:00:00.000Z" }),
      row("closed", { startedBy: "agent", createdAt: "2026-11-21T13:00:00.000Z", archived: true }),
    ];
    const next = reconcileConversationTabs({ ...first, ids: ["x"], active: "x" }, rows, { activeId: "x" });
    expect(next.ids).toEqual(["x", "task-a", "task-b"]);
    expect(next.active).toBe("x");
    expect(next.agentSince).toBe("2026-11-21T13:00:00.000Z");
    // A Mico-started tab the person closed stays closed.
    expect(reconcileConversationTabs({ ...next, ids: ["x"] }, rows, { activeId: "x" }).ids).toEqual(["x"]);
  });

  it("closes the tab of a conversation archived or deleted elsewhere and brings it back on restore", () => {
    const open = tabs(["a", "b", "c"]);
    const closed = reconcileConversationTabs(open, [row("a"), row("b", { archived: true }), row("c", { deleteAfter: "2026-11-22T00:00:06.000Z" })]);
    expect(closed).toMatchObject({ ids: ["a"], parked: [{ id: "b", index: 1 }, { id: "c", index: 1 }] });
    const restored = reconcileConversationTabs(closed, [row("a"), row("b"), row("c", { deleteAfter: "2026-11-22T00:00:06.000Z" })]);
    expect(restored.ids).toEqual(["a", "b"]);
    // A purged conversation is forgotten once the list is complete.
    expect(reconcileConversationTabs(restored, [row("a"), row("b")], { complete: true }).parked).toEqual([]);
  });

  it("keeps the open view of an archived conversation unless it was archived while open", () => {
    const state = tabs(["a"]);
    const archived = [row("a", { archived: true })];
    expect(reconcileConversationTabs(state, archived, { activeId: "a" }).ids).toEqual(["a"]);
    expect(reconcileConversationTabs(state, archived, { activeId: "a", previous: [row("a", { archived: true })] }).ids).toEqual(["a"]);
    expect(reconcileConversationTabs(state, archived, { activeId: "a", previous: [row("a")] }).ids).toEqual([]);
  });

  it("drops tabs of conversations that no longer exist, but not the one just opened", () => {
    const state = tabs(["gone", "fresh", NEW_CONVERSATION_TAB]);
    expect(reconcileConversationTabs(state, [], { activeId: "fresh", complete: true }).ids).toEqual(["fresh", NEW_CONVERSATION_TAB]);
    expect(reconcileConversationTabs(state, [], { activeId: "fresh", complete: false }).ids).toEqual(state.ids);
  });
});

describe("conversation status and picker order", () => {
  it("shows what a conversation does first, then how it ended, then an unread reply", () => {
    expect(conversationStatus(row("a", { state: "running", unread: true }))).toBe("working");
    expect(conversationStatus(row("a", { state: "queued" }))).toBe("queued");
    expect(conversationStatus(row("a", { state: "waiting", outcome: "failed" }))).toBe("waiting");
    expect(conversationStatus(row("a", { state: "idle", outcome: "failed", unread: true }))).toBe("failed");
    expect(conversationStatus(row("a", { state: "idle", unread: true }))).toBe("unread");
    expect(conversationStatus(row("a", { state: "closed", unread: true }))).toBeNull();
    expect(conversationStatus(row("a"))).toBeNull();
  });

  it("lists open conversations by latest activity, archived ones after, and hides deleting ones", () => {
    const picker = pickerConversations([
      row("old", { updatedAt: "2026-11-01T00:00:00.000Z" }),
      row("new", { updatedAt: "2026-11-21T00:00:00.000Z" }),
      row("legacy"),
      row("archived-old", { archived: true, updatedAt: "2026-10-01T00:00:00.000Z" }),
      row("archived-new", { archivedAt: "2026-11-02T00:00:00.000Z", updatedAt: "2026-11-02T00:00:00.000Z" }),
      row("deleting", { deleteAfter: "2026-11-22T00:00:06.000Z" }),
    ]);
    expect(picker.open.map(item => item.threadId)).toEqual(["new", "legacy", "old"]);
    expect(picker.archived.map(item => item.threadId)).toEqual(["archived-new", "archived-old"]);
  });
});
