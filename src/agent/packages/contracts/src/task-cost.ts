import * as z from "zod";

export const TaskCostSchema = z.object({
  runId: z.string(),
  state: z.enum(["confirmed", "estimated", "pending", "unavailable"]),
  amountUsd: z.number().finite().nonnegative().nullable(),
  modelCalls: z.number().int().nonnegative(),
  unpricedCalls: z.number().int().nonnegative(),
});
export type TaskCost = z.infer<typeof TaskCostSchema>;

export const AgentUsageTotalsSchema = TaskCostSchema.omit({ runId: true }).extend({
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  totalTokens: z.number().int().nonnegative().nullable(),
  knownAmountUsd: z.number().finite().nonnegative(),
  knownInputTokens: z.number().int().nonnegative(),
  knownOutputTokens: z.number().int().nonnegative(),
  knownTotalTokens: z.number().int().nonnegative(),
  estimatedCalls: z.number().int().nonnegative(),
});
export type AgentUsageTotals = z.infer<typeof AgentUsageTotalsSchema>;
export const AgentUsageReportSchema = z.object({
  total: AgentUsageTotalsSchema,
  agents: z.array(AgentUsageTotalsSchema.extend({ botId: z.string().nullable(), name: z.string().nullable(), archived: z.boolean() })),
});
export type AgentUsageReport = z.infer<typeof AgentUsageReportSchema>;
