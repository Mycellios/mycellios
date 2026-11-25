import { beforeEach, expect, it, vi } from "vitest";
const fixtures = vi.hoisted(() => ({ allowed: true, read: vi.fn(), access: vi.fn(), engines: vi.fn() }));
vi.mock("@mycellios/adapters", () => ({
  nativeHostAccess: (...args: unknown[]) => { fixtures.access(...args); return fixtures.allowed; },
  discoverNativeCodexQuota: () => fixtures.read(),
  canInstallNativeOpenCode: vi.fn(), discoverNativeCodexModels: vi.fn(), discoverNativeEngines: () => fixtures.engines(),
  signedOutEngines: (engines: Array<{ id: string; signedIn?: boolean }>) => engines.flatMap(engine => engine.signedIn === false ? [engine.id] : []),
  nativeEngineModels: (engines: Array<{ id: string; models?: unknown }>) => Object.fromEntries(engines.flatMap(engine => engine.models ? [[engine.id, engine.models]] : [])),
  defaultLocalEngine: (signedIn: string[] = []) => ["claude", "codex"].find(engine => signedIn.includes(engine)),
  installManagedOpenCode: vi.fn(), reconcileWorkStops: vi.fn(),
}));
import { localCapabilityRoutes } from "./routes/local-capabilities.js";
import type { RouterContext } from "./routes/context.js";
import { localEngineForNewMico } from "./routes/shared.js";
import type { RouterDeps } from "./router.js";
beforeEach(() => { fixtures.allowed = true; fixtures.read.mockReset().mockResolvedValue(null); fixtures.access.mockClear(); });
function routes(dependencies?: { getBot: ReturnType<typeof vi.fn>; nativeEngines?: ReturnType<typeof vi.fn>; nativeEngineState?: ReturnType<typeof vi.fn>; nativeEngineAccount?: ReturnType<typeof vi.fn>; nativeEngineUsage?: ReturnType<typeof vi.fn> }) {
  const procedure = { handler: (handler: unknown) => handler };
  const authed = { engines: { forBot: procedure, account: procedure, codexQuota: procedure, codexModels: procedure, list: procedure, installOpenCode: procedure, registry: procedure }, tasks: { overview: procedure, concurrency: procedure, work: procedure, controlWork: procedure, waits: procedure, cancelWait: procedure, awaitingReplies: procedure, stopAwaitingReply: procedure, hideAwaitingReplies: procedure, get: procedure, control: procedure } };
  return localCapabilityRoutes({ authed, deps: { dataDir: "host", sandbox: { nativeEngines: dependencies?.nativeEngines, nativeEngineState: dependencies?.nativeEngineState, nativeEngineAccount: dependencies?.nativeEngineAccount, nativeEngineUsage: dependencies?.nativeEngineUsage } }, repos: { getBot: dependencies?.getBot } } as unknown as RouterContext);
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
  expect(await list(request)).toEqual({ computer: "desktop", engines: ["opencode"], signedOut: [], models: {} });
  expect(getBot).toHaveBeenCalledWith(actor, "mico");
  expect(nativeEngines).toHaveBeenCalledWith(expect.objectContaining({ ...actor, botId: "mico" }));
  expect(await list(request)).toEqual({ computer: "desktop", engines: [], signedOut: [], models: {} });
  expect(fixtures.engines).not.toHaveBeenCalled();
  getBot.mockRejectedValueOnce(new Error("Mico is outside this Space"));
  await expect(list(request)).rejects.toThrow("outside this Space");
  expect(nativeEngines).toHaveBeenCalledTimes(2);
  getBot.mockResolvedValueOnce({ id: "mico", computer: { kind: "docker", scope: "isolated" } });
  expect(await list(request)).toEqual({ computer: "server", engines: ["codex"], signedOut: [], models: {} });
  expect(nativeEngines).toHaveBeenCalledTimes(2);
});

