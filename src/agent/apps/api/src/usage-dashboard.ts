import { ORPCError } from "@orpc/server";
import type { Actor, UsageDashboard, UsageDashboardTotals } from "@rakazo/contracts";
import { Prisma, type PrismaClient } from "@rakazo/db";

// These SQL expressions use only canonical UsageRecord buckets. The one-hour
// write bucket and reasoning tokens are subsets, so neither is added again.
const TOKEN_EXPRESSIONS = {
  input: '"inputTokens"',
  output: '"outputTokens"',
  cacheRead: '"cacheReadTokens"',
  cacheWrite: '"cacheWriteTokens"',
  tokens: '("inputTokens"::bigint + "outputTokens" + "cacheWriteTokens")',
  processed:
    'COALESCE("totalTokens"::bigint, "inputTokens"::bigint + "outputTokens" + "cacheWriteTokens" + "cacheReadTokens")',
} as const;
type Metric = keyof typeof TOKEN_EXPRESSIONS;
export type UsageBucket = UsageDashboardTotals & {
  day: string;
  botId: string | null;
  provider: string;
  model: string;
};
type SqlBucket = Omit<UsageBucket, Metric> &
  Record<Metric, number> &
  Record<`${Metric}Count`, number>;

export function emptyUsageTotals(): UsageDashboardTotals {
  return {
    calls: 0,
    pricedCalls: 0,
    estimatedCalls: 0,
    pendingCalls: 0,
    incompleteCalls: 0,
    costUsd: 0,
    knownUsd: 0,
    confirmedUsd: 0,
    estimatedUsd: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    tokens: 0,
    processed: 0,
    knownTokens: 0,
    knownProcessed: 0,
  };
}
export function mergeUsageTotals(rows: UsageDashboardTotals[]): UsageDashboardTotals {
  const total = emptyUsageTotals();
  for (const item of rows) {
    for (const key of [
      "calls",
      "pricedCalls",
      "estimatedCalls",
      "pendingCalls",
      "incompleteCalls",
      "knownUsd",
      "confirmedUsd",
      "estimatedUsd",
      "knownTokens",
      "knownProcessed",
    ] as const)
      total[key] += item[key];
    for (const key of ["costUsd", ...Object.keys(TOKEN_EXPRESSIONS)] as Array<Metric | "costUsd">)
      total[key] = total[key] === null || item[key] === null ? null : total[key]! + item[key]!;
  }
  total.knownUsd = Number(total.knownUsd.toPrecision(12));
  if (total.costUsd !== null) total.costUsd = Number(total.costUsd.toPrecision(12));
  return total;
}
export function normalizeUsageBucket(row: SqlBucket): UsageBucket {
  const result: UsageBucket = {
    ...row,
    knownTokens: row.input + row.output + row.cacheWrite,
    knownProcessed: row.processed,
    costUsd: row.pricedCalls === row.calls ? row.knownUsd : null,
  };
  for (const key of Object.keys(TOKEN_EXPRESSIONS) as Metric[])
    result[key] = row[`${key}Count`] === row.calls ? row[key] : null;
  return result;
}

