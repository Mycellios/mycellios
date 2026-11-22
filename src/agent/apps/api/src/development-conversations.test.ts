import { beforeEach, expect, it, vi } from "vitest";
const { getBot } = vi.hoisted(() => ({ getBot: vi.fn() }));
vi.mock("@mycellios/db", async (original) => ({
  ...(await original<object>()),
  createRepos: () => ({ getBot }),
}));
import { resolveThreadTarget } from "./thread-target.js";
import { developmentRoutes } from "./routes/development.js";
const actor = { userId: "owner", spaceId: "space" } as never;
beforeEach(() => {
  getBot.mockReset();
  getBot.mockResolvedValue({ id: "mico", thread: { id: "primary" } });
});
it("resolves the same Mico with an owned task thread and keeps its primary conversation", async () => {
  const findFirst = vi.fn().mockResolvedValue({ id: "task-thread" });
  const target = await resolveThreadTarget({ thread: { findFirst } } as never, actor, {
    botId: "mico",
    taskThreadId: "task-thread",
  });
  expect(target).toMatchObject({
    botId: "mico",
    threadId: "task-thread",
    projectSessionId: "task-thread",
    bot: { thread: { id: "primary" } },
  });
  expect(findFirst).toHaveBeenCalledWith({
    where: { id: "task-thread", taskBotId: "mico", userId: "owner", spaceId: "space" },
  });
});
it("never substitutes the main chat for another owner's or Mico's task", async () => {
  await expect(
    resolveThreadTarget(
      { thread: { findFirst: vi.fn().mockResolvedValue(null) } } as never,
      actor,
      { botId: "mico", taskThreadId: "foreign" },
    ),
  ).rejects.toThrow();
});
it("keeps ordinary Mico chat targets unchanged", async () => {
  const target = await resolveThreadTarget({} as never, actor, { botId: "mico" });
  expect(target.threadId).toBe("primary");
});
const ROUTES = ["open", "rename", "list", "status", "projects", "saveProject", "projectTask", "primaryRun", "archive", "restore", "remove"];
function routesFor(prisma: object) {
  const handler = { handler: (fn: unknown) => fn };
  const routes = developmentRoutes({
    deps: { prisma },
    authed: { development: Object.fromEntries(ROUTES.map((name) => [name, handler])) },
  } as never);
  return routes.development as unknown as Record<string, (v: unknown) => Promise<any>>;
}
function fixture(row: object) {
  const prisma = { thread: { upsert: vi.fn().mockResolvedValue(row), updateMany: vi.fn().mockResolvedValue({count:1}) } };
  const routes = routesFor(prisma);
  return { prisma, open: routes.open!, rename: routes.rename! };
}
it("opens an idempotent separate thread on the existing Mico without copying its configuration", async () => {
  const f = fixture({ id: "task-thread", taskBotId: "mico", projectKey: "project" });
  await expect(
    f.open({
      context: { actor },
      input: { botId: "mico", projectKey: "project", taskKey: "task", title: "Change" },
    }),
  ).resolves.toEqual({ threadId: "task-thread" });
  expect(getBot).toHaveBeenCalledWith(actor, "mico");
  expect(f.prisma.thread.upsert).toHaveBeenCalledWith({
    where: { spaceId_userId_taskKey: { spaceId: "space", userId: "owner", taskKey: "task" } },
    create: {
      spaceId: "space",
      userId: "owner",
      taskBotId: "mico",
      projectKey: "project",
      taskKey: "task",
      title: "Change",
      titleSource: "user",
      startedBy: "user",
    },
    update: {},
  });
});
it("does not reassign an existing task to a different Mico or project", async () => {
  const f = fixture({ id: "task-thread", taskBotId: "other", projectKey: "project" });
  await expect(
    f.open({
      context: { actor },
      input: { botId: "mico", projectKey: "project", taskKey: "task", title: "Change" },
    }),
  ).rejects.toThrow("different Mico");
});

it("creates an untitled conversation without inventing a permanent title", async () => {
  const f=fixture({id:"task-thread",taskBotId:"mico",projectKey:"mico:mico"});
  await f.open({context:{actor},input:{botId:"mico",projectKey:"mico:mico",taskKey:"mico-task:mico:new"}});
  expect(f.prisma.thread.upsert).toHaveBeenCalledWith(expect.objectContaining({create:expect.objectContaining({title:null,titleSource:null,startedBy:"user"}),update:{}}));
});

