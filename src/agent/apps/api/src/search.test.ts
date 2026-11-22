import type { Actor } from "@mycellios/contracts";
import { GROUP_MEMBER_MIN } from "@mycellios/contracts";
import type { PrismaClient } from "@mycellios/db";
import { Prisma } from "@mycellios/db";
import { describe, expect, it, vi } from "vitest";
import { querySpaceSearch, searchThreadMessages } from "./search.js";

const actor: Actor = { spaceId: "space-test", userId: "user-test" };

function fixture(count: number) {
  const artifacts = Array.from({ length: count }, (_, index) => ({
    id: `artifact-${index}`,
    botId: `bot-${index}`,
    bot: { name: "Bot" },
    name: "report.txt",
    mimeType: "text/plain",
    size: 10,
  }));
  const groupArtifacts = artifacts.map((artifact) => ({
    ...artifact,
    id: `group-${artifact.id}`,
    botId: null,
    bot: null,
    groupId: "group-test",
    group: { name: "Group", _count: { members: 2 } },
  }));
  const prisma = {
    bot: { findMany: vi.fn().mockResolvedValue([]) },
    chatGroup: { findMany: vi.fn().mockResolvedValue([]) },
    artifact: {
      findMany: vi.fn().mockResolvedValueOnce(artifacts).mockResolvedValueOnce(groupArtifacts),
    },
    routine: { findMany: vi.fn().mockResolvedValue([]) },
    $queryRaw: vi
      .fn()
      .mockResolvedValue([])
      .mockResolvedValueOnce([{ id: "group-test" }]),
  };
  return { prisma, artifacts, groupArtifacts };
}

describe("artifact search batching", () => {
  it.each([1, 25])("uses one lookup per destination for %i matching artifacts", async (count) => {
    const { prisma } = fixture(count);
    await querySpaceSearch(prisma as unknown as PrismaClient, actor, "report");
    // Two artifact batches and the eligibility query and direct/group message searches.
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(5);
    const direct = prisma.$queryRaw.mock.calls[1]?.[0];
    const group = prisma.$queryRaw.mock.calls[2]?.[0];
    expect(direct.text).toContain('COALESCE(t."botId", t."taskBotId") = candidate."targetId"');
    expect(direct.text).toContain('t."deleteAfter" IS NULL');
    expect(group.text).toContain('t."groupId" = candidate."targetId"');
    for (const query of [direct, group]) {
      expect(query.values).toContain(actor.spaceId);
      expect(query.values).toContain(actor.userId);
      expect(query.text).toContain('ORDER BY m."createdAt" DESC');
    }
  });

  it("preserves artifact priority and skips missing messages regardless of batch row order", async () => {
    const { prisma } = fixture(3);
    prisma.$queryRaw
      .mockResolvedValueOnce([
        { artifactId: "artifact-2", id: "message-2", seq: 8 },
        { artifactId: "artifact-0", id: "message-0", seq: 6 },
      ])
      .mockResolvedValueOnce([{ artifactId: "group-artifact-1", id: "group-message", seq: 3 }]);
    const hits = await querySpaceSearch(prisma as unknown as PrismaClient, actor, "report");
    expect(hits.map(({ artifactId, messageId, seq }) => ({ artifactId, messageId, seq }))).toEqual([
      { artifactId: "artifact-0", messageId: "message-0", seq: 6 },
      { artifactId: "artifact-2", messageId: "message-2", seq: 8 },
      { artifactId: "group-artifact-1", messageId: "group-message", seq: 3 },
    ]);
  });

  it("does not issue artifact queries for empty batches", async () => {
    const { prisma } = fixture(0);
    expect(await querySpaceSearch(prisma as unknown as PrismaClient, actor, "report")).toEqual([]);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(3);
  });
});

it("resolves active group eligibility once for names, artifacts, and messages", async () => {
  const { prisma } = fixture(0);
  await querySpaceSearch(prisma as never, actor, "Launch");

  const eligibility = prisma.$queryRaw.mock.calls[0]?.[0];
  expect(eligibility.text).toContain('g."spaceId" = $1');
  expect(eligibility.text).toContain('g."userId" = $2');
  expect(eligibility.text).toContain('g."archivedAt" IS NULL');
  expect(eligibility.text).toContain("SELECT COUNT(*) FROM chat_group_members gm");
  expect(eligibility.text).toContain('INNER JOIN bots gb ON gb.id = gm."botId"');
  expect(eligibility.text).toContain('gm."groupId" = g.id AND gb."archivedAt" IS NULL');
  expect(eligibility.text).toContain(") >= $3");
  expect(eligibility.values).toEqual([actor.spaceId, actor.userId, GROUP_MEMBER_MIN]);

  expect(prisma.chatGroup.findMany.mock.calls[0]?.[0]).toMatchObject({
    where: { spaceId: actor.spaceId, userId: actor.userId, id: { in: ["group-test"] } },
    take: 5,
  });
  expect(prisma.artifact.findMany.mock.calls[1]?.[0]).toMatchObject({
    where: { spaceId: actor.spaceId, userId: actor.userId, groupId: { in: ["group-test"] } },
    take: 25,
  });
  const [strings, ...values] = prisma.$queryRaw.mock.calls[2]!;
  const groupMessageQuery = Prisma.sql(strings, ...values);
  expect(groupMessageQuery.text).toContain("AND g.id IN ($3)");
  expect(groupMessageQuery.values[2]).toBe("group-test");
});

