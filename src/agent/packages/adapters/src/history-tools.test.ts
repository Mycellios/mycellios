import {
  AGENT_TASK_NOT_AVAILABLE_ERROR,
  HISTORY_CONVERSATION_NOT_AVAILABLE_ERROR,
  HISTORY_LIST_NOT_AVAILABLE_ERROR,
} from "@mycellios/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  findPinTarget: vi.fn(),
  isMicoConversation: vi.fn(),
  isOwnedAgentTask: vi.fn(),
  listHistoryConversations: vi.fn(),
  micoConversationOfMessage: vi.fn(),
  readHistory: vi.fn(),
  readHistoryPage: vi.fn(),
  searchHistory: vi.fn(),
  searchHistoryAcross: vi.fn(),
  setAgentMessagePin: vi.fn(),
}));
vi.mock("@mycellios/db", async (original) => ({ ...(await original<object>()), ...db }));
import { MessagePinError } from "@mycellios/db";
import { PIN_MESSAGE_INPUT_ERROR, PIN_MESSAGE_NOT_FOUND_ERROR, runHistoryTool, runPinMessageTool } from "./history-tools.js";

const prisma = {} as never;
const run = { spaceId: "space", userId: "user", botId: "bot", threadId: "current" };
const fence = { spaceId: "space", userId: "user", botId: "bot" };
const tool = (name: "search_history" | "read_history", args: Record<string, unknown>, access: "across" | "own_tasks" | "current" = "across") =>
  runHistoryTool(prisma, { name, args, run, access, channelId: undefined, searchBeforeSeq: 12 });

beforeEach(() => {
  vi.clearAllMocks();
  for (const fn of [db.listHistoryConversations, db.readHistory, db.readHistoryPage, db.searchHistory, db.searchHistoryAcross])
    fn.mockResolvedValue({ untrusted: true, messages: [] });
  db.isMicoConversation.mockResolvedValue(true);
  db.isOwnedAgentTask.mockResolvedValue(true);
  db.micoConversationOfMessage.mockResolvedValue(null);
});

describe("history tools across a Mico's conversations", () => {
  it("lists conversations without a query, from the current conversation's fence", async () => {
    await tool("search_history", { query: "  ", limit: 3, cursor: "1767225600000~x" });
    expect(db.listHistoryConversations).toHaveBeenCalledWith(prisma, { ...fence, currentThreadId: "current" }, expect.objectContaining({ limit: 3, cursor: "1767225600000~x" }));
    expect(db.searchHistory).not.toHaveBeenCalled();
  });

  it("searches across conversations with a query, and one conversation with a taskId or a continuation", async () => {
    await tool("search_history", { query: "launch" });
    expect(db.searchHistoryAcross).toHaveBeenCalledWith(prisma, { ...fence, threadId: "current", channelId: undefined, searchBeforeSeq: 12 }, expect.objectContaining({ query: "launch" }));
    await tool("search_history", { query: "launch", taskId: "side" });
    expect(db.isMicoConversation).toHaveBeenCalledWith(prisma, fence, "side");
    expect(db.searchHistory).toHaveBeenLastCalledWith(prisma, { ...fence, threadId: "side" }, expect.objectContaining({ query: "launch", taskId: "side" }));
    await tool("search_history", { query: "launch", beforeSeq: 4 });
    expect(db.searchHistory).toHaveBeenLastCalledWith(prisma, { ...fence, threadId: "current", channelId: undefined, searchBeforeSeq: 12 }, expect.objectContaining({ beforeSeq: 4 }));
    expect(db.searchHistoryAcross).toHaveBeenCalledTimes(1);
  });

  it("reads any of the Mico's conversations by taskId, and follows a message id into its conversation", async () => {
    await tool("read_history", { taskId: "routine-thread", limit: 20 });
    expect(db.readHistoryPage).toHaveBeenCalledWith(prisma, { ...fence, threadId: "routine-thread" }, expect.objectContaining({ limit: 20 }));
    db.micoConversationOfMessage.mockResolvedValueOnce("side");
    await tool("read_history", { messageId: "elsewhere" });
    expect(db.readHistory).toHaveBeenCalledWith(prisma, { ...fence, threadId: "side" }, expect.objectContaining({ messageId: "elsewhere" }));
  });

  it("refuses a conversation outside the fence and reads nothing", async () => {
    db.isMicoConversation.mockResolvedValue(false);
    expect(await tool("read_history", { taskId: "group-thread" })).toEqual({ untrusted: true, error: HISTORY_CONVERSATION_NOT_AVAILABLE_ERROR });
    expect(await tool("search_history", { query: "x", taskId: "other-mico" })).toEqual({ untrusted: true, error: HISTORY_CONVERSATION_NOT_AVAILABLE_ERROR });
    expect(db.readHistoryPage).not.toHaveBeenCalled();
    expect(db.searchHistory).not.toHaveBeenCalled();
  });
});

