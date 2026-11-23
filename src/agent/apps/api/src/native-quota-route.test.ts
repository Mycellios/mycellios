import { beforeEach, expect, it, vi } from "vitest";
const fixtures = vi.hoisted(() => ({ allowed: true, read: vi.fn(), access: vi.fn(), engines: vi.fn() }));
vi.mock("@mycellios/adapters", () => ({
  nativeHostAccess: (...args: unknown[]) => { fixtures.access(...args); return fixtures.allowed; },
  discoverNativeCodexQuota: () => fixtures.read(),
  canInstallNativeOpenCode: vi.fn(), discoverNativeCodexModels: vi.fn(), discoverNativeEngines: () => fixtures.engines(), installManagedOpenCode: vi.fn(), reconcileWorkStops: vi.fn(),
}));
import { localCapabilityRoutes } from "./routes/local-capabilities.js";
import type { RouterContext } from "./routes/context.js";
beforeEach(() => { fixtures.allowed = true; fixtures.read.mockReset().mockResolvedValue(null); fixtures.access.mockClear(); });
function routes(dependencies?: { getBot: ReturnType<typeof vi.fn>; nativeEngines: ReturnType<typeof vi.fn> }) {
  const procedure = { handler: (handler: unknown) => handler };
  const authed = { engines: { forBot: procedure, codexQuota: procedure, codexModels: procedure, list: procedure, installOpenCode: procedure, registry: procedure }, tasks: { overview: procedure, concurrency: procedure, work: procedure, controlWork: procedure, waits: procedure, cancelWait: procedure, awaitingReplies: procedure, stopAwaitingReply: procedure, hideAwaitingReplies: procedure, get: procedure, control: procedure } };
  return localCapabilityRoutes({ authed, deps: { dataDir: "host", sandbox: { nativeEngines: dependencies?.nativeEngines } }, repos: { getBot: dependencies?.getBot } } as unknown as RouterContext);
}
function route() {
  return routes().engines.codexQuota as unknown as (input: { context: { actor: { userId: string; spaceId: string } } }) => Promise<unknown>;
}
it("checks grants even for cached quota and never reads the CLI for an unauthorized actor", async () => {
  const read = route(); const request = { context: { actor: { userId: "user", spaceId: "space" } } };
  fixtures.allowed = false;
  expect(await read(request)).toBeNull(); expect(fixtures.read).not.toHaveBeenCalled();
  fixtures.allowed = true;
  await read(request); await read(request); expect(fixtures.read).toHaveBeenCalledOnce();
  fixtures.allowed = false;
  expect(await read(request)).toBeNull(); expect(fixtures.read).toHaveBeenCalledOnce();
  expect(fixtures.access).toHaveBeenLastCalledWith("host", request.context.actor);
});
it("shares concurrent reads and handles unavailable CLI without leaking its error", async () => {
  const read = route(); const request = { context: { actor: { userId: "user", spaceId: "space" } } };
  fixtures.read.mockRejectedValue(new Error("private CLI failure"));
  expect(await Promise.all([read(request), read(request)])).toEqual([null, null]);
  expect(fixtures.read).toHaveBeenCalledOnce();
});


it("queries only the owned Mico's selected Desktop and never substitutes server engines", async () => {
  fixtures.engines.mockReset().mockResolvedValue([{ id: "codex", available: true }]);
  const getBot = vi.fn().mockResolvedValue({ id: "mico", computer: { kind: "desktop", scope: "dedicated" } });
  const nativeEngines = vi.fn().mockResolvedValueOnce(["opencode"]).mockRejectedValueOnce(Error("PC disconnected"));
  const list = routes({ getBot, nativeEngines }).engines.forBot as unknown as (arg: unknown) => Promise<unknown>;
  const actor = { userId: "user", spaceId: "space" };
  const request = { context: { actor }, input: { botId: "mico" } };
  expect(await list(request)).toEqual({ computer: "desktop", engines: ["opencode"] });
  expect(getBot).toHaveBeenCalledWith(actor, "mico");
  expect(nativeEngines).toHaveBeenCalledWith(expect.objectContaining({ ...actor, botId: "mico" }));
  expect(await list(request)).toEqual({ computer: "desktop", engines: [] });
  expect(fixtures.engines).not.toHaveBeenCalled();
  getBot.mockRejectedValueOnce(new Error("Mico is outside this Space"));
  await expect(list(request)).rejects.toThrow("outside this Space");
  expect(nativeEngines).toHaveBeenCalledTimes(2);
  getBot.mockResolvedValueOnce({ id: "mico", computer: { kind: "docker", scope: "isolated" } });
  expect(await list(request)).toEqual({ computer: "server", engines: ["codex"] });
  expect(nativeEngines).toHaveBeenCalledTimes(2);
});
