import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "./client.js";
import { Prisma } from "./client.js";
import {
  historyMessageText,
  listHistoryConversations,
  readHistory,
  searchHistory,
  searchHistoryAcross,
} from "./history-retrieval.js";

const scope = { spaceId: "space", userId: "user", threadId: "thread", botId: "bot" };
const row = (seq: number, text = "Use batch exports") => ({
  id: `message-${seq}`,
  seq,
  role: "user",
  blocks: [{ kind: "text", text }],
  createdAt: new Date("2026-01-01T00:00:00Z"),
  runId: null,
  replyToMessageId: null,
});
function db() {
  const mock = {
    $queryRaw: vi.fn(),
    run: { findMany: vi.fn().mockResolvedValue([]) },
    artifact: { findMany: vi.fn().mockResolvedValue([]) },
  };
  return { mock, prisma: mock as unknown as PrismaClient };
}
/** A query passed as a Prisma.Sql object or as a tagged template. */
function sql(mock: ReturnType<typeof db>["mock"], call = 0) {
  const [first, ...values] = mock.$queryRaw.mock.calls[call]!;
  return Array.isArray(first) ? Prisma.sql(first as unknown as TemplateStringsArray, ...values) : (first as Prisma.Sql);
}
describe("local history retrieval", () => {
  it("bounds search excerpts and pages by stable sequence", async () => {
    const { mock, prisma } = db();
    mock.$queryRaw.mockResolvedValue([row(10), row(9), row(8)]);
    const result = await searchHistory(prisma, scope, {
      query: "exports",
      limit: 2,
      beforeSeq: 20,
    });
    expect(result.messages.map((message) => message.seq)).toEqual([10, 9]);
    expect(result.nextBeforeSeq).toBe(9);
    expect(result.untrusted).toBe(true);
    expect(sql(mock).sql).toContain("plainto_tsquery");
    expect(sql(mock).values).toEqual(
      expect.arrayContaining(["space", "user", "bot", "thread", "exports", 20, 3]),
    );
  });
  it("keeps an unfinished broad query actionable after an exhausted narrower query", async () => {
    const { mock, prisma } = db();
    mock.$queryRaw
      .mockResolvedValueOnce([row(7), row(6), row(5), row(4), row(3), row(2)])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([row(2), row(1, "Aurora original label ORBIT-731")]);
    const historicalScope = { ...scope, searchBeforeSeq: 50 };
    const broad = await searchHistory(prisma, historicalScope, {
      query: " Aurora ",
      limit: 5,
      beforeSeq: 9999,
      after: "2026-01-01T00:00:00Z",
      before: "2026-01-02T00:00:00Z",
    });
    expect(broad.coverage).toEqual({ scope: "requested_query_and_range", status: "partial" });
    expect(broad.query).toBe("Aurora");
    expect(broad.nextSearch).toEqual({
      query: "Aurora",
      limit: 5,
      beforeSeq: 3,
      after: "2026-01-01T00:00:00Z",
      before: "2026-01-02T00:00:00Z",
    });
    expect(sql(mock).values).toContain(50);
    const narrow = await searchHistory(prisma, historicalScope, { query: "extraction" });
    expect(narrow).toMatchObject({
      query: "extraction",
      coverage: {
        scope: "requested_query_and_range",
        status: "exhausted",
      },
      nextBeforeSeq: null,
      nextSearch: null,
    });
    const older = await searchHistory(prisma, historicalScope, broad.nextSearch!);
    expect(older.messages.some((message) => message.text.includes("ORBIT-731"))).toBe(true);
    expect(older.coverage.status).toBe("exhausted");
    expect(sql(mock, 2).values).toContain(3);
    expect(mock.$queryRaw).toHaveBeenCalledTimes(3);
  });
  it("returns five matches by default and at most ten, keeping a taskId in the continuation", async () => {
    const { mock, prisma } = db();
    mock.$queryRaw.mockResolvedValue(Array.from({ length: 12 }, (_, index) => row(30 - index)));
    const capped = await searchHistory(prisma, scope, { query: "exports", limit: 20, taskId: "task-thread" });
    expect(capped.messages).toHaveLength(10);
    expect(capped.nextSearch).toEqual({ query: "exports", beforeSeq: 21, limit: 10, taskId: "task-thread" });
    const standard = await searchHistory(prisma, scope, { query: "exports" });
    expect(standard.messages).toHaveLength(5);
    expect(standard.nextSearch).toEqual({ query: "exports", beforeSeq: 26, limit: 5 });
  });
  it("bounds Unicode search pages without discarding the continuation or original offsets", async () => {
    const { mock, prisma } = db();
    const query = "星".repeat(250);
    mock.$queryRaw.mockResolvedValue(
      Array.from({ length: 6 }, (_, index) => row(10 - index, query + "界".repeat(1000))),
    );
    const result = await searchHistory(prisma, scope, { query });
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(10000);
    expect(result.nextSearch).toEqual({ query, beforeSeq: 6, limit: 5 });
    expect(result.messages).toHaveLength(5);
    for (const message of result.messages) {
      expect(message.text).toBe(
        (query + "界".repeat(1000)).slice(
          message.textOffset,
          message.textOffset + message.text.length,
        ),
      );
      expect(message.nextTextOffset).toBe(message.textOffset + message.text.length);
    }
  });
  it("points search excerpts at the matching portion of an oversized message", async () => {
    const { mock, prisma } = db();
    mock.$queryRaw.mockResolvedValue([
      row(1, `${"filler ".repeat(1000)}ledger-indexer final outcome`),
    ]);
    const result = await searchHistory(prisma, scope, { query: "ledger-indexer" });
    expect(result.messages[0]!.text).toContain("ledger-indexer");
    expect(result.messages[0]!.textOffset).toBeGreaterThan(6000);
    const original = `${"filler ".repeat(1000)}ledger-indexer final outcome`;
    expect(result.messages[0]!.text).toBe(
      original.slice(
        result.messages[0]!.textOffset,
        result.messages[0]!.textOffset + result.messages[0]!.text.length,
      ),
    );
  });
  it("restricts channel inputs and bot output using the run source, including neighbors", async () => {
    const { mock, prisma } = db();
    mock.$queryRaw.mockResolvedValueOnce([row(4)]).mockResolvedValueOnce([row(3), row(4)]);
    await readHistory(prisma, { ...scope, channelId: "group-channel" }, { messageId: "message-4" });
    for (const call of [0, 1]) {
      expect(sql(mock, call).sql).toContain('source.id = r."sourceMessageId"');
      expect(sql(mock, call).sql).toContain('source."threadId" = t.id');
      expect(sql(mock, call).values).toContain(
        JSON.stringify([{ kind: "channel_message", channelId: "group-channel" }]),
      );
    }
    expect(mock.run.findMany.mock.calls[0]![0].where).toMatchObject({
      ...scope,
      sourceMessage: { threadId: "thread", role: "user" },
    });
  });
  it("does not retrieve runs or artifacts for a missing, cleared, or inaccessible anchor", async () => {
    const { mock, prisma } = db();
    mock.$queryRaw.mockResolvedValue([]);
    expect((await readHistory(prisma, scope, { messageId: "foreign" })).messages).toEqual([]);
    expect(mock.run.findMany).not.toHaveBeenCalled();
    expect(mock.artifact.findMany).not.toHaveBeenCalled();
    expect(sql(mock).sql).toContain('t."spaceId" =');
    expect(sql(mock).sql).toContain('t."userId" =');
    expect(sql(mock).sql).toContain('t."botId" =');
  });
  it("admits the Mico's own task conversation only through the run's thread and the same fences", async () => {
    const { mock, prisma } = db();
    mock.$queryRaw.mockResolvedValue([]);
    await searchHistory(prisma, { ...scope, threadId: "task-thread" }, { query: "exports" });
    const query = sql(mock);
    expect(query.sql).toContain('t."taskBotId" =');
    expect(query.sql).toContain('t."groupId" IS NULL');
    expect(query.sql).toContain('b."archivedAt" IS NULL');
    // Thread, Space, owner and Mico stay bound from the executor scope, never from tool input.
    expect(query.values).toEqual(expect.arrayContaining(["task-thread", "space", "user", "bot"]));
    expect(query.values).not.toContain("thread");
  });
  it("reuses originals without inference and invalidates snapshots when content changes", async () => {
    const { mock, prisma } = db();
    mock.$queryRaw.mockResolvedValueOnce([row(1)]).mockResolvedValueOnce([row(1)]);
    const first = await readHistory(prisma, scope, { messageId: "message-1" });
    mock.$queryRaw
      .mockResolvedValueOnce([row(1)])
      .mockResolvedValueOnce([row(1, "Use streaming exports")]);
    const second = await readHistory(prisma, scope, { messageId: "message-1" });
    expect(first.snapshots[0]!.source).toBe("original");
    expect(first.snapshots[0]!.version).not.toBe(second.snapshots[0]!.version);
    expect(second.snapshots[0]!.topic).toBe("Use streaming exports");
  });
  it("pages inside an oversized original without dumping the entire message", async () => {
    const { mock, prisma } = db();
    mock.$queryRaw.mockResolvedValue([
      row(1, `${"a".repeat(2000)}distant exact fact${"b".repeat(2000)}`),
    ]);
    const result = await readHistory(prisma, scope, { messageId: "message-1", textOffset: 2000 });
    expect(result.messages[0]!.text).toContain("distant exact fact");
    expect(result.messages[0]!.text.length).toBe(2000);
    expect(result.messages[0]!.nextTextOffset).toBe(4000);
    expect(result.messages[0]!.textOffset).toBe(2000);
    expect(mock.$queryRaw).toHaveBeenCalledTimes(1);
  });
  it("omits non-text secrets, progress, and commands from retrieved text", () => {
    expect(
      historyMessageText([
        { kind: "text", text: "visible" },
        { kind: "secret_prompt", text: "hidden" },
        { kind: "progress", text: "trace" },
      ]),
    ).toBe("visible");
  });
  it("validates dates, query size and pagination before accessing the database", async () => {
    const { mock, prisma } = db();
    await expect(searchHistory(prisma, scope, { query: "x", before: "invalid" })).rejects.toThrow(
      "Invalid history date",
    );
    await expect(searchHistory(prisma, scope, { query: "x", limit: 0 })).rejects.toThrow();
    await expect(searchHistory(prisma, scope, { query: "x", beforeSeq: -1 })).rejects.toThrow();
    await expect(searchHistory(prisma, scope, { query: " " })).rejects.toThrow();
    expect(mock.$queryRaw).not.toHaveBeenCalled();
  });
});

