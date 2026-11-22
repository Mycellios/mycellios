import { randomUUID } from "node:crypto";
import type { AdapterContext, AgentHomeStore, SandboxProvider } from "@mycellios/adapter-kit";
import { ACTIVE_RUN_STATUSES } from "@mycellios/core";
import { computerScopeKey, legacyTeamHomeKey, type PrismaClient } from "@mycellios/db";
import { BrowserStoppedReleaseError } from "./computer-screens.js";
import { isBusyError, REMOTE_TEAM_SANDBOX_KINDS, removeProfileOnceClosed } from "./child-bots.js";
import { ComputerBusyError } from "./computer-errors.js";
import {
  acquireComputerExecutionLease,
  type ComputerExecutionLease,
  releaseComputerExecutionLease,
} from "./computer-lifecycle.js";
import { toComputerRef } from "./computer-support.js";
import { teamBrowserProfileName, withCleanupDeadline } from "./computer-workspace.js";
import { removeAgentHomeFolders } from "./home.js";

/** The Mico is working; closing its browser now would break the task. */
export class BotBrowserBusyError extends Error {
  constructor() {
    super("The Mico is working. Try again when it finishes.");
    this.name = "BotBrowserBusyError";
  }
}

export type BotBrowserResetResult = {
  /** Some computer that holds the profile is off and keeps it; start it and reset again. */
  computerOff: boolean;
};

type ResetComputer = {
  id: string;
  scope: string;
  kind: string;
  homeKey: string;
  providerRef: string | null;
  state: string;
};

const RESET_BUDGET_MS = 20_000;

/**
 * Close the Mico's browser and delete its profile (cookies, sessions, saved site data) on every
 * computer it can browse from: its current computer, the cloud computer that stands in for it,
 * and the Team Computers that keep a profile per Mico. The next run starts a signed-out browser.
 * The owner's own PC is never touched.
 * Refuses while the Mico has active work, and holds its Team Computer leases while it deletes.
 */
export async function resetBotBrowser(
  deps: { prisma: PrismaClient; sandbox: SandboxProvider; home: AgentHomeStore; dataDir?: string },
  bot: { id: string; spaceId: string; userId: string; computerId?: string | null },
  context: AdapterContext,
): Promise<BotBrowserResetResult> {
  const name = teamBrowserProfileName(bot.id);
  if (!name) return { computerOff: false };
  const computers = await botBrowserComputers(deps.prisma, bot);
  const leaseRunId = `browser-reset:${randomUUID()}`;
  const leases: ComputerExecutionLease[] = [];
  try {
    // Leases first, then the run check: a run that starts later waits on the lease.
    for (const computer of computers) {
      const lease = await acquireComputerExecutionLease(deps.prisma, {
        computerId: computer.id,
        runId: leaseRunId,
        botId: bot.id,
      }).catch((error: unknown) => {
        if (error instanceof ComputerBusyError) throw new BotBrowserBusyError();
        throw error;
      });
      if (lease) leases.push(lease);
    }
    const working = await deps.prisma.run.count({
      where: { botId: bot.id, status: { in: [...ACTIVE_RUN_STATUSES] } },
    });
    if (working > 0) throw new BotBrowserBusyError();

    let computerOff = false;
    for (const computer of computers) {
      const remote = REMOTE_TEAM_SANDBOX_KINDS.has(computer.kind);
      if (computer.providerRef && computer.state === "running") {
        await closeAndRemoveLiveProfile(deps.sandbox, computer, name, {
          ...context,
          botId: bot.id,
          screenLeaseId: undefined,
        });
      } else if (!remote && computer.id === bot.computerId) {
        // Only the computer itself may delete from a home it mounts; see removeBotFolders.
        // A computer the Mico no longer uses keeps its old profile until it is reset there.
        computerOff = true;
      }
      // Replacement remote computers restore from the stored copy, so delete it there too.
      if (remote)
        await removeAgentHomeFolders(deps.home, computer.homeKey, ".browser-profiles", [name], deps.dataDir);
    }
    return { computerOff };
  } finally {
    for (const lease of leases)
      await releaseComputerExecutionLease(deps.prisma, lease).catch(() => undefined);
  }
}

async function closeAndRemoveLiveProfile(
  sandbox: SandboxProvider,
  computer: ResetComputer,
  name: string,
  context: AdapterContext,
) {
  const ref = toComputerRef(computer);
  // Chromium must be gone first, or it rewrites the profile as it exits.
  try {
    await sandbox.releaseScreen?.(ref, { ...context, cancelRunWork: true });
  } catch (error) {
    if (!(error instanceof BrowserStoppedReleaseError)) throw error;
  }
  await withCleanupDeadline(context, RESET_BUDGET_MS, (cleanupContext) =>
    removeProfileOnceClosed(sandbox, ref, name, cleanupContext),
  ).catch((error: unknown) => {
    if (isBusyError(error)) throw new BotBrowserBusyError();
    throw error;
  });
}

async function botBrowserComputers(
  prisma: PrismaClient,
  bot: { id: string; spaceId: string; userId: string; computerId?: string | null },
): Promise<ResetComputer[]> {
  const dedicatedKey = { mode: "dedicated" as const, spaceId: bot.spaceId, userId: bot.userId, botId: bot.id };
  const teamKey = { mode: "team" as const, spaceId: bot.spaceId, userId: bot.userId };
  const found = await Promise.all([
    bot.computerId ? prisma.computer.findUnique({ where: { id: bot.computerId } }) : null,
    prisma.computer.findUnique({ where: { scopeKey: computerScopeKey(dedicatedKey) } }),
    prisma.computer.findUnique({
      where: { scopeKey: computerScopeKey({ ...dedicatedKey, cloudFallback: true }) },
    }),
    prisma.computer.findUnique({ where: { scopeKey: computerScopeKey(teamKey) } }),
    prisma.computer.findUnique({
      where: { scopeKey: computerScopeKey({ ...teamKey, cloudFallback: true }) },
    }),
    prisma.computer.findUnique({ where: { homeKey: legacyTeamHomeKey(bot.spaceId) } }),
  ]);
  const unique = new Map<string, ResetComputer>();
  // On the owner's PC the Mico uses the PC's own browser, which only the owner manages.
  for (const computer of found)
    if (computer && computer.kind !== "desktop") unique.set(computer.id, computer);
  return [...unique.values()];
}
