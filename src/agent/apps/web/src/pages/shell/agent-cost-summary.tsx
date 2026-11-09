import { Trans, useLingui } from "@lingui/react/macro";
import { formatTaskCostAmount } from "@rakazo/core";
import { useEffect, useState } from "react";
import { rpc } from "../../lib/rpc";

type AgentCost = Awaited<ReturnType<typeof rpc.usage.agent>>;

export function AgentCostSummary({ botId }: { botId: string }) {
  const { t, i18n } = useLingui();
  const [result, setResult] = useState<{ botId: string; cost: AgentCost | null }>();
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const cost = await rpc.usage.agent({ botId });
        if (!cancelled) setResult({ botId, cost });
      } catch {
        if (!cancelled) setResult({ botId, cost: null });
      }
      if (!cancelled) timer = setTimeout(refresh, 10000);
    }
    void refresh();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [botId]);
  const loaded = result?.botId === botId;
  const cost = loaded ? result.cost : null;
  const amount = cost?.amountUsd == null ? null : formatTaskCostAmount(cost.amountUsd, i18n.locale);
  const compact = (value: number | null | undefined) =>
    value == null ? null : new Intl.NumberFormat(i18n.locale, {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(value);
  const last = cost?.lastCall ?? null;
  return <section className="my-6" data-testid="agent-cost-summary"
    title={t`Includes model calls attributed to this agent. Gas and external services are separate.`}>
    <h3 className="mb-2 text-xs font-medium text-muted-foreground"><Trans>Total AI cost</Trans></h3>
    <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-2 rounded-xl bg-muted/50 p-4"
      data-cost-state={cost?.state ?? (loaded ? "unavailable" : "loading")}>
      <span className="text-sm tabular-nums">{amount ?? (!loaded ? "…" : cost?.state === "pending" ? t`AI cost pending` : t`AI cost unavailable`)}</span>
      {cost?.state === "estimated" ? <span className="text-xs text-muted-foreground"><Trans>Estimated AI cost</Trans></span>
       : null}
    </div>
    {last ? (
      <p className="mt-2 text-xs text-muted-foreground" data-testid="agent-last-call">
        <Trans>Last model call</Trans>: {compact(last.totalTokens ?? last.inputTokens) ?? "—"}{" "}
        <Trans>context</Trans>
        {last.cacheReadTokens ? <> · {compact(last.cacheReadTokens)} <Trans>cached</Trans></> : null}
      </p>
    ) : null}
  </section>;
}
