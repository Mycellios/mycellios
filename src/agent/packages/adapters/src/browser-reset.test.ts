import { computerScopeKey, legacyTeamHomeKey } from "@rakazo/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

const lifecycle = vi.hoisted(() => ({
  acquire: vi.fn(),
  release: vi.fn(async () => undefined),
}));
const home = vi.hoisted(() => ({ removeFolders: vi.fn(async () => undefined) }));
vi.mock("./computer-lifecycle.js", async () => ({
  acquireComputerExecutionLease: lifecycle.acquire,
  releaseComputerExecutionLease: lifecycle.release,
}));
vi.mock("./home.js", async (original) => ({
  ...(await original<typeof import("./home.js")>()),
  removeAgentHomeFolders: home.removeFolders,
}));

import { BotBrowserBusyError, resetBotBrowser } from "./browser-reset.js";
import { ComputerBusyError } from "./computer-errors.js";
import { teamBrowserProfileName } from "./computer-workspace.js";

const bot = { id: "bot-1", spaceId: "space-1", userId: "user-1", computerId: "team" };
const PROFILE = teamBrowserProfileName(bot.id)!;
const teamKey = computerScopeKey({ mode: "team", spaceId: bot.spaceId, userId: bot.userId });

type Row = { id: string; scope: string; kind: string; homeKey: string; providerRef: string | null; state: string; scopeKey?: string };

function setup(rows: Row[], activeRuns = 0) {
  const calls: string[] = [];
  const prisma = {
    computer: {
      findUnique: vi.fn(async ({ where }: { where: { id?: string; scopeKey?: string; homeKey?: string } }) =>
        rows.find((row) => (where.id ? row.id === where.id : where.scopeKey ? row.scopeKey === where.scopeKey : row.homeKey === where.homeKey)) ?? null),
    },
    run: { count: vi.fn(async () => { calls.push("count runs"); return activeRuns; }) },
  };
  const sandbox = {
    releaseScreen: vi.fn(async (ref: { id: string }, context: { botId?: string; cancelRunWork?: boolean }) => {
      calls.push(`stop browser ${ref.id} for ${context.botId} cancel=${context.cancelRunWork}`);
    }),
    workspaceDirectories: vi.fn(async (ref: { id: string }, request: { parent: string; names: string[] }) => {
      calls.push(`delete ${ref.id} ${request.parent}/${request.names.join(",")}`);
      return [];
    }),
    execute: vi.fn(),
  };
  lifecycle.acquire.mockImplementation(async (_: unknown, { computerId }: { computerId: string }) => {
    calls.push(`lease ${computerId}`);
    return { computerId, botId: bot.id, runId: "r", fence: 1 };
  });
  return { prisma, sandbox, calls, deps: { prisma: prisma as never, sandbox: sandbox as never, home: {} as never } };
}
const context = { operationId: "op", traceId: "op", spaceId: bot.spaceId, userId: bot.userId, botId: bot.id, signal: new AbortController().signal };

beforeEach(() => {
  lifecycle.acquire.mockReset();
  lifecycle.release.mockClear();
  home.removeFolders.mockClear();
});

describe("resetBotBrowser", () => {
  it("holds the lease, checks for work, stops the browser and only then deletes the profile", async () => {
    const { deps, calls } = setup([
      { id: "team", scope: "team", kind: "docker", homeKey: "h-team", providerRef: "c1", state: "running", scopeKey: teamKey },
    ]);
    expect(await resetBotBrowser(deps, bot, context)).toEqual({ computerOff: false });
    expect(calls).toEqual([
      "lease team",
      "count runs",
      "stop browser c1 for bot-1 cancel=true",
      `delete c1 .browser-profiles/${PROFILE}`,
    ]);
    expect(lifecycle.release).toHaveBeenCalledTimes(1);
    expect(home.removeFolders).not.toHaveBeenCalled();
  });

  it("refuses while the Mico works or its computer is busy, and lets the lease go", async () => {
    const working = setup([{ id: "team", scope: "team", kind: "docker", homeKey: "h", providerRef: "c1", state: "running", scopeKey: teamKey }], 1);
    await expect(resetBotBrowser(working.deps, bot, context)).rejects.toBeInstanceOf(BotBrowserBusyError);
    expect(working.sandbox.releaseScreen).not.toHaveBeenCalled();
    expect(lifecycle.release).toHaveBeenCalledTimes(1);

    const busy = setup([{ id: "team", scope: "team", kind: "docker", homeKey: "h", providerRef: "c1", state: "running", scopeKey: teamKey }]);
    lifecycle.acquire.mockRejectedValueOnce(new ComputerBusyError());
    await expect(resetBotBrowser(busy.deps, bot, context)).rejects.toBeInstanceOf(BotBrowserBusyError);
    expect(busy.sandbox.releaseScreen).not.toHaveBeenCalled();
  });

  it("deletes a remote computer's stored copy even when it sleeps, and reports a sleeping local one", async () => {
    const remote = setup([{ id: "team", scope: "team", kind: "e2b", homeKey: "h-e2b", providerRef: null, state: "stopped", scopeKey: teamKey }]);
    expect(await resetBotBrowser(remote.deps, bot, context)).toEqual({ computerOff: false });
    expect(home.removeFolders).toHaveBeenCalledWith({}, "h-e2b", ".browser-profiles", [PROFILE], undefined);
    expect(remote.sandbox.workspaceDirectories).not.toHaveBeenCalled();

    const local = setup([{ id: "team", scope: "team", kind: "docker", homeKey: "h", providerRef: "c1", state: "stopped", scopeKey: teamKey }]);
    expect(await resetBotBrowser(local.deps, bot, context)).toEqual({ computerOff: true });
    expect(local.sandbox.workspaceDirectories).not.toHaveBeenCalled();
  });

  it("covers the legacy Team Computer and never touches the owner's PC", async () => {
    const { deps, calls, sandbox } = setup([
      { id: "pc", scope: "dedicated", kind: "desktop", homeKey: "h-pc", providerRef: "pc", state: "running" },
      { id: "legacy", scope: "team", kind: "docker", homeKey: legacyTeamHomeKey(bot.spaceId), providerRef: "c2", state: "running" },
    ]);
    await resetBotBrowser(deps, { ...bot, computerId: "pc" }, context);
    expect(calls).toContain(`delete c2 .browser-profiles/${PROFILE}`);
    expect(sandbox.releaseScreen.mock.calls.map(([ref]) => ref.id)).toEqual(["c2"]);
  });
});
