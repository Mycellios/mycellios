import { useLingui } from "@lingui/react/macro";
import type { Run, TaskCost, ThreadMessage } from "@rakazo/contracts";
import { lastRunOutput, runHealth } from "@rakazo/core/run-health";
import { observedTools, type ToolObservation } from "@rakazo/core";
import { Button, GroupAvatar } from "@rakazo/ui-web";
import type { GroupAvatarMember } from "@rakazo/ui-web";
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from "@rakazo/ui-web/components/ui/sheet";
import { useIsMobile } from "@rakazo/ui-web/hooks/use-mobile";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getToolActivityExpanded, subscribeToolActivity } from "../lib/tool-activity-preference";
import { liveThreadDisconnected, subscribeLiveThreadConnection } from "../lib/live-thread-connection";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { activityKind } from "../lib/activity-kind";
import { RunExecutionDetails } from "./RunExecutionDetails";
import { useCommandActivity } from "../lib/use-command-activity";

type ActivityStep = { label: string; count: number; outcome?: "error" | "paused" };

function summarizeSteps(steps: readonly ActivityStep[], describe: (label: string) => string) {
  return steps.reduce<ActivityStep[]>((summary, step) => {
    const label = describe(step.label);
    const last = summary.at(-1);
    if (last?.label === label && last.outcome === step.outcome) last.count += step.count;
    else summary.push({ ...step, label });
    return summary;
  }, []).slice(-8);
}

