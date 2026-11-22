import { describe, expect, it, vi } from "vitest";
import { Prisma } from "./client.js";
import type { PrismaClient } from "./client.js";
import {
  markAllThreadsRead,
  markNewestReplyUnread,
  micoConversationSummaries,
  rosterConversationSignals,
  sideThreadRequestKind,
  unreadReplyCounts,
} from "./conversation-surfaces.js";

const scope = { userId: "user-1", spaceId: "space-1" };

/** A raw-query double that records the final SQL text and its values. */
function recorder(result: unknown = []) {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const run = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = Prisma.sql(strings, ...values);
    calls.push({ sql: query.sql.replace(/\s+/g, " "), values: query.values });
    return typeof result === "function" ? (result as (sql: string) => unknown)(query.sql) : result;
  });
  return { calls, run };
}

describe("marking chats read in bulk", () => {
  it("reads one Mico's main chat and open conversations within the person's Space", async () => {
    const raw = recorder(3);
    await expect(markAllThreadsRead({ $executeRaw: raw.run } as unknown as PrismaClient, scope, { botId: "mico" })).resolves.toBe(3);
    const [call] = raw.calls;
    expect(call!.sql).toContain(`t."spaceId" = ? AND t."userId" = ?`);
    expect(call!.sql).toContain(`t."archivedAt" IS NULL AND t."deleteAfter" IS NULL`);
    expect(call!.values).toEqual(["space-1", "user-1", "mico", "mico"]);
  });

  it("reads every main chat, group and open conversation of the person when no Mico is named", async () => {
    const raw = recorder(9);
    await markAllThreadsRead({ $executeRaw: raw.run } as unknown as PrismaClient, scope);
    expect(raw.calls[0]!.values).toEqual(["space-1", "user-1"]);
    expect(raw.calls[0]!.sql).toContain(`t."groupId" IS NOT NULL`);
    expect(raw.calls[0]!.sql).not.toContain("externalConversationId");
  });

  it("makes only the newest reply unread again, in the person's own chat", async () => {
    const raw = recorder(1);
    await markNewestReplyUnread({ $executeRaw: raw.run } as unknown as PrismaClient, scope, "thread-1");
    expect(raw.calls[0]!.sql).toContain(`m.role = 'bot' ORDER BY m.seq DESC LIMIT 1`);
    expect(raw.calls[0]!.values).toEqual(["thread-1", "space-1", "user-1"]);
  });
});

describe("roster signals", () => {
  it("reads nothing without Micos or unread chats", async () => {
    const raw = recorder();
    const prisma = { $queryRaw: raw.run } as unknown as PrismaClient;
    expect((await micoConversationSummaries(prisma, "user-1", [])).size).toBe(0);
    expect((await unreadReplyCounts(prisma, "user-1", [])).size).toBe(0);
    expect(raw.run).not.toHaveBeenCalled();
  });

  it("summarizes open conversations per Mico and counts main-chat replies, ignoring anything unexpected", async () => {
    const raw = recorder((sql: string) => sql.includes(`"taskBotId" AS "botId"`)
      ? [{ botId: "mico", open: 3, unread: 1, waiting: 1, working: 0, moves: 42n }, { botId: "stranger", open: 5 },
        { botId: "idle", open: 0 }, { id: "noise" }]
      : [{ threadId: "main-1", count: 250 }, { threadId: "other", count: 4 }, { threadId: "main-2", count: "x" }]);
    const signals = await rosterConversationSignals({ $queryRaw: raw.run } as unknown as PrismaClient, "user-1", [
      { botId: "mico", threadId: "main-1", unread: true },
      { botId: "idle", threadId: "main-2", unread: true },
      { botId: "quiet", threadId: "main-3", unread: false },
    ]);
    expect(signals.get("mico")).toEqual({ unreadCount: 100, conversations: { open: 3, unread: 1, waiting: 1, working: 0, revision: "3:1:1:0:42" } });
    expect(signals.has("idle")).toBe(false);
    expect(signals.has("stranger")).toBe(false);
    // Only chats with their unread flag on are counted, and only for this person.
    const counted = raw.calls.find(call => call.sql.includes(`"lastReadSeq"`))!;
    expect(counted.values).toContain("user-1");
    expect(counted.values).toContain("main-1");
    expect(counted.values).not.toContain("main-3");
    expect(counted.sql).toContain(`NOT LIKE`);
  });

  it("keeps the roster when the counts cannot be read", async () => {
    const prisma = { $queryRaw: vi.fn().mockRejectedValue(new Error("down")) } as unknown as PrismaClient;
    await expect(rosterConversationSignals(prisma, "user-1", [{ botId: "mico", threadId: "t", unread: true }])).resolves.toEqual(new Map());
  });
});

it("names what a pending ask waits for", () => {
  expect(sideThreadRequestKind({ kind: "ask", approvalEffectId: "e", actions: [{ id: "allow", label: "Allow" }] })).toBe("approval");
  expect(sideThreadRequestKind({ kind: "ask", input: "secret" })).toBe("secret");
  expect(sideThreadRequestKind({ kind: "ask", plan: { steps: [] } })).toBe("plan");
  expect(sideThreadRequestKind({ kind: "ask" })).toBe("question");
});