it("reports installed engines whose CLI is signed out, only among the installed ones", async () => {
  const getBot = vi.fn().mockResolvedValue({ id: "mico", computer: { kind: "desktop", scope: "dedicated" } });
  const nativeEngineState = vi.fn().mockResolvedValue({ engines: ["claude", "opencode"], signedOut: ["claude", "codex"] });
  const list = routes({ getBot, nativeEngineState }).engines.forBot as unknown as (arg: unknown) => Promise<unknown>;
  const request = { context: { actor: { userId: "user", spaceId: "space" } }, input: { botId: "mico" } };
  expect(await list(request)).toEqual({ computer: "desktop", engines: ["claude", "opencode"], signedOut: ["claude"], models: {} });
  fixtures.engines.mockReset().mockResolvedValue([{ id: "codex", available: true, signedIn: false }]);
  getBot.mockResolvedValueOnce({ id: "mico", computer: { kind: "docker", scope: "isolated" } });
  expect(await list(request)).toEqual({ computer: "server", engines: ["codex"], signedOut: ["codex"], models: {} });
});

it("returns only well-formed catalogs of installed, signed-in engines a Desktop reports", async () => {
  const getBot = vi.fn().mockResolvedValue({ id: "mico", computer: { kind: "desktop", scope: "dedicated" } });
  const opus = { id: "opus", label: "Opus", isDefault: false, thinkingLevels: ["high"], fast: false };
  const nativeEngineState = vi.fn().mockResolvedValue({
    engines: ["claude", "codex"], signedOut: ["codex"],
    models: { claude: [opus, { id: "", label: "broken" }, "text"], codex: [opus], opencode: [opus] },
  });
  const list = routes({ getBot, nativeEngineState }).engines.forBot as unknown as (arg: unknown) => Promise<unknown>;
  const request = { context: { actor: { userId: "user", spaceId: "space" } }, input: { botId: "mico" } };
  expect(await list(request)).toEqual({
    computer: "desktop", engines: ["claude", "codex"], signedOut: ["codex"], models: { claude: [opus] },
  });
});

it("starts a new This PC Mico only on an installed CLI that confirmed a sign-in on that PC", async () => {
  const actor = { userId: "user", spaceId: "space" };
  const pick = (state: unknown) => localEngineForNewMico(
    { sandbox: { nativeEngineState: vi.fn().mockResolvedValue(state) } } as unknown as RouterDeps, actor, "mico");
  expect(await pick({ engines: ["claude", "codex"], signedOut: [], signedIn: ["codex", "claude"] })).toBe("claude");
  expect(await pick({ engines: ["codex"], signedOut: [], signedIn: ["claude", "codex"] })).toBe("codex");
  expect(await pick({ engines: ["claude", "codex"], signedOut: ["claude"], signedIn: ["claude"] })).toBeUndefined();
  // An older Desktop reports no confirmed sign-in, and OpenCode cannot confirm one: both keep Pi.
  expect(await pick({ engines: ["claude", "opencode"], signedOut: [] })).toBeUndefined();
  expect(await pick({ engines: ["opencode"], signedOut: [], signedIn: ["opencode"] })).toBeUndefined();
  const offline = { sandbox: { nativeEngineState: vi.fn().mockRejectedValue(Error("PC offline")) } } as unknown as RouterDeps;
  expect(await localEngineForNewMico(offline, actor, "mico")).toBeUndefined();
});

