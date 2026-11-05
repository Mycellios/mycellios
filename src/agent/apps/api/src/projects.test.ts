import { beforeEach, expect, it, vi } from "vitest";
const { getBot } = vi.hoisted(() => ({ getBot: vi.fn() }));
vi.mock("@rakazo/db", async original => ({ ...(await original<object>()), createRepos: () => ({ getBot }) }));
import { projectRoutes } from "./routes/projects.js";

beforeEach(() => { getBot.mockReset(); getBot.mockResolvedValue({ id: "mico" }); });
const scope = { userId: "owner", spaceId: "space" };
function fixture() {
  const prisma = { developmentProject: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn(), count: vi.fn(async () => 0) }, thread: { findMany: vi.fn(), findFirst: vi.fn() }, run: { findFirst: vi.fn() } };
  const handler = { handler: (fn: unknown) => fn };
  const routes = projectRoutes({ deps: { prisma }, authed: { development: { projects: handler, saveProject: handler, projectTask: handler, primaryRun: handler } } } as never) as unknown as Record<string, (v: unknown) => Promise<unknown>>;
  const call = (name: string, input = {}) => routes[name]!({ context: { actor: scope }, input });
  return { prisma, call };
}
it("groups different Micos under one project while keeping owner, Space and conversations separate", async () => {
  const f = fixture();
  f.prisma.developmentProject.findMany.mockResolvedValue([{ id: "one", name: "App" }, { id: "two", name: "Other" }]);
  f.prisma.thread.findMany.mockResolvedValue([{ id: "a", taskBotId: "mico", projectKey: "project:one", title: "Login", unread: true }, { id: "b", taskBotId: "second", projectKey: "project:one", title: "Tests", unread: false }]);
  expect(await f.call("projects")).toMatchObject([{ id: "one", conversations: [{ threadId: "a", botId: "mico" }, { threadId: "b", botId: "second" }] }, { id: "two", conversations: [] }]);
  expect(f.prisma.thread.findMany.mock.calls[0]![0].where).toMatchObject(scope);
  expect(f.prisma.developmentProject.findMany.mock.calls[0]![0].where).toEqual(scope);
});
it("cannot rename or adopt a foreign project UUID", async () => {
  const f = fixture(); f.prisma.developmentProject.findFirst.mockResolvedValue(null); f.prisma.developmentProject.create.mockRejectedValue(Error("duplicate"));
  await expect(f.call("saveProject", { id: "foreign", name: "Stolen" })).rejects.toThrow();
  expect(f.prisma.developmentProject.updateMany).not.toHaveBeenCalled();
});
it("returns project metadata only for the owned Mico and exact conversation", async () => {
  const f = fixture(); f.prisma.thread.findFirst.mockResolvedValue({ projectKey: "project:one" }); f.prisma.developmentProject.findFirst.mockResolvedValue({ id: "one", name: "App" });
  expect(await f.call("projectTask", { botId: "mico", taskThreadId: "thread" })).toEqual({ projectId: "one", name: "App", ...scope });
  expect(f.prisma.thread.findFirst).toHaveBeenCalledWith({ where: { ...scope, id: "thread", taskBotId: "mico" } });
  f.prisma.thread.findFirst.mockResolvedValue(null);
  await expect(f.call("projectTask", { botId: "mico", taskThreadId: "foreign" })).rejects.toThrow();
});
it("keeps ordinary Mico tasks on their existing computer route", async () => {
  const f = fixture(); f.prisma.thread.findFirst.mockResolvedValue({ taskBotId: "mico", projectKey: "mico:mico", taskKey: "mico-task:mico:one" });
  expect(await f.call("projectTask", { botId: "mico", taskThreadId: "task" })).toBeNull();
  expect(f.prisma.developmentProject.findFirst).not.toHaveBeenCalled();
});
it("distinguishes owned ordinary runs from project runs without trusting worker paths", async () => {
  const f = fixture();
  f.prisma.run.findFirst.mockResolvedValue({ thread: { projectKey: null } });
  expect(await f.call("primaryRun", { botId: "mico", runId: "primary" })).toBe(true);
  f.prisma.run.findFirst.mockResolvedValue({ thread: { id: "one", taskBotId: "mico", projectKey: "project:one", taskKey: "project-task:one" } });
  expect(await f.call("primaryRun", { botId: "mico", runId: "project-run" })).toBe(false);
  f.prisma.run.findFirst.mockResolvedValue(null);
  expect(await f.call("primaryRun", { botId: "mico", runId: "foreign" })).toBe(false);
  expect(f.prisma.run.findFirst.mock.calls[0]![0].where).toMatchObject(scope);
});