function RunActivityDiagnostics({ run, cost, tools, legacyCommand }: {
  run: Run; cost?: TaskCost; tools: ToolObservation[]; legacyCommand: string | null;
}) {
  const { t } = useLingui();
  return <div className="mt-2 space-y-2">
    {run.modelId || run.modelProvider || cost?.runId === run.id ? <RunExecutionDetails run={run} cost={cost} /> : null}
    {legacyCommand ? <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words" data-testid="latest-run-activity">{legacyCommand}</pre> : null}
    {tools.filter((tool) => tool.command || tool.detail || tool.output || tool.error || tool.cwd).map((tool) => (
      <details key={tool.id}>
        <summary className="cursor-pointer rounded-sm py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
          {tool.name.replaceAll("_", " ")}
        </summary>
        <div className="space-y-1 ps-3">
          {tool.command || tool.detail ? <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words">{tool.command ?? tool.detail}</pre> : null}
          {tool.cwd ? <p className="break-all">{t`Working directory`}: {tool.cwd}</p> : null}
          {tool.exitCode != null ? <p>{t`Exit code`}: {tool.exitCode}</p> : null}
          {tool.output ? <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words">{tool.output}</pre> : null}
          {tool.outputTruncated ? <p>{t`Showing the last 12000 characters of output.`}</p> : null}
          {tool.error ? <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words text-destructive">{tool.error}</pre> : null}
        </div>
      </details>
    ))}
  </div>;
}

function TechnicalActivity({ run, cost, tools, legacyCommand }: {
  run: Run; cost?: TaskCost; tools: ToolObservation[]; legacyCommand: string | null;
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  return <details className="text-muted-foreground" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary className="w-fit cursor-pointer rounded-sm py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">{t`Technical details`}</summary>
    {open ? <RunActivityDiagnostics run={run} cost={cost} tools={tools} legacyCommand={legacyCommand} /> : null}
  </details>;
}

/** The event stream can precede run metadata. Keep activity folded and request that metadata. */
export function PendingRunActivity({ messages, bots, onRefresh }: {
  messages: ThreadMessage[]; bots: GroupAvatarMember[]; onRefresh: () => Promise<void>;
}) {
  const { t } = useLingui();
  const refresh = useRef(onRefresh); refresh.current = onRefresh;
  useEffect(() => {
    let disposed = false, pending = false;
    const update = async () => {
      if (disposed || pending || document.hidden) return;
      pending = true;
      try { await refresh.current(); } catch { /* Keep unknown status; never retry the task. */ }
      finally { pending = false; }
    };
    void update();
    const timer = window.setInterval(() => void update(), 30_000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, []);
  const live = messages.findLast(message => message.id.startsWith("progress:"));
  const describe = useActivityDescription();
  const steps = summarizeSteps(live?.blocks.flatMap(block => block.kind === "steps" ? block.steps : []) ?? [], describe);
  return <div className="flex min-w-0 items-start gap-2.5 px-1 py-2">
    <GroupAvatar members={bots} size={28} />
    <div className="min-w-0 max-w-prose text-sm text-muted-foreground">
      {steps.length ? <details>
        <summary className="w-fit cursor-pointer rounded-sm py-1">{t`Receiving activity · task status not confirmed`}</summary>
        <ol aria-label={t`Task activity`} className="space-y-1 py-1 text-xs">
          {steps.map((step, index) => <li key={index}>{step.label}{step.count > 1 ? ` ×${step.count}` : ""}</li>)}
        </ol>
      </details> : <span role="status">{t`Receiving activity · task status not confirmed`}</span>}
    </div>
  </div>;
}

function useActivityDescription() {
  const { t } = useLingui();
  return (value: string) => {
    switch (activityKind(value)) {
      case "history": return t`Searching conversation history…`;
      case "tests": return t`Running tests…`;
      case "changes": return t`Reviewing changes…`;
      case "editing": return t`Editing files…`;
      case "files": return t`Reviewing files…`;
      case "web": return t`Searching the web…`;
      case "server": return t`Working on the server…`;
      case "image": return t`Preparing an image…`;
      case "schedule": return t`Managing a routine…`;
      case "message": return t`Coordinating with another agent…`;
      case "planning": return t`Organizing the task…`;
      case "calendar": return t`Checking the calendar…`;
      case "mail": return t`Checking email…`;
      case "build": return t`Building the project…`;
      case "command": return t`Running a command…`;
      default: return t`Using a tool…`;
    }
  };
}

/** This observer only reads state. It never stops, retries or restarts a run. */
export function RunActivityStatus({
  run,
  messages,
  bots,
  activity,
  cost,
  missingComputer,
  onRefresh,
  onOpenComputer,
}: {
  run: Run;
  messages: ThreadMessage[];
  bots: GroupAvatarMember[];
  activity?: string;
  cost?: TaskCost;
  missingComputer?: boolean;
  onRefresh: () => Promise<void>;
  onOpenComputer?: () => void;
}) {
  const { t, i18n } = useLingui();
  const describe = useActivityDescription();
  const [now, setNow] = useState(Date.now);
  const isMobile = useIsMobile();
  const expanded = useSyncExternalStore(subscribeToolActivity, getToolActivityExpanded, () => false);
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
  const tail = liveMessage?.blocks.at(-1);
  const scopedActivity = tail?.kind === "progress" && tail.activity ? tail.text : undefined;
  const legacyActivity = messages.some(message => message.id.startsWith("progress:")) ? undefined : activity;
  const latestActivity = scopedActivity || latestTool || legacyActivity;
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
  const toolSteps = latestSteps?.kind === "steps" ? latestSteps.steps : [];
  const activityOf = (tool: ToolObservation) => {
    const kind = activityKind(tool.name);
    if (kind !== "tool" && kind !== "command") return tool.name;
    const detail = tool.command ?? tool.detail;
    return detail && activityKind(detail) !== "tool" ? detail : tool.name;
  };
  const toolEvents = useCommandActivity(run.id, run.botId, liveMessage ? observedTools(liveMessage.blocks) : []);
  const visibleSteps = summarizeSteps(toolEvents.length ? toolEvents.map((tool) => ({
    label: activityOf(tool),
    count: 1,
    outcome: tool.outcome === "error" || tool.outcome === "paused" ? tool.outcome : undefined,
  })) : toolSteps, describe);
  const runningTool = toolEvents.findLast(tool => tool.outcome === "running");
  const settledTool = runningTool ? undefined : toolEvents.at(-1);
  const updatesStopped = useSyncExternalStore(subscribeLiveThreadConnection, liveThreadDisconnected, () => false);
  const liveUpdatesStopped = updatesStopped && (health.state === "running" || health.state === "quiet" || health.state === "unknown" || health.state === "recovering");
  const primaryLabel = liveUpdatesStopped
    ? t`Live updates stopped. The task was not cancelled.`
    : health.state === "quiet" ? t`Waiting for an activity update…`
    : health.state === "running" && runningTool ? describe(activityOf(runningTool))
    : health.state === "running" && settledTool?.outcome === "paused" ? t`A tool is waiting for input`
    : health.state === "running" && showActivity && (scopedActivity || !settledTool) ? describe(scopedActivity || latestActivity)
    : labels[health.state];
  const status = liveUpdatesStopped
    ? <span role="alert" className="break-words text-destructive">{primaryLabel}</span>
    : <span role="status" className="break-words text-foreground">{primaryLabel}</span>;
  const elapsed = health.elapsedMs >= 5000 ? <span aria-live="off" aria-label={run.startedAt ? t`Elapsed` : t`Waiting`} className="shrink-0 text-xs tabular-nums">{duration(health.elapsedMs)}</span> : null;
  const hasDetails = Boolean(visibleSteps.length || showActivity);
  const hasExecutionDetails = Boolean(run.modelId || run.modelProvider || (cost?.runId === run.id));
  const legacyCommand = showActivity && !toolEvents.length && /^running:/i.test(latestActivity)
    ? latestActivity : null;
  const hasTechnicalDetails = hasExecutionDetails || legacyCommand ||
    toolEvents.some(tool => tool.command || tool.detail || tool.output || tool.error || tool.cwd || tool.name === "shell");
  const details = (
    <div className="mt-1 min-w-0 max-w-prose space-y-2 text-xs">
      {visibleSteps.length ? <ol aria-label={t`Task activity`} className="space-y-1.5 border-s border-border py-1 ps-3">
        {visibleSteps.map((step, index) => <li key={`${index}:${step.label}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5" aria-current={index === visibleSteps.length - 1 ? "step" : undefined}>
          <span aria-hidden="true" className="text-muted-foreground">·</span>
          <span className={index === visibleSteps.length - 1 ? "text-foreground" : "text-muted-foreground"}>{step.label}</span>
          {step.count > 1 ? <span className="text-muted-foreground tabular-nums">×{step.count}</span> : null}
          {step.outcome === "error" ? <span className="text-destructive">{t`Reported an error`}</span> : null}
          {step.outcome === "paused" ? <span className="text-muted-foreground">{t`Waiting for input`}</span> : null}
        </li>)}
      </ol> : showActivity ? <p>{describe(latestActivity)}</p> : null}
      {hasTechnicalDetails ? <TechnicalActivity run={run} cost={cost} tools={toolEvents} legacyCommand={legacyCommand} /> : null}
    </div>
  );
  const computerAction = health.state === "blocked" && onOpenComputer ? (
    <Button variant="ghost" size="sm" onClick={onOpenComputer}>{t`View computer`}</Button>
  ) : null;
  if (isMobile) {
    return <div className="min-w-0 px-1 py-1" data-testid="run-activity-status">
      {hasDetails ? <Sheet key={run.id}>
        <SheetTrigger className="flex min-h-12 w-full min-w-0 items-center gap-2 rounded-md px-1 text-start text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring" aria-label={t`Show task activity`}>
          <GroupAvatar members={bots} size={36} />
          <span className="min-w-0 flex-1 line-clamp-2">{status}</span>
          {elapsed}
          <ChevronRight aria-hidden="true" size={16} className="shrink-0 text-muted-foreground rtl:rotate-180" />
        </SheetTrigger>
        <SheetContent side="bottom" showCloseButton={false} className="max-h-[80dvh] gap-2 overflow-y-auto overscroll-contain rounded-t-2xl px-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] motion-reduce:transition-none">
          <div className="flex min-h-12 items-center justify-between gap-2">
            <SheetTitle>{t`Task activity`}</SheetTitle>
            <SheetClose render={<Button variant="ghost" size="icon" className="size-12" aria-label={t`Close`} />}><X /></SheetClose>
          </div>
          <div className="flex flex-wrap items-baseline gap-x-2 text-sm">{primaryLabel}{elapsed}</div>
          {details}
        </SheetContent>
      </Sheet> : <div className="flex min-h-12 items-center gap-2 px-1 text-sm"><GroupAvatar members={bots} size={36} />{status}{elapsed}</div>}
      {computerAction}
    </div>;
  }
  return (
    <div className="flex min-w-0 items-start gap-2.5 px-1 py-2" data-testid="run-activity-status">
      <GroupAvatar members={bots} size={28} />
      <div className="min-w-0 max-w-full space-y-1 text-sm text-muted-foreground">
        {hasDetails ? <details key={run.id} open={expanded} className="group/activity">
          <summary className="flex w-fit max-w-full cursor-pointer list-none items-baseline gap-2 rounded-sm py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden" aria-label={t`Show task activity`}>
            {status}
            {elapsed}
            <ChevronDown aria-hidden="true" size={14} className="shrink-0 self-center transition-transform group-open/activity:rotate-180 motion-reduce:transition-none" />
          </summary>
          {details}
        </details> : <div className="flex items-baseline gap-2 py-1">{status}{elapsed}</div>}
        {health.state === "blocked" ? <p className="text-xs">{t`No model has started. Configure a virtual computer to continue.`}</p> : null}
        {computerAction}
      </div>
    </div>
  );
}
