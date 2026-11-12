import { Trans, useLingui } from "@lingui/react/macro";
import type { AgentUsageReport, AgentUsageTotals } from "@rakazo/contracts";
import { formatTaskCostAmount } from "@rakazo/core";
import { Button, Label, Switch } from "@rakazo/ui-web";
import type { RefObject } from "react";
import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { SettingsGroup, SettingsLabel, SettingsRow } from "../components/SettingsRows";
import { getResponseCostVisible, setResponseCostVisible, subscribeResponseCost } from "../lib/response-cost-preference";
import { useSpaceRpc } from "../lib/space-rpc";
import type { RpcClient } from "../lib/rpc";

export function UsageMetrics({ value }: { value: AgentUsageTotals }) {
  const { t, i18n } = useLingui();
  const count = (n: number | null) => n === null ? "—" : new Intl.NumberFormat(i18n.locale).format(n);
  const partial = value.amountUsd === null && value.modelCalls > value.unpricedCalls;
  const amount = value.amountUsd ?? (partial ? value.knownAmountUsd : null);
  return <dl className="grid min-w-0 grid-cols-2 gap-4 sm:grid-cols-4">
    {[{label:t`Input tokens`,value:count(value.inputTokens ?? (value.knownInputTokens || null)),partial:value.inputTokens===null&&value.knownInputTokens>0}, {label:t`Output tokens`,value:count(value.outputTokens ?? (value.knownOutputTokens || null)),partial:value.outputTokens===null&&value.knownOutputTokens>0}, {label:t`Total tokens`,value:count(value.totalTokens ?? (value.knownTotalTokens || null)),partial:value.totalTokens===null&&value.knownTotalTokens>0}].map(stat =>
      <div key={stat.label} className="min-w-0"><dt className="text-xs text-muted-foreground">{stat.label}</dt><dd className="mt-1 break-words text-base tabular-nums">{stat.value}</dd>{stat.partial ? <p className="mt-1 text-xs text-muted-foreground"><Trans>Partial</Trans></p> : null}</div>)}
    <div className="min-w-0" data-cost-state={value.state}>
      <dt className="text-xs text-muted-foreground"><SettingsLabel name={t`AI cost`} help={t`Reported or estimated model cost. This is separate from your credit balance. Gas and other external services are not included.`}><Trans>AI cost</Trans></SettingsLabel></dt>
      <dd className="mt-1 break-words text-base tabular-nums">{amount === null ? (value.state === "pending" ? t`AI cost pending` : t`AI cost unavailable`) : formatTaskCostAmount(amount,i18n.locale)}</dd>
      {partial ? <p className="mt-1 text-xs text-muted-foreground"><Trans>Partial</Trans></p> : null}
      {partial && value.state === "pending" ? <p className="mt-1 text-xs text-muted-foreground"><Trans>AI cost pending</Trans></p> : null}
      {value.estimatedCalls > 0 ? <p className="mt-1 text-xs text-muted-foreground"><Trans>Estimated AI cost</Trans></p> : null}
    </div>
  </dl>;
}

export function AgentUsageSettings({ panelRef }: { panelRef?: RefObject<HTMLDivElement | null> }) {
  const { t } = useLingui();
  const id = useId();
  const client = useSpaceRpc();
  const show = useSyncExternalStore(subscribeResponseCost, getResponseCostVisible, () => false);
  const [loaded, setLoaded] = useState<{client:RpcClient;report:AgentUsageReport} | null>(null);
  const [failedClient, setFailedClient] = useState<RpcClient | null>(null);
  const report = loaded?.client === client ? loaded.report : null;
  const error = failedClient === client;
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try { const data = await client.usage.agents(); if (!cancelled) { setLoaded({client,report:data}); setFailedClient(null); } }
      catch { if (!cancelled) { setLoaded(null); setFailedClient(client); } }
      if (!cancelled) timer = setTimeout(refresh, 15000);
    }
    void refresh();
    return () => { cancelled = true; clearTimeout(timer); };
  },[attempt,client]);
  return <div ref={panelRef} tabIndex={-1} data-testid="usage-settings" className="min-w-0 space-y-6 outline-none">
    <SettingsGroup><SettingsRow label={<Label htmlFor={id}><Trans>Show cost on each response</Trans></Label>} help={{label:t`Show cost on each response`,description:t`Shows the cost below each reply when pricing is available. Hiding it does not change what you pay or remove usage from this page.`}} control={<Switch id={id} data-testid="response-cost-toggle" checked={show} onCheckedChange={setResponseCostVisible} />}/></SettingsGroup>
    {error ? <div role="alert" className="space-y-3"><p className="text-sm text-destructive">{t`Could not load agent usage`}</p><Button variant="outline" onClick={()=>setAttempt(n=>n+1)}><Trans>Retry</Trans></Button></div>
     : !report ? <p className="text-sm text-muted-foreground" role="status"><Trans>Loading…</Trans></p>
     : <>
       <section className="rounded-xl border border-border p-4" data-testid="usage-total"><h3 className="mb-4 text-sm font-medium"><SettingsLabel name={t`Tokens`} help={t`Tokens are small pieces of text processed by a model. Input is what it reads; output is what it writes.`}><Trans>Total usage</Trans></SettingsLabel></h3><UsageMetrics value={report.total}/></section>
       <section className="min-w-0 space-y-3"><h3 className="text-sm font-medium"><Trans>Usage by agent</Trans></h3>
         <p className="text-xs text-muted-foreground"><Trans>Full history in the current space. Gas and external services are separate.</Trans></p>
         {report.agents.length === 0 ? <p className="text-sm text-muted-foreground"><Trans>No agent usage yet</Trans></p> : report.agents.map(row=><section key={row.botId ?? "unassigned"} data-testid="agent-usage-row" className="min-w-0 rounded-xl border border-border p-4">
           <div className="mb-4 flex min-w-0 flex-wrap items-center gap-2"><h4 className="min-w-0 break-words text-sm font-medium">{row.name ?? t`Unassigned usage`}</h4>{row.archived ? <span className="text-xs text-muted-foreground"><Trans>Archived</Trans></span> : null}</div>
           <UsageMetrics value={row}/>
         </section>)}
       </section>
     </>}
  </div>;
}