export async function usageDashboard(
  prisma: PrismaClient,
  actor: Actor,
  input: { from: string; to: string; timeZone: string; botId?: string | null },
): Promise<UsageDashboard> {
  const from = new Date(input.from),
    to = new Date(input.to),
    scope = { userId: actor.userId, spaceId: actor.spaceId };
  const botFilter =
    input.botId === undefined
      ? Prisma.empty
      : input.botId === null
        ? Prisma.sql`AND u."botId" IS NULL`
        : Prisma.sql`AND u."botId" = ${input.botId}`;
  const runBotFilter =
    input.botId === undefined
      ? Prisma.empty
      : input.botId === null
        ? Prisma.sql`AND FALSE`
        : Prisma.sql`AND r."botId" = ${input.botId}`;
  const where = Prisma.sql`u."userId" = ${actor.userId} AND u."spaceId" = ${actor.spaceId} AND u."createdAt" >= ${from} AND u."createdAt" < ${to} ${botFilter}`;
  const knownCost = Prisma.sql`("costUsd" >= 0 AND "costUsd" < 'Infinity'::float8 AND lower(currency)='usd' AND ("costSource" IN ('provider-reported','pi-catalog-estimate') OR ("costUsd"=0 AND "usageSource" IN ('provider-rejected','not-started'))))`;
  const tokens = Object.entries(TOKEN_EXPRESSIONS).map(([key, expression]) => {
    const sql = Prisma.raw(expression);
    const valid =
      key === "tokens"
        ? Prisma.sql`"inputTokens">=0 AND "outputTokens">=0 AND "cacheWriteTokens">=0`
        : key === "processed"
          ? Prisma.sql`("totalTokens">=0 OR ("totalTokens" IS NULL AND "inputTokens">=0 AND "outputTokens">=0 AND "cacheWriteTokens">=0 AND "cacheReadTokens">=0))`
          : Prisma.sql`${sql}>=0`;
    return Prisma.sql`COALESCE(SUM(${sql}) FILTER (WHERE ${valid}),0)::float8 AS ${Prisma.raw(`"${key}"`)}, COUNT(*) FILTER (WHERE ${valid})::int AS ${Prisma.raw(`"${key}Count"`)}`;
  });
  const [bots, attributed, raw, coverage] = await Promise.all([
    prisma.bot.findMany({
      where: scope,
      select: { id: true, name: true, archivedAt: true },
      orderBy: { name: "asc" },
    }),
    prisma.usageRecord.groupBy({ by: ["botId"], where: scope }),
    prisma.$queryRaw<SqlBucket[]>(Prisma.sql`
      WITH selected AS (SELECT u.* FROM usage_records u WHERE ${where})
      SELECT to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${input.timeZone}, 'YYYY-MM-DD') AS day, "botId", provider, model,
        COUNT(*)::int AS calls,
        COUNT(*) FILTER (WHERE ${knownCost})::int AS "pricedCalls",
        COUNT(*) FILTER (WHERE ${knownCost} AND "costSource"='pi-catalog-estimate')::int AS "estimatedCalls",
        COUNT(*) FILTER (WHERE NOT COALESCE(${knownCost},false) AND "pricingSnapshot"->>'antseedReceiptState'='pending')::int AS "pendingCalls",
        COUNT(*) FILTER (WHERE "inputTokens" IS NULL OR "inputTokens"<0 OR "outputTokens" IS NULL OR "outputTokens"<0 OR "cacheReadTokens" IS NULL OR "cacheReadTokens"<0 OR "cacheWriteTokens" IS NULL OR "cacheWriteTokens"<0)::int AS "incompleteCalls",
        COALESCE(SUM("costUsd") FILTER (WHERE ${knownCost}),0)::float8 AS "knownUsd",
        COALESCE(SUM("costUsd") FILTER (WHERE ${knownCost} AND "costSource"='pi-catalog-estimate'),0)::float8 AS "estimatedUsd",
        COALESCE(SUM("costUsd") FILTER (WHERE ${knownCost} AND "costSource" IS DISTINCT FROM 'pi-catalog-estimate'),0)::float8 AS "confirmedUsd",
        ${Prisma.join(tokens, ",")}
      FROM selected GROUP BY day, "botId", provider, model ORDER BY day, provider, model, "botId"
    `),
    prisma.$queryRaw<
      Array<{
        sessions: number;
        missingRuns: number;
        activeRuns: number;
        userMessages: number;
        assistantMessages: number;
        missingRunDays: string[];
        unmappedCalls: number;
      }>
    >(Prisma.sql`
      WITH selected AS (SELECT u."runId" FROM usage_records u WHERE ${where}),
      cohort AS (
        SELECT r.id, r."threadId", r."sourceMessageId", r."createdAt", r.status,
          NOT EXISTS (SELECT 1 FROM usage_records x WHERE x."runId"=r.id AND x."userId"=${actor.userId} AND x."spaceId"=${actor.spaceId}) AS missing
        FROM runs r WHERE r."userId"=${actor.userId} AND r."spaceId"=${actor.spaceId}
          AND ((r."createdAt">=${from} AND r."createdAt"<${to} ${runBotFilter}) OR r.id IN (SELECT "runId" FROM selected))
      ), message_counts AS (
        SELECT COUNT(DISTINCT m.id) FILTER (WHERE m.role='user')::int AS users,
          COUNT(DISTINCT m.id) FILTER (WHERE m.role='bot')::int AS assistants
        FROM messages m INNER JOIN threads t ON t.id=m."threadId"
        WHERE t."userId"=${actor.userId} AND t."spaceId"=${actor.spaceId}
          AND m."createdAt">=${from} AND m."createdAt"<${to}
          AND EXISTS (SELECT 1 FROM cohort r WHERE m."runId"=r.id OR m.id=r."sourceMessageId")
      )
      SELECT COUNT(DISTINCT "threadId")::int AS sessions,
        COUNT(*) FILTER (WHERE missing)::int AS "missingRuns",
        COUNT(*) FILTER (WHERE status NOT IN ('completed','failed','cancelled'))::int AS "activeRuns",
        COALESCE(array_agg(DISTINCT to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${input.timeZone},'YYYY-MM-DD')) FILTER (WHERE missing),ARRAY[]::text[]) AS "missingRunDays",
        (SELECT users FROM message_counts) AS "userMessages", (SELECT assistants FROM message_counts) AS "assistantMessages",
        (SELECT COUNT(*)::int FROM selected s WHERE NOT EXISTS (SELECT 1 FROM runs r WHERE r.id=s."runId" AND r."userId"=${actor.userId} AND r."spaceId"=${actor.spaceId})) AS "unmappedCalls" FROM cohort
    `),
  ]);
  const ids = attributed.flatMap((row) => (row.botId ? [row.botId] : []));
  const deleted = ids.length
    ? await prisma.botDeletion.findMany({
        where: { spaceId: actor.spaceId, id: { in: ids } },
        select: { id: true, name: true },
      })
    : [];
  const agents: UsageDashboard["agents"] = bots.map((bot) => ({
    id: bot.id,
    name: bot.name,
    archived: !!bot.archivedAt,
    deleted: false,
  }));
  for (const { botId } of attributed)
    if (!agents.some((bot) => bot.id === botId))
      agents.push({
        id: botId,
        name: deleted.find((bot) => bot.id === botId)?.name ?? null,
        archived: false,
        deleted: deleted.some((bot) => bot.id === botId),
      });
  if (input.botId !== undefined && !agents.some((bot) => bot.id === input.botId))
    throw new ORPCError("NOT_FOUND");
  const buckets = raw.map(normalizeUsageBucket);
  function aggregate(key: (row: UsageBucket) => string) {
    const groups = new Map<string, UsageBucket[]>();
    for (const row of buckets) {
      const id = key(row);
      const list = groups.get(id) ?? [];
      list.push(row);
      groups.set(id, list);
    }
    return [...groups].map(([id, values]) => ({ id, name: id, ...mergeUsageTotals(values) }));
  }
  const byAgent = aggregate((row) => row.botId ?? "unassigned").map((row) => {
    const botId = row.id === "unassigned" ? null : row.id;
    return { ...row, botId, name: agents.find((bot) => bot.id === botId)?.name ?? "" };
  });
  const byModel = aggregate((row) => JSON.stringify([row.provider, row.model])).map((row) => {
    const [provider, model] = JSON.parse(row.id) as [string, string];
    return { ...row, name: model, provider, model };
  });
  const providerDaily = aggregate((row) => JSON.stringify([row.day, row.provider])).map((row) => {
    const [day, provider] = JSON.parse(row.id) as [string, string];
    return { ...row, name: provider, day, provider };
  });
  const meta = coverage[0] ?? {
    sessions: 0,
    missingRuns: 0,
    activeRuns: 0,
    userMessages: 0,
    assistantMessages: 0,
    missingRunDays: [],
    unmappedCalls: 0,
  };
  const totals = mergeUsageTotals(buckets);
  if (meta.missingRuns > 0)
    for (const key of ["costUsd", ...Object.keys(TOKEN_EXPRESSIONS)] as Array<Metric | "costUsd">)
      totals[key] = null;
  const earliest = await prisma.usageRecord.aggregate({ where: scope, _min: { createdAt: true } });
  return {
    from: input.from,
    to: input.to,
    timeZone: input.timeZone,
    updatedAt: new Date().toISOString(),
    agents,
    totals,
    byAgent,
    byModel,
    byProvider: aggregate((row) => row.provider),
    daily: aggregate((row) => row.day),
    providerDaily,
    ...meta,
    unattributedCalls: buckets
      .filter((row) => row.botId === null)
      .reduce((total, row) => total + row.calls, 0),
    collectionStartedAt: earliest._min.createdAt?.toISOString() ?? null,
  };
}
