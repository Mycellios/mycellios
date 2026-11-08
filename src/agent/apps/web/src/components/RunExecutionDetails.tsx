import { useLingui } from "@lingui/react/macro";
import type { Run, TaskCost } from "@rakazo/contracts";
import { useEffect, useState } from "react";
import { TaskCostFooter } from "../pages/shell/task-cost-footer";

/** Only executor-reported metadata; never substitute the bot's current settings. */
export function RunExecutionDetails({ run, cost }: { run: Run; cost?: TaskCost }) {
  return <ExecutionDetails key={run.id} run={run} cost={cost} />;
}

function ExecutionDetails({ run, cost }: { run: Run; cost?: TaskCost }) {
  const { t, i18n } = useLingui();
  const [observed, setObserved] = useState<{ model: string; provider: string }[]>([]);
  useEffect(() => {
    if (!run.modelId || !run.modelProvider) return;
    const model = run.modelId, provider = run.modelProvider;
    setObserved(previous => previous.at(-1)?.model === model && previous.at(-1)?.provider === provider
      ? previous : [...previous, { model, provider }].slice(-8));
  }, [run.modelId, run.modelProvider]);
  const previousModels = observed.filter((item, index) =>
    index < observed.length - 1 || item.model !== run.modelId || item.provider !== run.modelProvider);
  const elapsed = run.completedAt && run.startedAt
    ? Date.parse(run.completedAt) - Date.parse(run.startedAt) : NaN;
  const seconds = Number.isFinite(elapsed) && elapsed >= 0
    ? new Intl.NumberFormat(i18n.locale || "en", { style: "unit", unit: "second", unitDisplay: "short", maximumFractionDigits: 0 }).format(elapsed / 1000) : null;
  return <div className="min-w-0 space-y-2" data-testid="run-execution-details">
    <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs">
      {run.modelId ? <><dt className="text-muted-foreground">{t`Execution model`}</dt>
      <dd className="min-w-0 break-words [overflow-wrap:anywhere] text-foreground">{run.modelId}</dd></> : null}
      {run.modelProvider ? <><dt className="text-muted-foreground">{t`Model provider`}</dt>
      <dd className="min-w-0 break-words [overflow-wrap:anywhere] text-foreground">{run.modelProvider}</dd></> : null}
      {seconds ? <><dt>{t`Duration`}</dt><dd className="tabular-nums">{seconds}</dd></> : null}
    </dl>
    {previousModels.length ? <div><p>{t`Previous models observed in this view`}</p>
      <ul className="mt-1 space-y-1 break-words [overflow-wrap:anywhere]">{previousModels.map((item, index) =>
        <li key={`${index}:${item.provider}:${item.model}`}>{item.model} · {item.provider}</li>)}</ul></div> : null}
    {cost?.runId === run.id ? <TaskCostFooter cost={cost} /> : null}
  </div>;
}
