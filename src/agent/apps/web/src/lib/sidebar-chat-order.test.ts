import { expect, it } from "vitest";
import { orderSidebarChats } from "./sidebar-chat-order";
const row = (id: string, unread = false, updatedAt = "2026-11-10", status = "idle", pinned = false) => ({
  kind: "bot", chat: { id, unread, updatedAt, status, pinned },
});
const groups = [
  { key: "pinned", spaceId: "s1", bots: [row("pin", true, "2026-11-09", "idle", true)] },
  { key: "folder", spaceId: "s1", bots: [row("read"), row("unread", true), row("question", true, "2026-11-08", "waiting_input")] },
  { key: "space:s2:unassigned", spaceId: "s2", bots: [row("other", true)] },
];
it("keeps the saved manual order and input arrays intact", () => {
  const before = JSON.stringify(groups);
  expect(orderSidebarChats(groups, "manual", "Unread")).toEqual(groups);
  orderSidebarChats(groups, "unread-first", "Unread"); orderSidebarChats(groups, "unread-group", "Unread");
  expect(JSON.stringify(groups)).toBe(before);
});
it("sorts unread first within each section, retaining pins and required replies", () => {
  const result = orderSidebarChats(groups, "unread-first", "Unread");
  expect(result[0]!.bots.map(row => row.chat.id)).toEqual(["pin"]);
  expect(result[1]!.bots.map(row => row.chat.id)).toEqual(["question", "unread", "read"]);
});
it("groups unread separately per Space without duplicating pinned or waiting chats", () => {
  const result = orderSidebarChats(groups, "unread-group", "Unread");
  expect(result.find(group => group.key === "space:s1:unread")!.bots.map(row => row.chat.id)).toEqual(["unread"]);
  expect(result.find(group => group.key === "space:s2:unread")!.bots.map(row => row.chat.id)).toEqual(["other"]);
  expect(result.find(group => group.key === "folder")!.bots.map(row => row.chat.id)).toEqual(["read", "question"]);
  expect(result.flatMap(group => group.bots).map(row => row.chat.id).sort()).toEqual(["other", "pin", "question", "read", "unread"]);
});
it("puts a read chat back into its saved section and orders activity newest first", () => {
  const result = orderSidebarChats([{ key: "folder", spaceId: "s1", bots: [row("old", true), row("new", true, "2026-11-11")] }], "unread-first", "Unread");
  expect(result[0]!.bots.map(row => row.chat.id)).toEqual(["new", "old"]);
  const readAgain = groups.map(group => ({ ...group, bots: group.bots.map(item => ({ ...item, chat: { ...item.chat, unread: false } })) }));
  expect(orderSidebarChats(readAgain, "unread-group", "Unread").some(group => group.key.endsWith(":unread"))).toBe(false);
});
