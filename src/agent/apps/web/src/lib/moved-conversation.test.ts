// @vitest-environment jsdom
import { beforeEach, expect, it } from "vitest";
import { openMovedConversation } from "./moved-conversation";
import { queryClient } from "./query";
import { readConversationRows, readConversationTabs, updateConversationTabs } from "./thread-tabs";

beforeEach(() => { localStorage.clear(); queryClient.clear(); });

it("adds the moved conversation as a background tab with its title, once", () => {
  updateConversationTabs("scope", state => ({ ...state, ids: ["a"], active: "a" }));
  openMovedConversation("scope", "moved", "Plan the trip");
  openMovedConversation("scope", "moved", "Plan the trip");
  expect(readConversationTabs("scope")).toMatchObject({ ids: ["a", "moved"], active: "a" });
  expect(readConversationRows("scope")).toEqual([
    { threadId: "moved", title: "Plan the trip", kind: "conversation", startedBy: "user", state: "queued" },
  ]);
});