describe("history tools kept to one conversation", () => {
  it("in a routine thread reads only the tasks the Mico opened", async () => {
    await tool("read_history", { taskId: "agent-task" }, "own_tasks");
    expect(db.isOwnedAgentTask).toHaveBeenCalledWith(prisma, fence, "agent-task");
    expect(db.isMicoConversation).not.toHaveBeenCalled();
    db.isOwnedAgentTask.mockResolvedValue(false);
    expect(await tool("read_history", { taskId: "main" }, "own_tasks")).toEqual({ untrusted: true, error: AGENT_TASK_NOT_AVAILABLE_ERROR });
  });

  it("elsewhere never lists, searches across or follows a message into another conversation", async () => {
    expect(await tool("search_history", {}, "current")).toEqual({ untrusted: true, error: HISTORY_LIST_NOT_AVAILABLE_ERROR });
    expect(await tool("read_history", { taskId: "main" }, "current")).toEqual({ untrusted: true, error: HISTORY_CONVERSATION_NOT_AVAILABLE_ERROR });
    await tool("search_history", { query: "launch" }, "current");
    expect(db.searchHistoryAcross).not.toHaveBeenCalled();
    expect(db.searchHistory).toHaveBeenCalledWith(prisma, { ...fence, threadId: "current", channelId: undefined, searchBeforeSeq: 12 }, expect.objectContaining({ query: "launch" }));
    await tool("read_history", { messageId: "elsewhere" }, "current");
    expect(db.micoConversationOfMessage).not.toHaveBeenCalled();
    expect(db.readHistory).toHaveBeenCalledWith(prisma, expect.objectContaining({ threadId: "current" }), expect.anything());
    expect(db.isMicoConversation).not.toHaveBeenCalled();
  });
});

describe("pin_message", () => {
  const thread = { id: "current", contextStartSeq: 3 };
  const pin = (args: Record<string, unknown>) => runPinMessageTool(prisma, { run, thread, args });

  it("pins the newest message holding a quote, marked as the Mico's", async () => {
    db.findPinTarget.mockResolvedValue({ messageId: "draft", role: "bot", seq: 9 });
    db.setAgentMessagePin.mockResolvedValue({ state: "pinned", pinnedBy: "you" });
    expect(await pin({ quote: " Final draft " })).toEqual({ messageId: "draft", author: "you", state: "pinned", pinnedBy: "you" });
    expect(db.findPinTarget).toHaveBeenCalledWith(prisma, thread, { quote: "Final draft" });
    expect(db.setAgentMessagePin).toHaveBeenCalledWith(prisma, fence, "current", "draft", true);
  });

  it("unpins by message id and explains a pin the person made", async () => {
    db.findPinTarget.mockResolvedValue({ messageId: "m", role: "user", seq: 4 });
    db.setAgentMessagePin.mockRejectedValueOnce(new MessagePinError("person_pin", "only they can unpin it"));
    expect(await pin({ messageId: "m", pinned: false })).toEqual({ error: "only they can unpin it" });
    expect(db.findPinTarget).toHaveBeenCalledWith(prisma, thread, { messageId: "m" });
    expect(db.setAgentMessagePin).toHaveBeenCalledWith(prisma, fence, "current", "m", false);
  });

  it("asks for a message and reports when nothing matches, changing nothing", async () => {
    expect(await pin({})).toEqual({ error: PIN_MESSAGE_INPUT_ERROR });
    expect(await pin({ quote: "x".repeat(501) })).toEqual({ error: PIN_MESSAGE_INPUT_ERROR });
    db.findPinTarget.mockResolvedValue(null);
    expect(await pin({ quote: "missing" })).toEqual({ error: PIN_MESSAGE_NOT_FOUND_ERROR });
    expect(db.setAgentMessagePin).not.toHaveBeenCalled();
  });
});
