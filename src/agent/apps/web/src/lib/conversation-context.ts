import type { ConversationContext } from "@mycellios/contracts";

export type ContextMeterLevel = "ok" | "high" | "full";

/** From this share the meter warns that older messages will soon be summarized. */
export const CONTEXT_HIGH = 0.7;
export const CONTEXT_FULL = 0.9;

export type ContextMeterState = {
  share: number;
  percent: number;
  level: ContextMeterLevel;
  usedTokens: number;
  contextWindow: number;
};

/** Only a known window gives a meaningful share; without one the meter stays hidden. */
export function contextMeterState(context: ConversationContext | null | undefined): ContextMeterState | null {
  if (!context?.contextWindow || context.usedTokens <= 0) return null;
  const share = Math.min(1, context.usedTokens / context.contextWindow);
  return {
    share,
    percent: Math.max(1, Math.round(share * 100)),
    level: share >= CONTEXT_FULL ? "full" : share >= CONTEXT_HIGH ? "high" : "ok",
    usedTokens: context.usedTokens,
    contextWindow: context.contextWindow,
  };
}

/** Refetch once a turn settles: an active run keeps the previous reading. */
export function contextRefreshKey(run: { id: string; status: string } | null | undefined): string {
  if (!run) return "idle";
  return ["queued", "leased", "running"].includes(run.status) ? `active:${run.id}` : `settled:${run.id}`;
}
