import { beforeEach, describe, expect, it, vi } from "vitest";

const { getBot, markAllThreadsRead, markNewestReplyUnread } = vi.hoisted(() => ({
  getBot: vi.fn(),
  markAllThreadsRead: vi.fn(),
  markNewestReplyUnread: vi.fn(),
}));
vi.mock("@mycellios/db", async (original) => ({
  ...(await original<object>()),
  createRepos: () => ({ getBot }),
  markAllThreadsRead,
  markNewestReplyUnread,
}));
const { resolveThreadTarget, markThreadUnreadFrom, threadSnapshot } = vi.hoisted(() => ({
  resolveThreadTarget: vi.fn(),
  markThreadUnreadFrom: vi.fn(),
  threadSnapshot: vi.fn(),
}));
vi.mock("./thread-target.js", async (original) => ({
  ...(await original<object>()),
  resolveThreadTarget,
  markThreadUnreadFrom,
  threadSnapshot,
}));
import { threadsRoutes } from "./routes/threads.js";

const actor = { userId: "owner", spaceId: "space" };
type Handler = (input: { context: { actor: typeof actor }; input: unknown }) => Promise<unknown>;
/** Every route handler is returned as written, so the test calls it directly. */
const passthrough: unknown = new Proxy({}, { get: () => new Proxy({}, { get: () => ({ handler: (fn: unknown) => fn }) }) });

function routes(prisma: object = {}) {
  const all = threadsRoutes({ deps: { prisma }, authed: passthrough, callsEnabled: passthrough } as never) as unknown as { threads: Record<string, Handler> };
  return all.threads;
}

beforeEach(() => {
  for (const mock of [getBot, markAllThreadsRead, markNewestReplyUnread, resolveThreadTarget, markThreadUnreadFrom, threadSnapshot]) mock.mockReset();
  getBot.mockResolvedValue({ id: "mico" });
  markAllThreadsRead.mockResolvedValue(4);
  markNewestReplyUnread.mockResolvedValue(1);
  resolveThreadTarget.mockResolvedValue({ kind: "bot", botId: "mico", threadId: "main" });
  threadSnapshot.mockResolvedValue({ messages: [], olderCursor: null });
});

describe("Conversation history", () => {
  it("looks up the side chat within both the account and Space and requests the normal page", async () => {
    const bot = { name: "Mico", computer: null };
    const findFirst = vi.fn().mockResolvedValue({ id: "side", taskBot: bot });
    const prisma = { thread: { findFirst } };
    const get = routes(prisma).get!;
    await get({ context: { actor }, input: { botId: "mico", taskThreadId: "side", history: "recent" } });
    expect(findFirst).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      where: {
        id: "side", taskBotId: "mico", ...actor,
        taskBot: { is: { ...actor, thread: { isNot: null } } },
      },
    }));
    expect(threadSnapshot).toHaveBeenCalledExactlyOnceWith({ prisma }, {
      kind: "bot", botId: "mico", threadId: "side", bot,
    }, undefined);
    expect(getBot).not.toHaveBeenCalled();
  });

  it("rejects a side chat outside that scope before loading any messages", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    await expect(routes({ thread: { findFirst } }).get!({
      context: { actor }, input: { botId: "mico", taskThreadId: "foreign", history: "recent" },
    })).rejects.toThrow();
    expect(threadSnapshot).not.toHaveBeenCalled();
  });
});

describe("reading in bulk", () => {
  it("reads one Mico's chats only after checking it is the person's own", async () => {
    await expect(routes().markAllRead!({ context: { actor }, input: { botId: "mico" } })).resolves.toEqual({ ok: true, threads: 4 });
    expect(getBot).toHaveBeenCalledWith(actor, "mico");
    expect(markAllThreadsRead).toHaveBeenCalledWith({}, actor, { botId: "mico" });
    getBot.mockRejectedValueOnce(new Error("Not found"));
    await expect(routes().markAllRead!({ context: { actor }, input: { botId: "foreign" } })).rejects.toThrow("Not found");
    expect(markAllThreadsRead).toHaveBeenCalledTimes(1);
  });

  it("reads every chat of the person in this Space without naming a Mico", async () => {
    await routes().markAllRead!({ context: { actor }, input: {} });
    expect(getBot).not.toHaveBeenCalled();
    expect(markAllThreadsRead).toHaveBeenCalledWith({}, actor, { botId: undefined });
  });
});

describe("Mark as unread", () => {
  it("makes the newest reply of the resolved chat unread, or reads from a chosen message", async () => {
    await routes().markUnread!({ context: { actor }, input: { botId: "mico" } });
    expect(markNewestReplyUnread).toHaveBeenCalledWith({}, actor, "main");
    await routes().markUnread!({ context: { actor }, input: { botId: "mico", messageId: "message-4" } });
    expect(markThreadUnreadFrom).toHaveBeenCalledWith({}, actor, { kind: "bot", botId: "mico", threadId: "main" }, "message-4");
    expect(markNewestReplyUnread).toHaveBeenCalledTimes(1);
  });
});