it("lists each side thread's kind, archive, live state, outcome and who opened it", async () => {
  const at = (iso: string) => new Date(iso);
  const base = { taskBotId: "mico", titleSource: null, startedBy: null, outcome: null, lastError: null, archivedAt: null,
    deleteAfter: null, createdAt: at("2026-11-20T10:00:00Z"), updatedAt: at("2026-11-21T10:00:00Z"), activeStatuses: null };
  const rows = [
    { ...base, id: "chat", projectKey: "mico:mico", taskKey: "mico-task:mico:one", title: "Plan", titleSource: "user", startedBy: "user", activeStatuses: ["running"] },
    { ...base, id: "daily", projectKey: "routine:r1", taskKey: "routine:r1", title: null, outcome: "failed", lastError: "Provider refused" },
    { ...base, id: "flow", projectKey: "workflow:f1", taskKey: "workflow:e1:mico", title: "Step", activeStatuses: ["queued", "waiting_input"] },
    { ...base, id: "helper", projectKey: "work:root", taskKey: "delegation:k1", title: "Check", outcome: "completed", titleSource: "auto" },
    { ...base, id: "old", projectKey: "mico:mico", taskKey: "mico-task:mico:two", title: "Done", archivedAt: at("2026-11-21T09:00:00Z"), outcome: "interrupted" },
    { ...base, id: "gone", projectKey: "mico:mico", taskKey: "mico-task:mico:three", title: "Bye", deleteAfter: at("2026-11-22T10:00:06Z"), outcome: "bogus" },
  ];
  const prisma = { $queryRaw: vi.fn().mockResolvedValue(rows) };
  const listed = await routesFor(prisma).list!({ context: { actor }, input: { botId: "mico" } });
  expect(listed.map((row: any) => [row.threadId, row.kind, row.archived, row.state, row.outcome, row.startedBy, row.titleSource])).toEqual([
    ["chat", "conversation", false, "running", null, "user", "user"],
    ["daily", "routine", false, "idle", "failed", "routine", null],
    ["flow", "workflow", false, "waiting", null, "routine", null],
    ["helper", "delegation", false, "idle", "completed", "delegation", "auto"],
    ["old", "conversation", true, "closed", "interrupted", "user", null],
    ["gone", "conversation", false, "closed", null, "user", null],
  ]);
  expect(listed[1]).toMatchObject({ title: "", lastError: "Provider refused", archivedAt: null, deleteAfter: null,
    createdAt: "2026-11-20T10:00:00.000Z", updatedAt: "2026-11-21T10:00:00.000Z" });
  expect(listed[4].archivedAt).toBe("2026-11-21T09:00:00.000Z");
  expect(listed[5].deleteAfter).toBe("2026-11-22T10:00:06.000Z");
  // The query is fenced by owner, Space and Mico.
  const sql = prisma.$queryRaw.mock.calls[0]!;
  expect(sql.slice(1)).toEqual(expect.arrayContaining(["space", "owner", "mico"]));
});

it("renames only a conversation owned by this account, Space and Mico, as a title of the person's", async () => {
  const f=fixture({});
  await expect(f.rename({context:{actor},input:{botId:"mico",taskThreadId:"task-thread",title:"  Mi título "}})).resolves.toEqual({threadId:"task-thread",title:"Mi título"});
  expect(f.prisma.thread.updateMany).toHaveBeenCalledWith({where:{id:"task-thread",userId:"owner",spaceId:"space",taskBotId:"mico",projectKey:"mico:mico",taskKey:{startsWith:"mico-task:mico:"},deleteAfter:null},data:{title:"Mi título",titleSource:"user"}});
  f.prisma.thread.updateMany.mockResolvedValue({count:0});
  await expect(f.rename({context:{actor},input:{botId:"mico",taskThreadId:"foreign",title:"No"}})).rejects.toThrow();
});

it.each(["", "   ", "x".repeat(121), "Dos\nlíneas"])("refuses the title %j with an explanation before touching the thread", async (title) => {
  const f=fixture({});
  await expect(f.rename({context:{actor},input:{botId:"mico",taskThreadId:"task-thread",title}}))
    .rejects.toMatchObject({code:"BAD_REQUEST",message:expect.stringContaining("1 to 120 characters")});
  expect(f.prisma.thread.updateMany).not.toHaveBeenCalled();
});
