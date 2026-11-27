import { useLingui } from "@lingui/react/macro";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { contextMeterState } from "../lib/conversation-context";
import type { RpcClient } from "../lib/rpc";
import { IconTooltip } from "./IconTooltip";

const RADIUS = 6;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * How full this conversation was at its latest answer, as a small ring beside the model
 * picker. It reads the recorded usage of that model call; nothing is estimated, and it
 * stays hidden when the model's context window is unknown.
 */
export function ConversationContextMeter({ rpc, scope, botId, taskThreadId, refreshKey }: {
  rpc: RpcClient;
  scope: string;
  botId: string;
  taskThreadId?: string;
  refreshKey: string;
}) {
  const { t, i18n } = useLingui();
  const query = useQuery({
    queryKey: ["conversation-context", scope, botId, taskThreadId ?? null, refreshKey],
    queryFn: ({ signal }) =>
      rpc.usage.threadContext({ botId, ...(taskThreadId ? { taskThreadId } : {}) }, { signal }),
    staleTime: 60_000,
    refetchOnMount: true,
    placeholderData: keepPreviousData,
    retry: false,
  });
  const state = contextMeterState(query.data);
  if (!state) return null;
  const compact = new Intl.NumberFormat(i18n.locale, { notation: "compact", maximumFractionDigits: 1 });
  const used = compact.format(state.usedTokens);
  const total = compact.format(state.contextWindow);
  const percent = state.percent;
  const label = state.level === "ok"
    ? t`Context ${percent}% full: ${used} of ${total} tokens.`
    : t`Context ${percent}% full: ${used} of ${total} tokens. Older messages are summarized automatically when it fills up.`;
  const color = state.level === "full" ? "text-destructive" : state.level === "high" ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground";
  return (
    <IconTooltip label={label}>
      <span role="img" tabIndex={0} aria-label={label} data-testid="conversation-context"
        className={`inline-flex h-7 shrink-0 items-center gap-1 px-1 text-xs tabular-nums ${color}`}>
        <svg viewBox="0 0 16 16" className="size-4 -rotate-90" aria-hidden="true">
          <circle cx="8" cy="8" r={RADIUS} fill="none" stroke="currentColor" strokeOpacity={0.25} strokeWidth="2" />
          <circle cx="8" cy="8" r={RADIUS} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE} strokeDashoffset={CIRCUMFERENCE * (1 - state.share)} />
        </svg>
        {percent}%
      </span>
    </IconTooltip>
  );
}
