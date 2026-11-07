import { useLingui } from "@lingui/react/macro";
import type { Run, TaskCost, ThreadMessage } from "@rakazo/contracts";
import { lastRunOutput, runHealth } from "@rakazo/core/run-health";
import { observedTools } from "@rakazo/core";
import { Button, GroupAvatar } from "@rakazo/ui-web";
import type { GroupAvatarMember } from "@rakazo/ui-web";
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from "@rakazo/ui-web/components/ui/sheet";
import { useIsMobile } from "@rakazo/ui-web/hooks/use-mobile";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getToolActivityExpanded, subscribeToolActivity } from "../lib/tool-activity-preference";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { activityKind } from "../lib/activity-kind";
import { RunExecutionDetails } from "./RunExecutionDetails";
import { formatToolActivityDuration } from "../lib/tool-activity-view";
import { useCommandActivity } from "../lib/use-command-activity";

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
  const activity = live?.blocks.filter(block => block.kind === "steps" || (block.kind === "progress" && block.activity));
  return <div className="flex min-w-0 items-start gap-2.5 px-1 py-2">
    <GroupAvatar members={bots} size={28} />
    <details className="min-w-0 max-w-prose text-sm text-muted-foreground">
      <summary className="w-fit cursor-pointer rounded-sm py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">{t`Receiving activity · task status not confirmed`}</summary>
      <p className="mt-2 text-xs">{t`Waiting for execution metadata. Reported activity does not confirm success or failure.`}</p>
      <details className="mt-2 text-xs"><summary className="w-fit cursor-pointer py-1">{t`Technical details`}</summary>
        {activity?.map((block,index) => <pre key={index} className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words">{block.kind === "steps" ? block.steps.map(step => `${step.label} ×${step.count}`).join("\n") : block.kind === "progress" ? block.text : ""}</pre>)}
      </details>
    </details>
  </div>;
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
  const describe = (value: string) => {
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
      case "build": return t`Building the project…`;
      case "command": return t`Running a command…`;
      default: return t`Using a tool…`;
    }
  };
  const toolSteps = latestSteps?.kind === "steps" ? latestSteps.steps : [];
  const describeTool = (name: string, detail?: string) => {
    const reported = detail && activityKind(detail) !== "tool" ? detail : name;
    switch (activityKind(reported)) {
      case "history": return t`Conversation history search`;
      case "tests": return t`Tests`;
      case "files": return t`Files`;
      case "command": return t`Command`;
      case "tool": return name.replaceAll("_", " ");
      default: return describe(reported);
    }
  };
  const recentSteps = toolSteps.slice(-8);
  const activitySteps = recentSteps.map(step => ({ label: describe(step.label), count: step.count }));
  const visibleSteps = isMobile ? activitySteps.reduce<typeof activitySteps>((steps, step) => {
    const last = steps.at(-1);
    if (last?.label === step.label) last.count += step.count;
    else steps.push({ ...step });
    return steps;
  }, []) : activitySteps;
  const toolEvents = useCommandActivity(run.id, run.botId, liveMessage ? observedTools(liveMessage.blocks) : []);
  const runningTool = toolEvents.findLast(tool => tool.outcome === "running");
  const settledTool = !toolEvents.some(tool => tool.outcome === "running") ? toolEvents.at(-1) : undefined;
  const primaryLabel = health.state === "quiet" ? t`Waiting for an activity update…`
    : health.state === "running" && settledTool ? settledTool.outcome === "error" ? t`A tool reported an error`
      : settledTool.outcome === "paused" ? t`A tool is waiting for input` : t`Working · last action finished`
    : showActivity && health.state === "running"
    ? describe(runningTool?.command ?? latestActivity ?? "") : labels[health.state];
  const timestamp = (value?: string | null) => value && Number.isFinite(Date.parse(value))
    ? new Intl.DateTimeFormat(i18n.locale || "en", { dateStyle: "medium", timeStyle: "medium" }).format(new Date(value)) : t`Not available`;
  const toolState = { running: t`Waiting for result`, succeeded: t`Finished`, error: t`Reported an error`, paused: t`Waiting for input` };
  const status = <span role="status" className={settledTool?.outcome === "error" && health.state === "running" ? "break-words text-destructive" : "break-words text-foreground"} aria-live="polite">{primaryLabel}</span>;
  const elapsed = health.elapsedMs >= 5000 ? <span aria-live="off" aria-label={run.startedAt ? t`Elapsed` : t`Waiting`} className="shrink-0 text-xs tabular-nums">{t`Total`} {duration(health.elapsedMs)}</span> : null;
  const details = (
    <div className="mt-2 max-w-prose space-y-3 text-xs">
      {!isMobile ? <RunExecutionDetails run={run} cost={cost} /> : null}
      {toolEvents.length ? <ol aria-label={t`Task activity`} className="max-h-72 space-y-3 overflow-y-auto py-1">
        {toolEvents.map((tool, index) => {
          const start = Date.parse(tool.commandStartedAt ?? "");
          const end = tool.commandStatus === "running" ? serverNow : Date.parse(tool.commandFinishedAt ?? "");
          const commandTime = Number.isFinite(start) && Number.isFinite(end) && end >= start ? formatToolActivityDuration(end - start) : null;
          const callTime = !tool.commandStatus ? formatToolActivityDuration(tool.durationMs) : null;
          return <li key={tool.id}>
          <details>
            <summary className="cursor-pointer rounded-sm py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
              <span className="text-foreground">{index + 1}. {describeTool(tool.name, tool.command ?? tool.detail)}</span>
              <span className={tool.outcome === "error" ? "ml-2 text-destructive" : "ml-2 text-muted-foreground"}>{tool.commandStatus === "running" ? t`Running` : !tool.commandStatus && tool.outcome === "succeeded" ? t`Tool returned` : toolState[tool.outcome]}</span>
              {commandTime ? <span className="ml-2 tabular-nums">{t`Command time`}: {commandTime}</span> : callTime ? <span className="ml-2 tabular-nums">{t`Tool call`}: {callTime}</span> : null}
            </summary>
            <div className="mt-1 space-y-1 pl-3 text-muted-foreground">
              {tool.command ? <><p>{t`Command`}</p><pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words">{tool.command}</pre></> : tool.detail ? <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words">{tool.detail}</pre> : <p>{tool.name}</p>}
              {tool.cwd ? <p className="break-all">{t`Working directory`}: {tool.cwd}</p> : null}
              {tool.exitCode != null ? <p>{t`Exit code`}: {tool.exitCode}</p> : null}
              {tool.commandStatus === "done" && !commandTime ? <p>{t`Command duration unavailable: its start was not observed.`}</p> : null}
              {tool.commandStatus ? <><p>{t`Output`}</p>{tool.output ? <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words">{tool.output}</pre> : <p>{tool.commandStatus === "running" ? t`No output yet.` : t`The command produced no text output.`}</p>}</> : null}
              {tool.outputTruncated ? <p>{t`Showing the last 12000 characters of output.`}</p> : null}
              {tool.error ? <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words text-destructive">{tool.error}</pre> : null}
              {!tool.commandStatus ? <p>{t`Only tool-call metadata is available; the command result has not been received.`}</p> : null}
            </div>
          </details>
        </li>})}
      </ol> : visibleSteps.length ? <ol aria-label={t`Task activity`} className="max-h-52 space-y-2 overflow-y-auto py-1">
        {visibleSteps.map((step, index) => <li key={`${index}:${step.label}`} className="flex items-baseline gap-2" aria-current={index === visibleSteps.length - 1 ? "step" : undefined}>
          <span aria-hidden="true" className="text-muted-foreground">·</span>
          <span className={index === visibleSteps.length - 1 ? "text-foreground" : "text-muted-foreground"}>{step.label}</span>
          {step.count > 1 ? <span className="text-muted-foreground tabular-nums">×{step.count}</span> : null}
        </li>)}
      </ol> : showActivity && health.state !== "running" ? <p>{describe(latestActivity)}</p> : null}
      {health.state === "blocked" ? <p>{t`No model has started. Configure a virtual computer to continue.`}</p> : null}
      {health.state === "unknown" ? <p>{t`Worker status is not available for this task.`}</p> : null}
      <details className="text-muted-foreground">
        <summary className="w-fit cursor-pointer rounded-sm py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">{t`Technical details`}</summary>
        {isMobile && (run.modelId || run.modelProvider || cost) ? <div className="my-2"><RunExecutionDetails run={run} cost={cost} /></div> : null}
        <dl className="grid gap-x-4 gap-y-1 break-words sm:grid-cols-[auto_minmax(0,1fr)]">
          <dt>{t`Last worker signal`}</dt><dd>{timestamp(health.lastSignalAt)}</dd>
          <dt>{t`Last output`}</dt><dd>{timestamp(health.lastOutputAt)}</dd>
          <dt>{t`Worker lease valid until`}</dt><dd>{timestamp(run.leaseExpiresAt)}</dd>
        </dl>
        {showActivity ? <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words" data-testid="latest-run-activity">{t`Latest activity: ${latestActivity}`}</pre> : null}
        {recentSteps.length ? <ol className="mt-2 space-y-2">{recentSteps.map((step,index) => <li key={index}><code className="whitespace-pre-wrap break-words">{step.label}</code>{step.count > 1 ? ` ×${step.count}` : ""}</li>)}</ol> : null}
        {health.state === "quiet" ? <p className="mt-2">{t`Worker connected · no recent output`}</p> : null}
        {health.state === "quiet" || health.state === "unknown" || health.state === "recovering" ? <p className="mt-2">{t`A long task is not stopped just because it has not produced new output.`}</p> : null}
      </details>
    </div>
  );
  const computerAction = health.state === "blocked" && onOpenComputer ? (
    <Button variant="ghost" size="sm" onClick={onOpenComputer}>{t`View computer`}</Button>
  ) : null;
  if (isMobile) {
    return <div className="min-w-0 px-1 py-1" data-testid="run-activity-status">
      <Sheet key={run.id}>
        <SheetTrigger className="flex min-h-12 w-full min-w-0 items-center gap-2 rounded-md px-1 text-start text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring" aria-label={t`Show task activity`}>
          <GroupAvatar members={bots} size={36} />
          <span className="min-w-0 flex-1 line-clamp-2">{status}</span>
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
      </Sheet>
      {computerAction}
    </div>;
  }
  return (
    <div className="flex min-w-0 items-start gap-2.5 px-1 py-2" data-testid="run-activity-status">
      <GroupAvatar members={bots} size={28} />
      <div className="min-w-0 max-w-full space-y-1 text-sm text-muted-foreground">
        <details key={run.id} open={expanded} className="group/activity">
          <summary className="flex w-fit max-w-full cursor-pointer list-none items-baseline gap-2 rounded-sm py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden" aria-label={t`Show task activity`}>
            {status}
            {elapsed}
            <ChevronDown aria-hidden="true" size={14} className="shrink-0 self-center transition-transform group-open/activity:rotate-180 motion-reduce:transition-none" />
          </summary>
          {details}
        </details>
        {health.state === "quiet" ? <p role="status" className="max-w-prose text-xs">{t`No new activity for ${duration(health.outputAgeMs ?? health.elapsedMs)}. This does not confirm a failure; the executor has not reported a new step.`}</p> : null}
        {computerAction}
      </div>
    </div>
  );
}
