import { beforeEach, expect, it, vi } from "vitest";
const fixtures = vi.hoisted(() => ({ allowed: true, read: vi.fn(), access: vi.fn() }));
vi.mock("@rakazo/adapters", () => ({
  nativeHostAccess: (...args: unknown[]) => { fixtures.access(...args); return fixtures.allowed; },
  discoverNativeCodexQuota: () => fixtures.read(),
  canInstallNativeOpenCode: vi.fn(), discoverNativeCodexModels: vi.fn(), discoverNativeEngines: vi.fn(), installManagedOpenCode: vi.fn(), reconcileWorkStops: vi.fn(),
}));
import { localCapabilityRoutes } from "./routes/local-capabilities.js";
import type { RouterContext } from "./routes/context.js";
beforeEach(() => { fixtures.allowed = true; fixtures.read.mockReset().mockResolvedValue(null); fixtures.access.mockClear(); });
function route() {
  const procedure = { handler: (handler: unknown) => handler };
  const authed = { engines: { codexQuota: procedure, codexModels: procedure, list: procedure, installOpenCode: procedure, registry: procedure }, tasks: { overview: procedure, concurrency: procedure, work: procedure, controlWork: procedure, get: procedure, control: procedure } };
  const routes = localCapabilityRoutes({ authed, deps: { dataDir: "host" } } as unknown as RouterContext);
  return routes.engines.codexQuota as unknown as (input: { context: { actor: { userId: string; spaceId: string } } }) => Promise<unknown>;
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
