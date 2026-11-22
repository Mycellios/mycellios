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
const { resolveThreadTarget, markThreadUnreadFrom } = vi.hoisted(() => ({
  resolveThreadTarget: vi.fn(),
  markThreadUnreadFrom: vi.fn(),
}));
vi.mock("./thread-target.js", async (original) => ({
  ...(await original<object>()),
  resolveThreadTarget,
  markThreadUnreadFrom,
}));
import { threadsRoutes } from "./routes/threads.js";

const actor = { userId: "owner", spaceId: "space" };
type Handler = (input: { context: { actor: typeof actor }; input: unknown }) => Promise<unknown>;
/** Every route handler is returned as written, so the test calls it directly. */
const passthrough: unknown = new Proxy({}, { get: () => new Proxy({}, { get: () => ({ handler: (fn: unknown) => fn }) }) });

function routes() {
  const all = threadsRoutes({ deps: { prisma: {} }, authed: passthrough, callsEnabled: passthrough } as never) as unknown as { threads: Record<string, Handler> };
  return all.threads;
}

beforeEach(() => {
  for (const mock of [getBot, markAllThreadsRead, markNewestReplyUnread, resolveThreadTarget, markThreadUnreadFrom]) mock.mockReset();
  getBot.mockResolvedValue({ id: "mico" });
  markAllThreadsRead.mockResolvedValue(4);
  markNewestReplyUnread.mockResolvedValue(1);
  resolveThreadTarget.mockResolvedValue({ kind: "bot", botId: "mico", threadId: "main" });
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