it("reads a This PC Mico's plan usage from its own PC and keeps the server's grant for others", async () => {
  const actor = { userId: "user", spaceId: "space" };
  const getBot = vi.fn().mockResolvedValue({ id: "mico", computer: { kind: "desktop", scope: "dedicated" } });
  const reading = { credentialId: "native:codex" };
  const nativeEngineUsage = vi.fn().mockResolvedValue({ codex: reading });
  const quota = routes({ getBot, nativeEngineUsage }).engines.codexQuota as unknown as (arg: unknown) => Promise<unknown>;
  const request = { context: { actor }, input: { botId: "mico" } };
  expect(await quota(request)).toBe(reading);
  expect(getBot).toHaveBeenCalledWith(actor, "mico");
  expect(nativeEngineUsage).toHaveBeenCalledWith(expect.objectContaining({ ...actor, botId: "mico" }));
  expect(fixtures.read).not.toHaveBeenCalled();
  nativeEngineUsage.mockRejectedValueOnce(new Error("PC disconnected"));
  expect(await quota(request)).toBeNull();
  // Another computer keeps the server's own Codex behind the operator grant.
  getBot.mockResolvedValueOnce({ id: "mico", computer: { kind: "docker", scope: "isolated" } });
  fixtures.allowed = false;
  expect(await quota(request)).toBeNull();
  expect(nativeEngineUsage).toHaveBeenCalledTimes(2);
  expect(fixtures.read).not.toHaveBeenCalled();
});

it("says when the owner's PC can sign its CLIs in from here", async () => {
  const getBot = vi.fn().mockResolvedValue({ id: "mico", computer: { kind: "desktop", scope: "dedicated" } });
  const nativeEngineState = vi.fn().mockResolvedValue({ engines: ["codex"], signedOut: ["codex"], account: true });
  const list = routes({ getBot, nativeEngineState }).engines.forBot as unknown as (arg: unknown) => Promise<unknown>;
  const request = { context: { actor: { userId: "user", spaceId: "space" } }, input: { botId: "mico" } };
  expect(await list(request)).toEqual({ computer: "desktop", engines: ["codex"], signedOut: ["codex"], models: {}, account: true });
});

it("signs a CLI in or out only on the owner's own PC and never passes raw diagnostics on", async () => {
  const actor = { userId: "user", spaceId: "space" };
  const getBot = vi.fn().mockResolvedValue({ id: "mico", computer: { kind: "desktop", scope: "dedicated" } });
  const device = { status: "device", userCode: "ABCD-1234", verificationUrl: "https://auth.example.test/device" };
  const nativeEngineAccount = vi.fn().mockResolvedValue(device);
  const account = routes({ getBot, nativeEngineAccount }).engines.account as unknown as (arg: unknown) => Promise<unknown>;
  const signIn = { context: { actor }, input: { botId: "mico", action: "signIn", engine: "codex", flow: "device" } };
  expect(await account(signIn)).toEqual(device);
  expect(getBot).toHaveBeenCalledWith(actor, "mico");
  expect(nativeEngineAccount).toHaveBeenCalledWith(expect.objectContaining({ ...actor, botId: "mico" }),
    { action: "signIn", engine: "codex", flow: "device" });

  nativeEngineAccount.mockRejectedValueOnce(new Error("Claude Code signs in on the PC. Open Mycellios on that PC to sign in."));
  await expect(account(signIn)).rejects.toThrow("Claude Code signs in on the PC.");
  nativeEngineAccount.mockRejectedValueOnce(new Error("Invalid enum value. Expected 'environment' | 'execute', received 'engineAccount'"));
  await expect(account(signIn)).rejects.toThrow("That PC could not sign in. Update Mycellios on it and try again.");
  nativeEngineAccount.mockRejectedValueOnce(new Error("Local computer disconnected. Check the result before retrying."));
  await expect(account(signIn)).rejects.toThrow("Your PC is not connected.");

  for (const computer of [{ kind: "docker", scope: "isolated" }, { kind: "desktop", scope: "isolated" }, null]) {
    getBot.mockResolvedValueOnce({ id: "mico", computer });
    await expect(account({ context: { actor }, input: { botId: "mico", action: "signOut", engine: "claude" } }))
      .rejects.toThrow("This Mico does not run on your PC.");
  }
  expect(nativeEngineAccount).toHaveBeenCalledTimes(4);
});
