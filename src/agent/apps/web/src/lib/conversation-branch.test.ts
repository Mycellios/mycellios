// @vitest-environment jsdom
import type { ThreadMessage } from "@mycellios/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  branchableMessageIds,
  branchConversation,
  branchOriginBlock,
  branchRequestId,
  branchSource,
  openBranchTab,
} from "./conversation-branch";
import { queryClient } from "./query";
import type { RpcClient } from "./rpc";
import {
  NEW_CONVERSATION_TAB,
  readConversationRows,
  readConversationTabs,
  updateConversationTabs,
} from "./thread-tabs";

const message = (
  id: string,
  role: ThreadMessage["role"],
  text: string,
  extra: Partial<ThreadMessage> = {},
): ThreadMessage => ({
  id,
  threadId: "thread",
  seq: 0,
  role,
  blocks: [{ kind: "text", text }],
  createdAt: new Date(0).toISOString(),
  ...extra,
});

beforeEach(() => {
  localStorage.clear();
  queryClient.clear();
});

describe("which messages offer a branch", () => {
  it("marks the last Mico message of every turn, skipping notes, reactions, receipts and live rows", () => {
    const ids = branchableMessageIds([
      message("q1", "user", "Plan the trip"),
      message("note", "bot", "Looking at trains", { progress: true }),
      message("a1", "bot", "Here is the plan"),
      message("like", "user", "👍", { replyToMessageId: "a1" }),
      message("q2", "user", "And the hotels?"),
      message("a2-first", "bot", "One moment"),
      message("a2", "bot", "Two hotels"),
      {
        ...message("receipt", "bot", ""),
        blocks: [{ kind: "bot_message_sent", toBotId: "b", toBotName: "B", text: "hi" }],
      },
      message("reset", "system", ""),
      message("q3", "user", "Book it"),
      message("progress:run", "bot", "Booking…"),
    ]);
    expect([...ids]).toEqual(["a1", "a2"]);
  });

  it("closes the last turn too, and offers nothing in a chat without Mico replies", () => {
    expect([
      ...branchableMessageIds([message("q", "user", "Hi"), message("a", "bot", "Hello")]),
    ]).toEqual(["a"]);
    expect(branchableMessageIds([message("q", "user", "Hi")]).size).toBe(0);
  });
});

describe("the branch divider", () => {
  const origin = {
    kind: "branch_origin" as const,
    threadId: "source",
    messageId: "m",
    title: "Trip budget",
  };
  it("reads the block of a system message only", () => {
    expect(branchOriginBlock({ role: "system", blocks: [origin] })).toEqual(origin);
    expect(branchOriginBlock({ role: "bot", blocks: [origin] })).toBeNull();
  });

  it("names the main chat, the current title, or a deleted source", () => {
    expect(branchSource({ ...origin, main: true }, [], undefined)).toEqual({ kind: "main" });
    expect(
      branchSource(origin, [{ threadId: "source", title: "Renamed budget" }], undefined),
    ).toEqual({ kind: "conversation", title: "Renamed budget" });
    expect(branchSource(origin, [], undefined)).toEqual({
      kind: "conversation",
      title: "Trip budget",
    });
    expect(
      branchSource(origin, [], {
        threadId: "branch",
        title: "Trip budget #2",
        startedBy: "branch",
        branchedFromThreadId: null,
      }),
    ).toEqual({ kind: "deleted" });
    expect(
      branchSource(
        origin,
        [{ threadId: "source", title: "Trip budget", deleteAfter: new Date().toISOString() }],
        undefined,
      ),
    ).toEqual({ kind: "deleted" });
  });
});

describe("opening a branch", () => {
  it("puts the tab right after its source, or first when the source is the main chat", () => {
    updateConversationTabs("scope", (state) => ({
      ...state,
      ids: ["a", "b", NEW_CONVERSATION_TAB],
    }));
    openBranchTab("scope", "a", { threadId: "a2", title: "A #2" });
    expect(readConversationTabs("scope").ids).toEqual(["a", "a2", "b", NEW_CONVERSATION_TAB]);
    openBranchTab("scope", undefined, { threadId: "m2", title: "From main" });
    expect(readConversationTabs("scope").ids).toEqual(["m2", "a", "a2", "b", NEW_CONVERSATION_TAB]);
    openBranchTab("scope", "gone", { threadId: "g2", title: "Late" });
    expect(readConversationTabs("scope").ids.at(-1)).toBe("g2");
    expect(readConversationRows("scope").find((row) => row.threadId === "a2")).toMatchObject({
      title: "A #2",
      startedBy: "branch",
      branchedFromThreadId: "a",
      unread: false,
    });
  });

  it("retries with the same request id until a branch is made, then starts a new one", async () => {
    const first = branchRequestId("scope", "a", "m");
    expect(branchRequestId("scope", "a", "m")).toBe(first);
    expect(branchRequestId("scope", undefined, "m")).not.toBe(first);
    const branch = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ threadId: "a2", title: "A #2", replayed: false });
    const rpc = { development: { branch } } as unknown as RpcClient;
    await expect(
      branchConversation({ rpc, scope: "scope", botId: "mico", source: "a", messageId: "m" }),
    ).rejects.toThrow("offline");
    await branchConversation({ rpc, scope: "scope", botId: "mico", source: "a", messageId: "m" });
    expect(branch.mock.calls.map(([input]) => input.requestId)).toEqual([first, first]);
    expect(branch).toHaveBeenLastCalledWith({
      botId: "mico",
      taskThreadId: "a",
      messageId: "m",
      requestId: first,
    });
    expect(readConversationTabs("scope").ids).toContain("a2");
    expect(branchRequestId("scope", "a", "m")).not.toBe(first);
  });
});
