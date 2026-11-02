import type { Actor, AgentUsageTotals, AgentUsageReport } from "@rakazo/contracts";
import type { RouterDeps } from "./router.js";

/** Account-scoped lifetime totals: aggregate records once rather than summing nested task totals. */
export async function agentUsage(deps: RouterDeps, actor: Actor): Promise<AgentUsageReport> {
  const scope = { userId: actor.userId, spaceId: actor.spaceId };
  const priced = { ...scope, costUsd: { not: null }, OR: [
    { costSource: { in: ["provider-reported", "pi-catalog-estimate"] } },
    { costUsd: 0, usageSource: { in: ["provider-rejected", "not-started"] } },
  ] };
  const [bots, all, known, estimates, pending, active] = await Promise.all([
    deps.prisma.bot.findMany({ where: scope, select: { id: true, name: true, archivedAt: true }, orderBy: { name: "asc" } }),
    deps.prisma.usageRecord.groupBy({ by: ["botId"], where: scope,
      _sum: { inputTokens: true, outputTokens: true, totalTokens: true },
      _count: { id: true, inputTokens: true, outputTokens: true, totalTokens: true } }),
    deps.prisma.usageRecord.groupBy({ by: ["botId"], where: priced, _sum: { costUsd: true }, _count: { id: true } }),
    deps.prisma.usageRecord.groupBy({ by: ["botId"], where: { ...priced, costSource: "pi-catalog-estimate" }, _count: { id: true } }),
    deps.prisma.usageRecord.groupBy({ by: ["botId"], where: { ...scope, costUsd: null,
      pricingSnapshot: { path: ["antseedReceiptState"], equals: "pending" } }, _count: { id: true } }),
    deps.prisma.run.groupBy({ by: ["botId"], where: { ...scope, status: { notIn: ["completed", "failed", "cancelled"] } }, _count: { id: true } }),
  ]);
  const totals = new Map(all.map(row => [row.botId, row]));
  const prices = new Map(known.map(row => [row.botId, row]));
  const estimated = new Map(estimates.map(row => [row.botId, row._count.id]));
  const waiting = new Set([...pending, ...active].filter(row => row._count.id > 0).map(row => row.botId));
  const identities = new Map(bots.map(bot => [bot.id, bot]));
  const ids = new Set<string | null>([...bots.map(bot => bot.id), ...all.map(row => row.botId), ...active.map(row => row.botId)]);
  const agents = [...ids].map(botId => {
    const row = totals.get(botId), price = prices.get(botId), bot = botId ? identities.get(botId) : null;
    const calls = row?._count.id ?? 0, pricedCalls = price?._count.id ?? 0;
    const amount = price?._sum.costUsd ?? 0;
    const unpricedCalls = Math.max(0, calls - pricedCalls);
    const estimatedCalls = estimated.get(botId) ?? 0;
    const complete = unpricedCalls === 0 && Number.isFinite(amount) && amount >= 0;
    const state: AgentUsageTotals["state"] = waiting.has(botId) ? "pending" : !complete ? "unavailable" : estimatedCalls ? "estimated" : "confirmed";
    const tokens = (key: "inputTokens" | "outputTokens" | "totalTokens") =>
      !row ? 0 : row._count[key] === calls ? row._sum[key] ?? 0 : null;
    return { botId, name: bot?.name ?? null, archived: !!bot?.archivedAt,
      inputTokens: tokens("inputTokens"), outputTokens: tokens("outputTokens"), totalTokens: tokens("totalTokens"),
      knownInputTokens: row?._sum.inputTokens ?? 0, knownOutputTokens: row?._sum.outputTokens ?? 0, knownTotalTokens: row?._sum.totalTokens ?? 0,
      amountUsd: complete && state !== "pending" ? Number(amount.toPrecision(12)) : null,
      knownAmountUsd: Number.isFinite(amount) && amount >= 0 ? Number(amount.toPrecision(12)) : 0,
      state, modelCalls: calls, unpricedCalls, estimatedCalls };
  });
  const sum = (key: "inputTokens" | "outputTokens" | "totalTokens" | "amountUsd") =>
    agents.every(row => row[key] !== null) ? agents.reduce((total, row) => total + row[key]!, 0) : null;
  const total: AgentUsageTotals = {
    inputTokens: sum("inputTokens"), outputTokens: sum("outputTokens"), totalTokens: sum("totalTokens"), amountUsd: sum("amountUsd"),
    knownInputTokens: agents.reduce((n, row) => n + row.knownInputTokens, 0),
    knownOutputTokens: agents.reduce((n, row) => n + row.knownOutputTokens, 0),
    knownTotalTokens: agents.reduce((n, row) => n + row.knownTotalTokens, 0),
    knownAmountUsd: agents.reduce((n, row) => n + row.knownAmountUsd, 0),
    state: agents.some(row => row.state === "pending") ? "pending" : agents.some(row => row.state === "unavailable") ? "unavailable" : agents.some(row => row.state === "estimated") ? "estimated" : "confirmed",
    modelCalls: agents.reduce((n, row) => n + row.modelCalls, 0),
    unpricedCalls: agents.reduce((n, row) => n + row.unpricedCalls, 0),
    estimatedCalls: agents.reduce((n, row) => n + row.estimatedCalls, 0),
  };
  return { agents, total };
}
