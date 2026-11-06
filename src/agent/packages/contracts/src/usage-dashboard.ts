import * as z from "zod";
import { TimeZoneSchema } from "./domain.js";
import { Id, IsoDate } from "./ids.js";

export const UsageDashboardInputSchema = z
  .object({
    from: IsoDate,
    to: IsoDate,
    timeZone: TimeZoneSchema,
    botId: Id.nullable().optional(),
  })
  .refine(
    (value) =>
      Date.parse(value.to) > Date.parse(value.from) &&
      Date.parse(value.to) - Date.parse(value.from) <= 367 * 86_400_000,
    "Choose a usage range of at most one year.",
  );
const amount = z.number().finite().nonnegative();
const count = amount.int();
export const UsageDashboardTotalsSchema = z.object({
  calls: count,
  pricedCalls: count,
  estimatedCalls: count,
  pendingCalls: count,
  incompleteCalls: count,
  knownUsd: amount,
  confirmedUsd: amount,
  estimatedUsd: amount,
  costUsd: amount.nullable(),
  input: count.nullable(),
  output: count.nullable(),
  cacheRead: count.nullable(),
  cacheWrite: count.nullable(),
  tokens: count.nullable(),
  processed: count.nullable(),
  knownTokens: count,
  knownProcessed: count,
});
export type UsageDashboardTotals = z.infer<typeof UsageDashboardTotalsSchema>;
const row = UsageDashboardTotalsSchema.extend({ id: z.string(), name: z.string() });
export const UsageDashboardSchema = z.object({
  from: IsoDate,
  to: IsoDate,
  timeZone: TimeZoneSchema,
  updatedAt: IsoDate,
  totals: UsageDashboardTotalsSchema,
  agents: z.array(
    z.object({
      id: Id.nullable(),
      name: z.string().nullable(),
      archived: z.boolean(),
      deleted: z.boolean(),
    }),
  ),
  byAgent: z.array(row.extend({ botId: Id.nullable() })),
  byModel: z.array(row.extend({ provider: z.string(), model: z.string() })),
  byProvider: z.array(row),
  daily: z.array(row),
  providerDaily: z.array(row.extend({ provider: z.string(), day: z.string() })),
  sessions: count,
  userMessages: count,
  assistantMessages: count,
  missingRuns: count,
  activeRuns: count,
  missingRunDays: z.array(z.string()),
  unattributedCalls: count,
  unmappedCalls: count,
  collectionStartedAt: IsoDate.nullable(),
});
export type UsageDashboard = z.infer<typeof UsageDashboardSchema>;
