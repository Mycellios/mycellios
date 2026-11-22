import { beforeEach, expect, it, vi } from "vitest";
const { getBot } = vi.hoisted(() => ({ getBot: vi.fn() }));
vi.mock("@rakazo/db", async (original) => ({
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
function fixture(row: object) {
  const prisma = { thread: { upsert: vi.fn().mockResolvedValue(row), updateMany: vi.fn().mockResolvedValue({count:1}) } };
  const handler = { handler: (fn: unknown) => fn };
  const routes = developmentRoutes({
    deps: { prisma },
    authed: { development: { open: handler, rename: handler, list: handler, status: handler, projects: handler, saveProject: handler, projectTask: handler, primaryRun: handler } },
  } as never);
  return { prisma, open: routes.development.open as unknown as (v: unknown) => Promise<unknown>, rename: routes.development.rename as unknown as (v: unknown) => Promise<unknown> };
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
  expect(f.prisma.thread.upsert).toHaveBeenCalledWith(expect.objectContaining({create:expect.objectContaining({title:null}),update:{}}));
});

it("labels each side thread's kind and marks the ones archived in this account's Tasks inbox", async () => {
  const rows = [
    { id: "chat", projectKey: "mico:mico", taskKey: "mico-task:mico:one", title: "Plan", taskBotId: "mico" },
    { id: "daily", projectKey: "routine:r1", taskKey: "routine:r1", title: null, taskBotId: "mico" },
    { id: "flow", projectKey: "workflow:f1", taskKey: "workflow:e1:mico", title: "Step", taskBotId: "mico" },
    { id: "helper", projectKey: "work:root", taskKey: "delegation:k1", title: "Check", taskBotId: "mico" },
    { id: "old", projectKey: "mico:mico", taskKey: "mico-task:mico:two", title: "Done", taskBotId: "mico" },
  ];
  const inboxTask = { findMany: vi.fn().mockResolvedValue([{ threadId: "old" }]) };
  const prisma = { thread: { findMany: vi.fn().mockResolvedValue(rows) }, inboxTask };
  const handler = { handler: (fn: unknown) => fn };
  const routes = developmentRoutes({ deps: { prisma }, authed: { development: { open: handler, rename: handler, list: handler, status: handler, projects: handler, saveProject: handler, projectTask: handler, primaryRun: handler } } } as never);
  const list = routes.development.list as unknown as (v: unknown) => Promise<Array<{ threadId: string; kind?: string; archived?: boolean }>>;
  const listed = await list({ context: { actor }, input: { botId: "mico" } });
  expect(listed.map(({ threadId, kind, archived }) => [threadId, kind, archived])).toEqual([
    ["chat", "conversation", false], ["daily", "routine", false], ["flow", "workflow", false],
    ["helper", "delegation", false], ["old", "conversation", true],
  ]);
  expect(inboxTask.findMany).toHaveBeenCalledWith({
    where: { threadId: { in: rows.map((row) => row.id) }, userId: "owner", spaceId: "space", archivedAt: { not: null } },
    select: { threadId: true },
  });
  inboxTask.findMany.mockRejectedValueOnce(new Error("relation \"task_inbox\" does not exist"));
  expect((await list({ context: { actor }, input: { botId: "mico" } })).every((row) => row.archived === false)).toBe(true);
});

it("renames only a conversation owned by this account, Space and Mico", async () => {
  const f=fixture({});
  await expect(f.rename({context:{actor},input:{botId:"mico",taskThreadId:"task-thread",title:"Mi título"}})).resolves.toEqual({threadId:"task-thread",title:"Mi título"});
  expect(f.prisma.thread.updateMany).toHaveBeenCalledWith({where:{id:"task-thread",userId:"owner",spaceId:"space",taskBotId:"mico",projectKey:"mico:mico",taskKey:{startsWith:"mico-task:mico:"}},data:{title:"Mi título"}});
  f.prisma.thread.updateMany.mockResolvedValue({count:0});
  await expect(f.rename({context:{actor},input:{botId:"mico",taskThreadId:"foreign",title:"No"}})).rejects.toThrow();
});