it("applies group eligibility before name and artifact limits", async () => {
  const { prisma } = fixture(0);
  const groups = Array.from({ length: 25 }, (_, index) => ({
    id: `under-minimum-${index}`,
    name: "report",
  })).concat({ id: "group-test", name: "report" });
  const files = groups.map((group) => ({
    id: `file-${group.id}`,
    groupId: group.id,
    group: { name: group.name },
    name: "report.txt",
    mimeType: "text/plain",
    size: 10,
  }));
  prisma.chatGroup.findMany.mockImplementation(async ({ where, take }) =>
    groups.filter((group) => !where.id || where.id.in.includes(group.id)).slice(0, take),
  );
  prisma.artifact.findMany
    .mockReset()
    .mockResolvedValueOnce([])
    .mockImplementation(async ({ where, take }) =>
      files
        .filter((file) => !where.groupId?.in || where.groupId.in.includes(file.groupId))
        .slice(0, take),
    );
  prisma.$queryRaw.mockResolvedValueOnce([
    { artifactId: "file-group-test", id: "message-test", seq: 1 },
  ]);

  const hits = await querySpaceSearch(prisma as never, actor, "report");
  expect(hits.map(({ kind, groupId }) => ({ kind, groupId }))).toEqual([
    { kind: "conversation", groupId: "group-test" },
    { kind: "file", groupId: "group-test" },
  ]);
});

it("searches for the characters the user typed, not SQL wildcards", async () => {
  const { prisma } = fixture(0);
  await querySpaceSearch(prisma as unknown as PrismaClient, actor, "50%_off");

  const botFilter = prisma.bot.findMany.mock.calls[0]?.[0]?.where?.OR?.[0]?.name;
  expect(botFilter?.contains).toBe("50\\%\\_off");

  const groupFilter = prisma.chatGroup.findMany.mock.calls[0]?.[0]?.where?.name;
  expect(groupFilter?.contains).toBe("50\\%\\_off");

  // The message scan builds its own pattern, and a backslash in the query must
  // not swallow the character after it.
  const boundValues = prisma.$queryRaw.mock.calls.flatMap((call) =>
    call.map((argument) => (argument as { values?: unknown[] } | undefined)?.values ?? []),
  );
  expect(boundValues.flat()).toContain("%50\\%\\_off%");
});

it("JSON-escapes backslashes only for the message scan", async () => {
  const { prisma } = fixture(0);
  await querySpaceSearch(prisma as unknown as PrismaClient, actor, String.raw`back\slash`);

  const botFilter = prisma.bot.findMany.mock.calls[0]?.[0]?.where?.OR?.[0]?.name;
  expect(botFilter?.contains).toBe(String.raw`back\\slash`);
  const groupFilter = prisma.chatGroup.findMany.mock.calls[0]?.[0]?.where?.name;
  expect(groupFilter?.contains).toBe(String.raw`back\\slash`);
  for (const call of prisma.$queryRaw.mock.calls.slice(1)) {
    const values = call.flatMap(
      (argument) => (argument as { values?: unknown[] } | undefined)?.values ?? [],
    );
    expect(values).toContain(String.raw`%back\\\\slash%`);
  }
});

it("guards name-derived snippets while preserving descriptions", async () => {
  const { prisma } = fixture(0);
  prisma.bot.findMany.mockResolvedValue([
    { id: "bot-1", name: "__TestTok1__", title: "", description: "" },
    { id: "bot-2", name: "__TestTok2__", title: "", description: "Keep __TestTok2__ literal" },
  ] as never);
  prisma.chatGroup.findMany.mockResolvedValue([
    { id: "group-1", name: "__TestTok1__", _count: { members: 2 } },
  ] as never);
  const hits = await querySpaceSearch(prisma as never, actor, "TestTok");
  expect(
    hits
      .filter((hit) => hit.botId === "bot-1" || hit.groupId === "group-1")
      .map((hit) => hit.snippet),
  ).toEqual(["", ""]);
  expect(hits.find((hit) => hit.botId === "bot-2")?.snippet).toBe("Keep __TestTok2__ literal");
});