const conversation = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  botId: null,
  taskBotId: "bot",
  projectKey: "mico:bot",
  taskKey: `mico-task:bot:${id}`,
  title: `Title ${id}`,
  startedBy: "user",
  outcome: null,
  archivedAt: null,
  activityAt: new Date("2026-02-01T00:00:00Z"),
  activityMs: Date.parse("2026-02-01T00:00:00Z"),
  activeStatuses: null,
  ...extra,
});
const latest = (threadId: string, role: string, text: string) => ({ ...row(1, text), id: `${threadId}-${role}`, threadId, role });

describe("history across a Mico's conversations", () => {
  const fence = { spaceId: "space", userId: "user", botId: "bot", currentThreadId: "side-a" };
  it("lists the main chat and side conversations, open and archived, with previews and a cursor", async () => {
    const { mock, prisma } = db();
    mock.$queryRaw
      .mockResolvedValueOnce([
        conversation("main", { botId: "bot", taskBotId: null, projectKey: null, taskKey: null, title: null, startedBy: null, activeStatuses: ["running"] }),
        conversation("side-a", { outcome: "completed" }),
        conversation("routine-thread", { projectKey: "routine:r", taskKey: "routine:r", startedBy: "routine", archivedAt: new Date("2026-01-20T00:00:00Z") }),
      ])
      .mockResolvedValueOnce([
        latest("main", "user", "Plan the launch"),
        latest("main", "bot", "x".repeat(500)),
        latest("side-a", "bot", "Draft ready"),
      ]);
    const result = await listHistoryConversations(prisma, fence, { limit: 2 });
    expect(result.untrusted).toBe(true);
    expect(result.conversations).toEqual([
      expect.objectContaining({ taskId: "main", kind: "main", title: "Main chat", current: false, state: "running", startedBy: null, lastRequest: "Plan the launch" }),
      expect.objectContaining({ taskId: "side-a", kind: "conversation", title: "Title side-a", current: true, archived: false, outcome: "completed", lastRequest: null, lastReply: "Draft ready" }),
    ]);
    expect(result.conversations[0]!.lastReply).toBe(`${"x".repeat(400)}…`);
    expect(result.nextCursor).toBe(`${Date.parse("2026-02-01T00:00:00Z")}~side-a`);
    const list = sql(mock);
    for (const fenceSql of ['t."groupId" IS NULL', 't."externalConversationId" IS NULL', 't."deleteAfter" IS NULL', 't."taskBotId" =', 'b."archivedAt" IS NULL'])
      expect(list.sql).toContain(fenceSql);
    expect(list.values).toEqual(expect.arrayContaining(["space", "user", "bot", 3]));
    // Previews come only from after the New chat boundary.
    expect(sql(mock, 1).sql).toContain('u.seq >= t."contextStartSeq"');
    expect(sql(mock, 1).sql).toContain('b.seq >= t."contextStartSeq"');
  });
  it("continues from a cursor, filters by activity and rejects a malformed cursor before reading", async () => {
    const { mock, prisma } = db();
    mock.$queryRaw.mockResolvedValueOnce([conversation("routine-thread", { projectKey: "routine:r", taskKey: "routine:r", startedBy: null, archivedAt: new Date(0) })]).mockResolvedValueOnce([]);
    const result = await listHistoryConversations(prisma, fence, {
      cursor: `${Date.parse("2026-02-01T00:00:00Z")}~side-a`,
      after: "2026-01-01T00:00:00.000Z",
    });
    expect(result.conversations[0]).toMatchObject({ kind: "routine", archived: true, state: "closed", startedBy: "routine" });
    expect(result.nextCursor).toBeNull();
    expect(sql(mock).sql).toContain('extract(epoch FROM c."activityAt")');
    expect(sql(mock).values).toContain("side-a");
    await expect(listHistoryConversations(prisma, fence, { cursor: "nonsense" })).rejects.toThrow("Invalid history cursor");
    expect(mock.$queryRaw).toHaveBeenCalledTimes(2);
  });
  it("searches this conversation first, then the main chat and the newest side conversations, tagging each match", async () => {
    const { mock, prisma } = db();
    mock.$queryRaw
      .mockResolvedValueOnce([
        conversation("main", { botId: "bot", taskBotId: null, title: null }),
        conversation("side-b"),
      ])
      .mockResolvedValueOnce([conversation("side-a")])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ ...row(7, "launch exports"), id: "main-7" }])
      .mockResolvedValueOnce([{ ...row(3, "launch exports"), id: "side-b-3" }]);
    const result = await searchHistoryAcross(
      prisma,
      { spaceId: "space", userId: "user", botId: "bot", threadId: "side-a", searchBeforeSeq: 40 },
      { query: "exports" },
    );
    expect(result.messages.map(({ messageId, taskId, conversation }) => ({ messageId, taskId, conversation }))).toEqual([
      { messageId: "main-7", taskId: "main", conversation: "Main chat" },
      { messageId: "side-b-3", taskId: "side-b", conversation: "Title side-b" },
    ]);
    expect(result.conversations.map(({ taskId, current, status }) => ({ taskId, current, status }))).toEqual([
      { taskId: "side-a", current: true, status: "exhausted" },
      { taskId: "main", current: false, status: "exhausted" },
      { taskId: "side-b", current: false, status: "exhausted" },
    ]);
    expect(result.coverage).toEqual({ scope: "this_and_recent_conversations", status: "exhausted" });
    expect(result.untrusted).toBe(true);
    // The current request's boundary applies to this conversation only.
    expect(sql(mock, 2).values).toEqual(expect.arrayContaining(["side-a", 40]));
    expect(sql(mock, 3).values).toContain("main");
    expect(sql(mock, 3).values).not.toContain(40);
    expect(sql(mock, 0).sql).toContain('t."deleteAfter" IS NULL');
  });
  it("stops at the limit, marks the rest unsearched and continues inside one conversation", async () => {
    const { mock, prisma } = db();
    mock.$queryRaw
      .mockResolvedValueOnce([conversation("main", { botId: "bot", taskBotId: null }), conversation("side-b")])
      .mockResolvedValueOnce([conversation("side-a")])
      .mockResolvedValueOnce([row(9), row(8), row(7)]);
    const result = await searchHistoryAcross(
      prisma,
      { spaceId: "space", userId: "user", botId: "bot", threadId: "side-a" },
      { query: "exports", limit: 2 },
    );
    expect(result.messages.map((message) => message.taskId)).toEqual(["side-a", "side-a"]);
    expect(result.conversations.map((item) => item.status)).toEqual(["partial", "not_searched", "not_searched"]);
    expect(result.nextSearch).toEqual({ query: "exports", beforeSeq: 8, limit: 2, taskId: "side-a" });
    expect(result.coverage.status).toBe("partial");
    expect(mock.$queryRaw).toHaveBeenCalledTimes(3);
  });
});
