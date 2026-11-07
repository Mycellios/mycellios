import { beforeEach, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ handler: null as unknown as (event: unknown, value: unknown) => Promise<void>, choose: vi.fn(), prepare: vi.fn() }));
vi.mock("electron", () => ({ ipcMain: { handle: (_: string, handler: typeof f.handler) => { f.handler = handler; } }, dialog: { showOpenDialog: f.choose } }));
vi.mock("./project-workspaces.js", () => ({ ProjectWorkspaces: class { prepare(...args: unknown[]) { return f.prepare(...args); } } }));
import { installProjectConversations } from "./project-conversations-ipc.js";
const project = { projectId: "11111111-1111-4111-8111-111111111111", name: "Fixture", userId: "owner", spaceId: "space" };
beforeEach(() => { f.prepare.mockReset(); f.choose.mockReset(); });
function fixture(attachedRepository?: (scope: string, botId: string, projectId: string) => string | undefined) {
  const fetch = vi.fn(async () => Response.json({ json: project }));
  const validate = vi.fn(async () => {}), bindTaskProject = vi.fn(async () => () => {});
  const context = vi.fn(async () => ({ window: { webContents: { session: { fetch } } }, base: "https://example.invalid/agent", spaceId: "space", validate }));
  installProjectConversations({ storage: "/fixture", host: { isEnabled: () => true, bindTaskProject }, context, attachedRepository } as never);
  return { fetch, validate, context, bindTaskProject };
}
it("binds only the API-confirmed project and never accepts renderer-supplied paths", async () => {
  const state = fixture();
  f.prepare.mockImplementation(async (scope, projectId, thread, _choose, validate) => { await validate(); expect(scope).toContain("owner"); expect(projectId).toBe(project.projectId); expect(thread).toBe("thread"); return "/native/worktree"; });
  await f.handler({}, { botId: "mico", taskThreadId: "thread", path: "/untrusted" });
  expect(state.bindTaskProject).toHaveBeenCalledWith("thread", "mico", "/native/worktree", expect.any(Function), undefined, expect.any(Function));
  expect(state.fetch.mock.calls[0]![0]).toBe("https://example.invalid/agent/rpc/development/projectTask");
});
it("refuses an account change during worktree preparation", async () => {
  const state = fixture();
  state.fetch.mockResolvedValueOnce(Response.json({ json: project })).mockResolvedValue(Response.json({ json: { ...project, userId: "other" } }));
  f.prepare.mockImplementation(async (_scope, _projectId, _thread, _choose, validate) => { await validate(); });
  await expect(f.handler({}, { botId: "mico", taskThreadId: "thread" })).rejects.toThrow("account changed");
  expect(state.bindTaskProject).not.toHaveBeenCalled();
});
it("does not select folders or bind ordinary Mico tasks", async () => {
  const state = fixture(); state.fetch.mockResolvedValue(Response.json({ json: null }));
  await f.handler({}, { botId: "mico", taskThreadId: "thread" });
  expect(f.prepare).not.toHaveBeenCalled(); expect(state.bindTaskProject).not.toHaveBeenCalled();
});
it("uses the attached repository for this exact owned project without opening another picker", async () => {
  const attached = vi.fn(() => "/native/repository");
  const state = fixture(attached);
  f.prepare.mockImplementation(async (_scope, _projectId, _thread, choose) => {
    expect(await choose()).toBe("/native/repository");
    return "/native/worktree";
  });
  await f.handler({}, { botId: "mico", taskThreadId: "thread" });
  expect(attached).toHaveBeenCalledWith(JSON.stringify(["https://example.invalid/agent", "owner", "space"]), "mico", project.projectId);
  expect(f.choose).not.toHaveBeenCalled();
  expect(state.bindTaskProject).toHaveBeenCalledOnce();
});
it("refuses preview frames and unavailable ownership before touching local files", async () => {
  const state = fixture(); state.context.mockRejectedValue(Error("untrusted frame"));
  await expect(f.handler({}, { botId: "mico", taskThreadId: "thread" })).rejects.toThrow("untrusted frame");
  expect(f.prepare).not.toHaveBeenCalled();
});