describe("side conversations and filters", () => {
  it("returns messages from a Mico's side conversations with the conversation they open", async () => {
    const { prisma } = fixture(0);
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        id: "side-message",
        threadId: "side-thread",
        seq: 4,
        blocks: [{ kind: "text", text: "The launch checklist is ready" }],
        botId: "bot-1",
        botName: "Nova",
        taskThreadId: "side-thread",
        threadTitle: "Launch plan",
      },
      {
        id: "main-message",
        threadId: "main-thread",
        seq: 9,
        blocks: [{ kind: "text", text: "Launch moved to Friday" }],
        botId: "bot-1",
        botName: "Nova",
        taskThreadId: null,
        threadTitle: null,
      },
    ]);
    const hits = await querySpaceSearch(prisma as never, actor, "launch");
    expect(hits).toEqual([
      expect.objectContaining({ kind: "message", botId: "bot-1", messageId: "side-message", taskThreadId: "side-thread", conversationTitle: "Launch plan" }),
      expect.objectContaining({ kind: "message", botId: "bot-1", messageId: "main-message" }),
    ]);
    expect(hits[1]).not.toHaveProperty("taskThreadId");
    const [strings, ...values] = prisma.$queryRaw.mock.calls[1]!;
    const query = Prisma.sql(strings, ...values);
    expect(query.text).toContain('INNER JOIN bots b ON b.id = COALESCE(t."botId", t."taskBotId")');
    expect(query.text).toContain('t."groupId" IS NULL AND t."externalConversationId" IS NULL AND t."deleteAfter" IS NULL');
    expect(query.text).toContain('b."archivedAt" IS NULL');
    expect(query.values).toEqual(expect.arrayContaining([actor.spaceId, actor.userId]));
  });

  it.each([
    ["files", { bot: 0, group: 0, routine: 0, artifact: 2 }],
    ["routines", { bot: 0, group: 0, routine: 1, artifact: 0 }],
    ["micos", { bot: 1, group: 0, routine: 0, artifact: 0 }],
    ["groups", { bot: 0, group: 1, routine: 0, artifact: 0 }],
    ["messages", { bot: 0, group: 0, routine: 0, artifact: 0 }],
  ] as const)("asks only for %s when that filter is chosen", async (filter, calls) => {
    const { prisma } = fixture(1);
    await querySpaceSearch(prisma as never, actor, "report", filter);
    expect(prisma.bot.findMany).toHaveBeenCalledTimes(calls.bot);
    expect(prisma.chatGroup.findMany).toHaveBeenCalledTimes(calls.group);
    expect(prisma.routine.findMany).toHaveBeenCalledTimes(calls.routine);
    expect(prisma.artifact.findMany).toHaveBeenCalledTimes(calls.artifact);
    const messageScans = prisma.$queryRaw.mock.calls.filter(([strings]) =>
      Array.isArray(strings) && strings.join("").includes("FROM messages m"),
    ).length;
    expect(messageScans).toBe(filter === "messages" ? 2 : 0);
  });

  it("fills a single-kind page past the mixed-page name limit", async () => {
    const { prisma } = fixture(0);
    await querySpaceSearch(prisma as never, actor, "report", "micos");
    expect(prisma.bot.findMany.mock.calls[0]?.[0]).toMatchObject({ take: 25 });
  });
});

describe("in-chat search", () => {
  it("searches one owned conversation, newest first, and leaves out what the transcript hides", async () => {
    const rows = [
      { id: "m3", seq: 3, role: "bot", runId: "background", blocks: [{ kind: "text", text: "budget ticket work" }] },
      { id: "m2", seq: 2, role: "bot", runId: null, blocks: [{ kind: "text", text: "The budget is approved" }] },
      { id: "m1", seq: 1, role: "user", runId: null, blocks: [{ kind: "text", text: "unrelated" }] },
    ];
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValueOnce(rows),
      run: { findMany: vi.fn().mockResolvedValue([{ id: "background", trigger: "tickets" }]) },
    };
    const result = await searchThreadMessages(prisma as never, actor, "thread-1", "budget");
    expect(result).toEqual({ matches: [{ messageId: "m2", seq: 2, snippet: "The budget is approved" }], more: false });
    const [strings, ...values] = prisma.$queryRaw.mock.calls[0]!;
    const query = Prisma.sql(strings, ...values);
    expect(query.text).toContain('m."threadId" = $1');
    expect(query.text).toContain("m.role IN ('user', 'bot')");
    expect(query.values).toEqual(expect.arrayContaining(["thread-1", actor.spaceId, actor.userId]));
  });

  it("returns nothing for a blank query without touching the database", async () => {
    const prisma = { $queryRaw: vi.fn() };
    expect(await searchThreadMessages(prisma as never, actor, "thread-1", "  ")).toEqual({ matches: [], more: false });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});
