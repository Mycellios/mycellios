import { ORPCError } from "@orpc/server";
import type { Actor, TaskCost } from "@rakazo/contracts";
import type { RouterDeps } from "./router.js";

/** All recorded calls attributed to this agent, never a capped recent-usage page. */
export async function agentCost(deps: RouterDeps, actor: Actor, botId: string) {
  const scope = { userId: actor.userId, spaceId: actor.spaceId, botId };
  const bot = await deps.prisma.bot.findFirst({
    where: { id: botId, userId: actor.userId, spaceId: actor.spaceId }, select: { id: true },
  });
  if (!bot) throw new ORPCError("NOT_FOUND");
  const priced = { ...scope, costUsd: { not: null }, OR: [
    { costSource: { in: ["provider-reported", "pi-catalog-estimate"] } },
    { costUsd: 0, usageSource: { in: ["provider-rejected", "not-started"] } },
  ] };
  const [all, known, estimated, pending, active] = await Promise.all([
    deps.prisma.usageRecord.count({ where: scope }),
    deps.prisma.usageRecord.aggregate({ where: priced, _sum: { costUsd: true }, _count: { id: true } }),
    deps.prisma.usageRecord.count({ where: { ...priced, costSource: "pi-catalog-estimate" } }),
    deps.prisma.usageRecord.count({ where: { ...scope, costUsd: null,
      pricingSnapshot: { path: ["antseedReceiptState"], equals: "pending" } } }),
    deps.prisma.run.count({ where: { ...scope, status: { notIn: ["completed", "failed", "cancelled"] } } }),
  ]);
  const amount = known._sum.costUsd ?? 0;
  const complete = all === known._count.id && Number.isFinite(amount) && amount >= 0;
  const state: TaskCost["state"] = active || pending ? "pending" : !complete ? "unavailable" : estimated ? "estimated" : "confirmed";
  return { botId, state, amountUsd: complete && !active && !pending ? amount : null,
    modelCalls: all, unpricedCalls: Math.max(0, all - known._count.id) };
}
