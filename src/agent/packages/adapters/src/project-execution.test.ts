import { expect, it, vi } from "vitest";
import type { PrismaClient } from "@rakazo/db";
import type { SandboxProvider } from "@rakazo/adapter-kit";
import { projectExecutionLeaseKey, projectLeaseOwner, PROJECT_SHARED_SCREEN_TOOLS } from "./project-execution.js";

const run = { id: "run", botId: "mico", threadId: "thread", userId: "owner", spaceId: "space" };
const computer = { id: "pc", kind: "desktop", scope: "team", providerRef: "native", homeKey: "mico-home" };
function setup() {
  const thread = vi.fn(async () => ({ projectKey: "project:project-id" }));
  const project = vi.fn(async () => ({ id: "project-id" }));
  const environment = vi.fn(async (_computer: unknown, _context: unknown) => ({ platform: "win32", home: "home", shell: "pwsh",
    projectSessionId: run.threadId, projectPath: "isolated-worktree", taskIsolation: "worktree-v1" }));
  return { thread, project, environment, prisma: { thread: { findFirst: thread }, developmentProject: { findFirst: project } } as unknown as PrismaClient,
    sandbox: { environment } as unknown as SandboxProvider };
}
it("requires owner, Space, Mico, project and native task proof before separating computer leases", async () => {
  const f = setup();
  expect(await projectExecutionLeaseKey(f.prisma, f.sandbox, run, computer)).toBe("task-worktree:mico:thread");
  expect(f.thread.mock.calls[0]).toEqual([{ where: { id: "thread", userId: "owner", spaceId: "space", taskBotId: "mico", projectKey: { startsWith: "project:" } }, select: { projectKey: true } }]);
  expect(f.environment.mock.calls[0]?.[1]).toMatchObject({ runId: "run", botId: "mico", projectSessionId: "thread", userId: "owner", spaceId: "space" });
  f.thread.mockResolvedValueOnce(null as never);
  expect(await projectExecutionLeaseKey(f.prisma, f.sandbox, run, computer)).toBeUndefined();
  f.project.mockResolvedValueOnce(null as never);
  expect(await projectExecutionLeaseKey(f.prisma, f.sandbox, run, computer)).toBeUndefined();
});
it("keeps legacy, remote and screen computers on their existing leases", async () => {
  const f = setup();
  for (const patch of [{ kind: "docker" }, { scope: "dedicated" }, { providerRef: null }])
    expect(await projectExecutionLeaseKey(f.prisma, f.sandbox, run, { ...computer, ...patch })).toBeUndefined();
  expect(f.environment).not.toHaveBeenCalled();
  f.environment.mockResolvedValueOnce({ projectSessionId: "other" } as never);
  expect(await projectExecutionLeaseKey(f.prisma, f.sandbox, run, computer)).toBeUndefined();
  f.environment.mockResolvedValueOnce({ projectSessionId: "thread", projectPath: "legacy-folder" } as never);
  expect(await projectExecutionLeaseKey(f.prisma, f.sandbox, run, computer)).toBeUndefined();
  f.environment.mockRejectedValueOnce(new Error("disconnected"));
  expect(await projectExecutionLeaseKey(f.prisma, f.sandbox, run, computer)).toBeUndefined();
  expect(PROJECT_SHARED_SCREEN_TOOLS).toContain("request_takeover");
  expect(PROJECT_SHARED_SCREEN_TOOLS).toContain("computer_act");
});
it("recovers only a well-formed task lease's native teardown destination", () => {
  expect(projectLeaseOwner("task-worktree:mico:thread")).toEqual({ botId: "mico", projectSessionId: "thread" });
  for (const key of ["mico", "task-worktree:mico:thread:extra", "task-worktree:../pc:thread", "task-worktree::thread"])
    expect(projectLeaseOwner(key)).toBeUndefined();
});

it("admits a cold linked Team PC only after current provider and native worktree proof", async () => {
  const f = setup();
  const kind = vi.fn(async () => "desktop" as const);
  f.sandbox.provisionKind = kind;
  const cold = { ...computer, kind: "none", providerRef: null };
  expect(await projectExecutionLeaseKey(f.prisma, f.sandbox, run, cold)).toBe("task-worktree:mico:thread");
  expect(kind).toHaveBeenCalledWith(expect.objectContaining({ botId: "mico", projectSessionId: "thread", userId: "owner", spaceId: "space" }));
  expect(f.environment.mock.calls[0]?.[0]).toMatchObject({ id: "pc", kind: "desktop" });
  kind.mockResolvedValueOnce("docker" as never);
  f.environment.mockClear();
  expect(await projectExecutionLeaseKey(f.prisma, f.sandbox, run, cold)).toBeUndefined();
  expect(f.environment).not.toHaveBeenCalled();
  f.environment.mockResolvedValueOnce({ projectSessionId: "other", taskIsolation: "worktree-v1", projectPath: "elsewhere" } as never);
  expect(await projectExecutionLeaseKey(f.prisma, f.sandbox, run, cold)).toBeUndefined();
  f.project.mockResolvedValueOnce(null as never);
  kind.mockClear();
  expect(await projectExecutionLeaseKey(f.prisma, f.sandbox, run, cold)).toBeUndefined();
  expect(kind).not.toHaveBeenCalled();
});
