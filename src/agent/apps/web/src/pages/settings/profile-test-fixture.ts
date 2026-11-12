import type { UsageDashboard, UsageDashboardTotals } from "@rakazo/contracts";
export const profileTotals = (tokens = 0): UsageDashboardTotals => ({ calls: tokens ? 1 : 0, pricedCalls: tokens ? 1 : 0, estimatedCalls: 0, pendingCalls: 0, incompleteCalls: 0,
  knownUsd: 0, confirmedUsd: 0, estimatedUsd: 0, costUsd: 0, input: tokens, output: 0, cacheRead: 0, cacheWrite: 0, tokens, processed: tokens, knownTokens: tokens, knownProcessed: tokens });
export function profileReport(): UsageDashboard {
  return { from: "2025-11-13T00:00:00Z", to: "2026-11-13T00:00:00Z", timeZone: "UTC", updatedAt: "2026-11-12T12:00:00Z", totals: profileTotals(100), agents: [],
    byAgent: [{ id: "b", botId: "b", name: "Mico", ...profileTotals(100) }], byModel: [{ id: "m", name: "Model", model: "Model", provider: "openai", ...profileTotals(100) }], byProvider: [{ id: "openai", name: "openai", ...profileTotals(100) }],
    daily: [{ id: "2026-11-12", name: "2026-11-12", ...profileTotals(100) }], providerDaily: [], sessions: 1, userMessages: 14, assistantMessages: 2, missingRuns: 0, activeRuns: 0, missingRunDays: [], unattributedCalls: 0, unmappedCalls: 0, collectionStartedAt: null };
}
