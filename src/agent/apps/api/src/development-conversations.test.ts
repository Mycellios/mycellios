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
  const prisma = { thread: { upsert: vi.fn().mockResolvedValue(row) } };
  const handler = { handler: (fn: unknown) => fn };
  const routes = developmentRoutes({
    deps: { prisma },
    authed: { development: { open: handler, list: handler, status: handler, projects: handler, saveProject: handler, projectTask: handler, primaryRun: handler } },
  } as never);
  return { prisma, open: routes.development.open as unknown as (v: unknown) => Promise<unknown> };
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
