import { Trans, useLingui } from "@lingui/react/macro";
import type { TaskCost } from "@rakazo/contracts";
import { formatTaskCostAmount } from "@rakazo/core";

export function TaskCostFooter({ cost }: { cost: TaskCost }) {
  const { t, i18n } = useLingui();
  const amount = cost.amountUsd === null ? null : formatTaskCostAmount(cost.amountUsd, i18n.locale);
  return (
    <div
      className="mt-1.5 px-2 text-[12px] text-muted-foreground"
      data-testid="task-cost"
      data-cost-state={cost.state}
      title={t`Includes all model calls for this task. Gas and external services are separate.`}
    >
      {cost.state === "confirmed" ? (
        <Trans>AI cost</Trans>
      ) : cost.state === "estimated" ? (
        <Trans>Estimated AI cost</Trans>
      ) : cost.state === "pending" ? (
        <Trans>AI cost pending</Trans>
      ) : (
        <Trans>AI cost unavailable</Trans>
      )}
      {amount !== null ? `: ${amount}` : ""}
    </div>
  );
}
