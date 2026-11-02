import { useLingui } from "@lingui/react/macro";
import type { Run, ThreadMessage } from "@rakazo/contracts";
import { lastRunOutput, runHealth } from "@rakazo/core/run-health";
import { Button, GroupAvatar } from "@rakazo/ui-web";
import type { GroupAvatarMember } from "@rakazo/ui-web";
import { useEffect, useRef, useState } from "react";

/** This observer only reads state. It never stops, retries or restarts a run. */
export function RunActivityStatus({
  run,
  messages,
  bots,
  activity,
  missingComputer,
  onRefresh,
  onOpenComputer,
}: {
  run: Run;
  messages: ThreadMessage[];
  bots: GroupAvatarMember[];
  activity?: string;
  missingComputer?: boolean;
  onRefresh: () => Promise<void>;
  onOpenComputer?: () => void;
}) {
  const { t, i18n } = useLingui();
  const [now, setNow] = useState(Date.now);
  const refresh = useRef(onRefresh);
  refresh.current = onRefresh;
  const observation = useRef({ stamp: run.observedAt, receivedAt: Date.now() });
  if (observation.current.stamp !== run.observedAt)
    observation.current = { stamp: run.observedAt, receivedAt: Date.now() };
  useEffect(() => {
    let disposed = false;
    let refreshing = false;
    let lastRefresh = 0;
    const tick = () => {
      if (document.hidden || disposed) return;
      const time = Date.now();
      setNow(time);
      if (refreshing || time - lastRefresh < 30_000) return;
      lastRefresh = time;
      refreshing = true;
      void refresh
        .current()
        .catch(() => undefined)
        .finally(() => {
          refreshing = false;
        });
    };
    const timer = window.setInterval(tick, 1_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [run.id]);
  const observed = run.observedAt ? Date.parse(run.observedAt) : NaN;
  const serverNow = Number.isFinite(observed)
    ? observed + Math.max(0, now - observation.current.receivedAt)
    : now;
  const health = runHealth(run, {
    now: serverNow,
    missingComputer,
    lastOutputAt: lastRunOutput(run, messages),
  });
  // Activity labels can contain commands and paths. Keep them inside the closed disclosure.
  const liveMessage = messages.findLast((message) =>
    message.id === `progress:${run.id}` ||
    (message.id.startsWith("progress:") && message.runId === run.id),
  );
  const latestSteps = liveMessage?.blocks.findLast((block) => block.kind === "steps");
  const latestTool = latestSteps?.kind === "steps" ? latestSteps.steps.at(-1)?.label : undefined;
  const latestActivity = activity || latestTool;
  const showActivity = latestActivity && ["running", "quiet", "unknown", "recovering"].includes(health.state);
  const labels = {
    idle: t`Finished`,
    waiting: t`Waiting for your response`,
    queued: t`Queued`,
    blocked: t`Cannot start: virtual computer unavailable`,
    starting: t`Waiting to start`,
    recovering: t`Checking connection…`,
    running: t`Working…`,
    quiet: t`Working…`,
    unknown: t`Status not confirmed`,
  };
  const duration = (ms: number) => {
    const minutes = Math.max(0, Math.floor(ms / 60_000));
    const unit = (value: number, name: "hour" | "minute" | "second") =>
      new Intl.NumberFormat(i18n.locale || "en", {
        style: "unit",
        unit: name,
        unitDisplay: "short",
      }).format(value);
    return minutes >= 60
      ? `${unit(Math.floor(minutes / 60), "hour")} ${unit(minutes % 60, "minute")}`
      : minutes > 0 ? unit(minutes, "minute") : unit(Math.floor(ms / 1000), "second");
  };
  const timestamp = (value?: string | null) =>
    value && Number.isFinite(Date.parse(value))
      ? new Intl.DateTimeFormat(i18n.locale || "en", {
          dateStyle: "medium",
          timeStyle: "medium",
        }).format(new Date(value))
      : t`Not available`;
  return (
    <div className="flex min-w-0 items-start gap-2.5 px-1 py-2" data-testid="run-activity-status">
      <GroupAvatar members={bots} size={28} />
      <div className="min-w-0 max-w-full space-y-1 text-sm text-muted-foreground">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <p role="status" className="break-words text-foreground">{labels[health.state]}</p>
          {health.elapsedMs >= 5000 ? <span aria-live="off" aria-label={run.startedAt ? t`Elapsed` : t`Waiting`} className="text-xs tabular-nums">
            · {duration(health.elapsedMs)}
          </span> : null}
        </div>
        {health.state === "blocked" ? (
          <p>{t`No model has started. Configure a virtual computer to continue.`}</p>
        ) : null}
        <details key={run.id} className="text-xs">
          <summary className="w-fit cursor-pointer rounded-sm py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">{t`Execution details`}</summary>
          {showActivity ? (
            <p className="max-w-prose break-words text-sm" data-testid="latest-run-activity" aria-live="polite">
              {t`Latest activity: ${latestActivity}`}
            </p>
          ) : null}
          {health.state === "quiet" ? <p className="mt-2">{t`Worker connected · no recent output`}</p> : null}
          {health.state === "unknown" ? <p className="mt-2">{t`Worker status is not available for this task.`}</p> : null}
          {health.state === "quiet" || health.state === "unknown" || health.state === "recovering" ? (
            <p className="mt-2 max-w-prose">{t`A long task is not stopped just because it has not produced new output.`}</p>
          ) : null}
          <dl className="mt-3 grid gap-x-4 gap-y-1 break-words sm:grid-cols-[auto_minmax(0,1fr)] [&_dt]:text-muted-foreground [&_dd]:text-foreground">
            <dt>{t`Last worker signal`}</dt>
            <dd>{timestamp(health.lastSignalAt)}</dd>
            <dt>{t`Last output`}</dt>
            <dd>{timestamp(health.lastOutputAt)}</dd>
            <dt>{t`Worker lease valid until`}</dt>
            <dd>{timestamp(run.leaseExpiresAt)}</dd>
          </dl>
        </details>
        {health.state === "blocked" && onOpenComputer ? (
          <Button variant="ghost" size="sm" onClick={onOpenComputer}>{t`View computer`}</Button>
        ) : null}
      </div>
    </div>
  );
}
