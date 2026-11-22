import { Trans, useLingui } from "@lingui/react/macro";
import { PLAN_ALTERNATIVE, PLAN_CANCEL, PLAN_START } from "@mycellios/core";
import { Button } from "@mycellios/ui-web";
import { useEffect, useState } from "react";
import type { AskBlock } from "./AskCard";

function secondsLeft(autoStartAt: string | undefined, now: number): number | undefined {
  if (!autoStartAt) return undefined;
  const left = Math.ceil((Date.parse(autoStartAt) - now) / 1000);
  return Number.isFinite(left) ? Math.max(0, left) : undefined;
}

/**
 * A Mico's acknowledgement and plan before a long task. Start, an optional alternative and Cancel
 * answer it; the countdown on Start only shows the wait, the server starts the plan itself.
 */
export function PlanCard({
  block,
  canAnswer,
  onAnswer,
}: {
  block: AskBlock;
  canAnswer: boolean;
  onAnswer: (answer: string) => Promise<void>;
}) {
  const { t } = useLingui();
  const [pending, setPending] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const answered = block.status === "answered";
  const left = answered ? undefined : secondsLeft(block.plan?.autoStartAt, now);
  useEffect(() => {
    if (answered || left === undefined || left <= 0) return;
    const timer = window.setTimeout(() => setNow(Date.now()), 1000);
    return () => window.clearTimeout(timer);
  }, [answered, left, now]);
  const alternative = block.actions?.find((action) => action.id === PLAN_ALTERNATIVE);
  const answer = async (id: string) => {
    if (pending || answered) return;
    setPending(id);
    setFailed(false);
    try {
      await onAnswer(id);
    } catch {
      setFailed(true);
    } finally {
      setPending(null);
    }
  };
  const outcome = block.plan?.autoStarted
    ? t`Started (nobody answered in time)`
    : block.answer === PLAN_START
      ? t`Started`
      : block.answer === PLAN_CANCEL
        ? t`Cancelled`
        : block.answer === PLAN_ALTERNATIVE && alternative
          ? alternative.label
          : block.answer;
  return (
    <div data-testid="plan-card" className="w-full min-w-0 max-w-md rounded-2xl bg-card px-4 py-3">
      <p className="text-[15px] leading-relaxed text-foreground" dir="auto">{block.text}</p>
      <ol className="mt-2 space-y-1 text-sm">
        {block.plan?.steps.map((step, index) => (
          <li key={index} className="flex gap-2" dir="auto">
            <span className="shrink-0 font-medium text-muted-foreground">{step.label}</span>
            <span className="min-w-0 break-words text-foreground">{step.text}</span>
          </li>
        ))}
      </ol>
      {answered ? (
        <p data-testid="plan-card-outcome" className="mt-3 text-sm text-muted-foreground" dir="auto">{outcome}</p>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" size="sm" disabled={!canAnswer || pending !== null} onClick={() => void answer(PLAN_START)}>
            {left !== undefined && left > 0 ? <Trans>Start · {left} s</Trans> : <Trans>Start</Trans>}
          </Button>
          {alternative ? (
            <Button type="button" size="sm" variant="secondary" disabled={!canAnswer || pending !== null} onClick={() => void answer(PLAN_ALTERNATIVE)}>
              {alternative.label}
            </Button>
          ) : null}
          <Button type="button" size="sm" variant="ghost" disabled={!canAnswer || pending !== null} onClick={() => void answer(PLAN_CANCEL)}>
            <Trans>Cancel</Trans>
          </Button>
        </div>
      )}
      {failed ? <p role="alert" className="mt-2 text-sm text-destructive"><Trans>Could not submit this answer</Trans></p> : null}
    </div>
  );
}
