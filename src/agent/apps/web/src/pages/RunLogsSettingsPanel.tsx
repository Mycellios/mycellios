import { Trans, useLingui } from "@lingui/react/macro";
import type { RunActivityRow, RunLogIssue, RunLogRow, RunLogsOutput, RoutineRunCursor } from "@rakazo/contracts";
import { Button, Input, Label, NativeSelect, NativeSelectOption } from "@rakazo/ui-web";
import { useInfiniteQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useQueryUserId } from "../lib/query";
import { selectedSpaceId } from "../lib/rpc";
import { useBoundSpaceId, useSpaceRpc } from "../lib/space-rpc";
import { statusLabel, statusTone } from "./ActivityList";
import { SettingsLabel } from "../components/SettingsRows";

const EXECUTING = new Set(["queued", "leased", "running"]);
type ActivitySummary = Pick<RunActivityRow, "runId" | "botId" | "botName" | "status" | "updatedAt">;
type LogsPage = RunLogsOutput & { activity?: ActivitySummary[] };

/** Owned execution metadata only; this is not an endpoint for server stdout or tool payloads. */
export function RunLogsSettingsPanel() {
  const { t, i18n } = useLingui();
  const client = useSpaceRpc();
  const userId = useQueryUserId();
  const spaceId = useBoundSpaceId() ?? selectedSpaceId();
  const [botId, setBotId] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const catalogScope = `${userId ?? ""}\n${spaceId ?? ""}`;
  const [catalog, setCatalog] = useState<{ scope: string; agents: RunLogsOutput["agents"] }>();
  const agentId = useId();
  const logs = useInfiniteQuery({
    queryKey: ["run-logs", userId, spaceId, botId],
    initialPageParam: null as RoutineRunCursor | null,
    queryFn: async ({ pageParam, signal }): Promise<LogsPage> => {
      try {
        return await client.runs.logs({ botId: botId || undefined, before: pageParam ?? undefined }, { signal });
      } catch (error) {
        if (signal.aborted || !(error && typeof error === "object" && "code" in error && error.code === "NOT_FOUND")) throw error;
        // Compatibility with older APIs: retain only honest activity metadata.
        // Never invent start times, attempts, models or diagnostic details.
        const recent = await client.runs.list({ filter: "recent" }, { signal });
        const activity = recent.runs.map(({ runId, botId, botName, status, updatedAt }) =>
          ({ runId, botId, botName, status, updatedAt }));
        return {
          observedAt: new Date().toISOString(), runs: [], nextCursor: null, activity,
          agents: [...new Map(activity.map(run => [run.botId, { id: run.botId, name: run.botName }])).values()],
        };
      }
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: Boolean(userId),
    refetchInterval: (query) =>
      query.state.error
        ? false
        : query.state.data?.pages.some((page) => [...page.runs, ...(page.activity ?? [])].some((run) => EXECUTING.has(run.status)))
          ? 15_000
          : false,
    refetchIntervalInBackground: false,
  });
  const pages = logs.data?.pages ?? [];
  const seen = new Set<string>();
  const runs = pages
    .flatMap((page) => page.runs)
    .filter((run) => {
      if (seen.has(run.id)) return false;
      seen.add(run.id);
      return true;
    });
  const currentAgents = pages[0]?.agents;
  useEffect(() => {
    if (currentAgents) setCatalog({ scope: catalogScope, agents: currentAgents });
  }, [catalogScope, currentAgents]);
  const agents = currentAgents ?? (catalog?.scope === catalogScope ? catalog.agents : []);
  const activity = pages[0]?.activity;
  const active = [...runs, ...(activity ?? [])].some((run) => EXECUTING.has(run.status));
  const needle = search.trim().toLocaleLowerCase();
  const visibleRuns = runs.filter(
    (run) =>
      (status === "all" ||
        (status === "active" ? EXECUTING.has(run.status) : run.status === status)) &&
      (!needle ||
        [run.id, run.botName, run.modelId, run.issue].some((value) =>
          value?.toLocaleLowerCase().includes(needle),
        )),
  );
  const visibleActivity = (activity ?? []).filter(run =>
    (!botId || run.botId === botId) &&
    (status === "all" || (status === "active" ? EXECUTING.has(run.status) : run.status === status)) &&
    (!needle || [run.runId, run.botName].some(value => value.toLocaleLowerCase().includes(needle))));

  return (
    <section className="min-w-0 space-y-5" aria-label={t`Execution logs`} data-testid="run-logs">
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-end">
        <div className="w-full min-w-0 space-y-2 sm:max-w-xs sm:flex-1">
          <Label htmlFor={agentId}>
            <Trans>Agent</Trans>
          </Label>
          <NativeSelect
            className="w-full"
            id={agentId}
            value={botId}
            onChange={(event) => setBotId(event.target.value)}
          >
            <NativeSelectOption value="">{t`All agents`}</NativeSelectOption>
            {agents.map((agent) => (
              <NativeSelectOption key={agent.id} value={agent.id}>
                {agent.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <Button variant="outline" disabled={logs.isFetching} onClick={() => void logs.refetch()}>
          <RefreshCw aria-hidden="true" />
          <Trans>Refresh logs</Trans>
        </Button>
      </div>

      <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
        <Input
          aria-label={t`Search loaded logs`}
          placeholder={t`Search loaded logs`}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <NativeSelect
          aria-label={t`Status of loaded logs`}
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <NativeSelectOption value="all">{t`All statuses`}</NativeSelectOption>
          <NativeSelectOption value="active">{t`Active`}</NativeSelectOption>
          <NativeSelectOption value="failed">{t`Failed`}</NativeSelectOption>
          <NativeSelectOption value="completed">{t`Completed`}</NativeSelectOption>
          <NativeSelectOption value="cancelled">{t`Cancelled`}</NativeSelectOption>
        </NativeSelect>
      </div>

      {logs.isError ? (
        <p role="alert" className="text-sm text-destructive">
          <Trans>Could not refresh logs. Try again.</Trans>
        </p>
      ) : null}
      {activity ? (
        <>
          <p className="max-w-prose text-sm text-muted-foreground">
            <Trans>This server provides recent activity only. Detailed execution logs are not available yet.</Trans>
          </p>
          <ol className="min-w-0 divide-y divide-border border-y border-border">
            {visibleActivity.map(run => (
              <li key={run.runId} className="min-w-0 py-4" data-testid="run-activity-summary">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <span className="break-words text-sm font-medium">{run.botName}</span>
                  <span className={`text-sm ${statusTone(run.status)}`}>{statusLabel(run.status)}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground"><Trans>Updated</Trans>{" "}<time dateTime={run.updatedAt}>{formatDate(run.updatedAt, i18n.locale)}</time></p>
                <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{run.runId}</p>
              </li>
            ))}
          </ol>
          {!visibleActivity.length ? <p className="text-sm text-muted-foreground"><Trans>No matches in recent activity.</Trans></p> : null}
        </>
      ) : null}
      {logs.isPending ? (
        <div role="status" aria-label={t`Loading logs`} className="space-y-5">
          {[0, 1, 2].map((row) => (
            <div
              key={row}
              aria-hidden="true"
              className="h-12 w-full rounded-lg bg-muted motion-safe:animate-pulse"
            />
          ))}
        </div>
      ) : runs.length === 0 && !logs.isError && !activity ? (
        <p className="text-sm text-muted-foreground">
          <Trans>No executions yet. Activity will appear here after you send a message.</Trans>
        </p>
      ) : runs.length ? (
        <ol className="min-w-0 divide-y divide-border border-y border-border">
          {visibleRuns.map((run) => (
            <RunLogEntry key={run.id} run={run} locale={i18n.locale} />
          ))}
        </ol>
      ) : null}
      {runs.length > 0 && visibleRuns.length === 0 ? (
        <p role="status" className="text-sm text-muted-foreground">
          <Trans>No matches in loaded logs. Clear the filters or load older logs.</Trans>
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {pages[0] ? (
          <p className="text-xs text-muted-foreground">
            <Trans>Updated</Trans>{" "}
            <time dateTime={pages[0].observedAt}>
              {formatDate(pages[0].observedAt, i18n.locale)}
            </time>
            {active && !logs.isError ? (
              <>
                {" "}
                · <Trans>Refreshes every 15 seconds while active</Trans>
              </>
            ) : null}
          </p>
        ) : null}
        {logs.hasNextPage ? (
          <Button
            variant="outline"
            disabled={logs.isFetching}
            onClick={() => void logs.fetchNextPage()}
          >
            <Trans>Load older logs</Trans>
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function RunLogEntry({ run, locale }: { run: RunLogRow; locale: string }) {
  const { t } = useLingui();
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const blocked = run.issue !== null && EXECUTING.has(run.status);
  const date = (value: string | null) => (value ? formatDate(value, locale) : t`Not recorded`);
  const issueText = (issue: RunLogIssue) => {
    switch (issue) {
      case "computer_missing":
        return t`No virtual computer is assigned. This execution cannot start.`;
      case "computers_disabled":
        return t`Virtual computers are unavailable on this server.`;
      case "model_unavailable":
        return t`The model is unavailable. Check Models in settings.`;
      case "context_limit":
        return t`The model's context limit was reached.`;
      case "rate_limit":
        return t`The provider's request limit was reached.`;
      case "provider_auth":
        return t`The provider rejected the credential. Check Models in settings.`;
      case "execution_failed":
        return t`Execution failed. Copy the diagnostic details to report it.`;
    }
  };
  async function copyDetails() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(run, null, 2));
      setCopied(true);
      setCopyFailed(false);
    } catch {
      setCopyFailed(true);
    }
  }
  return (
    <li className="min-w-0 py-4" data-testid="run-log-entry">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="min-w-0 break-words text-sm font-medium">{run.botName}</span>
        <span className={`text-sm ${blocked ? "text-warning" : statusTone(run.status)}`}>
          {blocked ? <Trans>Blocked</Trans> : statusLabel(run.status)}
        </span>
      </div>
      <time className="mt-1 block text-xs text-muted-foreground" dateTime={run.createdAt}>
        {date(run.createdAt)}
      </time>
      {run.modelId ? (
        <p className="mt-1 break-all text-xs text-muted-foreground">{run.modelId}</p>
      ) : null}
      {run.issue ? (
        <p className="mt-2 max-w-prose break-words text-sm text-destructive">
          {issueText(run.issue)}
        </p>
      ) : null}
      <details className="mt-3 min-w-0 text-sm">
        <summary className="w-fit cursor-pointer rounded-sm text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
          <Trans>Diagnostic details</Trans>
        </summary>
        <dl className="mt-3 grid min-w-0 gap-x-4 gap-y-2 text-xs sm:grid-cols-[auto_minmax(0,1fr)] [&_dd]:min-w-0 [&_dd]:break-all [&_dt]:text-muted-foreground">
          <dt>
            <Trans>Execution ID</Trans>
          </dt>
          <dd className="font-mono">{run.id}</dd>
          <dt>
            <Trans>Created</Trans>
          </dt>
          <dd>{date(run.createdAt)}</dd>
          <dt>
            <Trans>Started</Trans>
          </dt>
          <dd>{date(run.startedAt)}</dd>
          <dt>
            <Trans>First response</Trans>
          </dt>
          <dd>{date(run.firstResponseAt)}</dd>
          <dt>
            <Trans>Finished</Trans>
          </dt>
          <dd>{date(run.completedAt)}</dd>
          <dt>
            <Trans>Updated</Trans>
          </dt>
          <dd>{date(run.updatedAt)}</dd>
          <dt>
            <Trans>Model</Trans>
          </dt>
          <dd>{run.modelId ?? t`Not recorded`}</dd>
          <dt>
            <SettingsLabel name={t`Execution attempts`} help={t`Recorded attempts to run this task. A retry is another attempt, not necessarily another message from you.`}><Trans>Execution attempts</Trans></SettingsLabel>
          </dt>
          <dd>{run.attemptCount.toLocaleString(locale)}</dd>
          <dt>
            <SettingsLabel name={t`Worker claims`} help={t`How many times a worker took responsibility for this task. This does not mean the model was called or that you were charged each time.`}><Trans>Worker claims</Trans></SettingsLabel>
          </dt>
          <dd>{run.dispatchCount.toLocaleString(locale)}</dd>
          {run.issue ? (
            <>
              <dt>
                <Trans>Error code</Trans>
              </dt>
              <dd className="font-mono">{run.issue}</dd>
            </>
          ) : null}
        </dl>
        {run.attempts.length ? (
          <ol
            className="mt-4 space-y-2 border-t border-border pt-3"
            aria-label={t`Recent attempts`}
          >
            {run.attempts.map((attempt) => (
              <li key={attempt.id} className="min-w-0 break-words">
                <time dateTime={attempt.startedAt}>{date(attempt.startedAt)}</time>
                {" · "}
                {attempt.status === "other" ? t`Finished` : statusLabel(attempt.status)}
                {attempt.issue ? (
                  <p className="text-destructive">{issueText(attempt.issue)}</p>
                ) : null}
              </li>
            ))}
            {run.attemptCount > run.attempts.length ? (
              <li className="text-muted-foreground">
                <Trans>Showing the latest 10 attempts.</Trans>
              </li>
            ) : null}
          </ol>
        ) : null}
        <Button className="mt-3" variant="outline" size="sm" onClick={() => void copyDetails()}>
          {copied ? <Trans>Copied</Trans> : <Trans>Copy diagnostic details</Trans>}
        </Button>
        {copyFailed ? (
          <p role="alert" className="mt-2 text-xs text-destructive">
            <Trans>Could not copy details. Select the execution ID instead.</Trans>
          </p>
        ) : null}
      </details>
    </li>
  );
}

function formatDate(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "medium" }).format(
    new Date(value),
  );
}
