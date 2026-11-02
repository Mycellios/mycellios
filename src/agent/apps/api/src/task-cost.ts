import { parseModelSecret, readAntSeedCost } from "@rakazo/adapters";
import type { Actor, TaskCost } from "@rakazo/contracts";
import { summarizeTaskCost } from "@rakazo/core";
import { findModelCredential, recordUsage } from "@rakazo/db";
import type { RouterDeps } from "./router.js";

export async function taskCosts(
  deps: RouterDeps,
  actor: Actor,
  requested: string[],
): Promise<TaskCost[]> {
  const scope = { userId: actor.userId, spaceId: actor.spaceId };
  const runs = await deps.prisma.run.findMany({
    where: { ...scope, id: { in: [...new Set(requested)] } },
    select: { id: true, status: true },
  });
  if (!runs.length) return [];
  const discovered = new Set(runs.map((r) => r.id));
  let frontier = [...discovered];
  const rows = new Map<
    string,
    Awaited<ReturnType<typeof deps.prisma.usageRecord.findMany>>[number]
  >();
  let truncated = false;
  while (frontier.length) {
    const loaded = await deps.prisma.usageRecord.findMany({
      where: { ...scope, OR: [{ runId: { in: frontier } }, { parentRunId: { in: frontier } }] },
      take: 2001,
    });
    if (loaded.length > 2000) {
      truncated = true;
      break;
    }
    frontier = [];
    for (const row of loaded) {
      rows.set(row.id, row);
      if (row.runId && !discovered.has(row.runId)) {
        discovered.add(row.runId);
        frontier.push(row.runId);
      }
    }
    if (discovered.size > 1000 || rows.size > 5000) {
      truncated = true;
      break;
    }
  }
  // Settle only exact call IDs; never estimate from a key's shared spend counter.
  let lookups = 0;
  for (const row of rows.values()) {
    if (row.provider !== "antseed" || row.costUsd !== null || !row.callId || lookups >= 2) continue;
    const snapshot =
      row.pricingSnapshot &&
      typeof row.pricingSnapshot === "object" &&
      !Array.isArray(row.pricingSnapshot)
        ? row.pricingSnapshot
        : {};
    if (snapshot.antseedCallId !== row.callId) continue;
    lookups++;
    try {
      const credential = await findModelCredential(deps.prisma, actor, "antseed", row.model);
      if (!credential) continue;
      const stored = await deps.prisma.secret.findFirst({
        where: { id: credential.secretId, userId: actor.userId, spaceId: null },
        select: { ciphertext: true },
      });
      if (!stored) continue;
      const secret = parseModelSecret(
        await deps.secrets.load(stored.ciphertext, credential.secretId),
      );
      if (secret.kind !== "openai_compatible" || !secret.apiKey) continue;
      const cost = await readAntSeedCost({
        baseUrl: secret.baseUrl,
        apiKey: secret.apiKey,
        callId: row.callId,
        allowPrivate: deps.env.mcpAllowPrivateEndpoint === true,
        fetch: deps.modelConnectionFetch,
      });
      if (cost.costUsd === null) continue;
      const event = {
        type: "usage" as const,
        provider: row.provider,
        model: row.model,
        callId: row.callId,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        cacheReadTokens: row.cacheReadTokens,
        cacheWriteTokens: row.cacheWriteTokens,
        cacheWrite1hTokens: row.cacheWrite1hTokens,
        reasoningTokens: row.reasoningTokens,
        totalTokens: row.totalTokens,
        costUsd: cost.costUsd,
        costSource: "provider-reported",
        usageSource: row.usageSource,
        pricingSnapshot: {
          ...snapshot,
          antseedReceiptState: "confirmed",
          antseedReceiptTags: cost.tags,
        },
      };
      const entry = await deps.prisma.modelCreditEntry.findFirst({
        where: { ...scope, callId: row.callId },
        select: { id: true },
      });
      if (entry)
        await recordUsage(
          deps.prisma,
          event,
          {
            ...scope,
            botId: row.botId ?? undefined,
            runId: row.runId ?? undefined,
            parentRunId: row.parentRunId ?? undefined,
          },
          true,
        );
      else
        await deps.prisma.usageRecord.updateMany({
          where: { ...scope, id: row.id, costUsd: null },
          data: {
            costUsd: cost.costUsd,
            costSource: "provider-reported",
            pricingSnapshot: event.pricingSnapshot,
          },
        });
      row.costUsd = cost.costUsd;
      row.costSource = "provider-reported";
    } catch {
      /* Receipts being unavailable must not fabricate a free task. */
    }
  }
  return runs.map((run) => {
    const summary = summarizeTaskCost(
      run.id,
      run.status,
      [...rows.values()].map((row) => ({
        ...row,
        costPending:
          row.costUsd === null &&
          row.pricingSnapshot !== null &&
          typeof row.pricingSnapshot === "object" &&
          !Array.isArray(row.pricingSnapshot) &&
          row.pricingSnapshot.antseedReceiptState === "pending",
      })),
    );
    if (truncated) return { ...summary, state: "unavailable", amountUsd: null };
    return summary;
  });
}
