import type { AdapterContext, ConnectorProvider } from "@mycellios/adapter-kit";
import { connectedContext, selectRunConnections } from "@mycellios/adapters";
import type { PrismaClient } from "@mycellios/db";
import { getLogger } from "@mycellios/logging";

/** Micos whose tools are opened ahead of their first turn. */
export const WARM_TOOLS_MAX_MICOS = 30;
/** Only Micos that ran recently are worth opening: an unused one would only hold a connection. */
export const WARM_TOOLS_RECENT_MS = 24 * 3_600_000;
/** How many Micos are opened at once, so a restart never opens every server together. */
const WARM_TOOLS_CONCURRENCY = 3;
/** Past this a Mico is left to its first turn, as before. */
const WARM_TOOLS_TIMEOUT_MS = 30_000;

type WarmPrisma = Pick<PrismaClient, "run" | "connection">;

/**
 * Right after a restart no tool session is open, so the first turn of every Mico waits for
 * its servers to connect (14-20 s in production, with every scheduled routine arriving at
 * once). Discovering the tools of the Micos that ran in the last day opens the same sessions
 * and fills the same lists a turn would, before one starts. It runs in the background, one
 * failure never stops the others, and a turn that arrives first simply shares the work.
 */
export async function warmToolSessions(
  deps: { prisma: WarmPrisma; connector: Pick<ConnectorProvider, "discoverTools"> },
  options: { now?: number; signal?: AbortSignal } = {},
): Promise<{ warmed: number; failed: number }> {
  const logger = getLogger();
  const startedAt = Date.now();
  const since = new Date((options.now ?? startedAt) - WARM_TOOLS_RECENT_MS);
  let micos: Array<{ botId: string; spaceId: string; userId: string }>;
  try {
    micos = await deps.prisma.run.groupBy({
      by: ["botId", "spaceId", "userId"],
      where: { createdAt: { gte: since } },
      _max: { createdAt: true },
      orderBy: { _max: { createdAt: "desc" } },
      take: WARM_TOOLS_MAX_MICOS,
    });
  } catch {
    logger.warn("worker.tools_warm_skipped", { reason: "recent Micos could not be read" });
    return { warmed: 0, failed: 0 };
  }

  let warmed = 0;
  let failed = 0;
  const queue = [...micos];
  const next = async (): Promise<void> => {
    for (let mico = queue.shift(); mico; mico = queue.shift()) {
      if (options.signal?.aborted) return;
      try {
        const rows = await deps.prisma.connection.findMany({
          where: { userId: mico.userId, spaceId: mico.spaceId },
          select: {
            id: true,
            connectorId: true,
            provider: true,
            providerRef: true,
            displayName: true,
            status: true,
          },
        });
        // Only what a turn would be handed; a connection that is not live is left out.
        const context: AdapterContext = {
          operationId: "worker-warm-tools",
          traceId: "worker-warm-tools",
          spaceId: mico.spaceId,
          userId: mico.userId,
          botId: mico.botId,
          signal: options.signal
            ? AbortSignal.any([options.signal, AbortSignal.timeout(WARM_TOOLS_TIMEOUT_MS)])
            : AbortSignal.timeout(WARM_TOOLS_TIMEOUT_MS),
          ...connectedContext(selectRunConnections(rows, [])),
        };
        await deps.connector.discoverTools(context);
        warmed += 1;
      } catch {
        failed += 1;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(WARM_TOOLS_CONCURRENCY, micos.length) }, next));
  logger.info("worker.tools_warmed", {
    "warm.micos": micos.length,
    "warm.ok": warmed,
    "warm.failed": failed,
    "warm.ms": Date.now() - startedAt,
  });
  return { warmed, failed };
}
