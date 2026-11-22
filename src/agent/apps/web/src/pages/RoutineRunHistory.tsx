import { LoadingSkeleton } from "../components/LoadingSkeleton";
import { routineThreadPath } from "../lib/routine-thread-path";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import type { RoutineHistory, RoutineRun } from "@mycellios/contracts";
import type { RpcClient } from "../lib/rpc";
import { isRetryableError, normalizeRunError } from "@mycellios/core";
import { Button, Collapsible, CollapsibleContent } from "@mycellios/ui-web";
import { ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { rpc } from "../lib/rpc";
import { translateRunError } from "../lib/run-error";
import { formatToolActivityDuration } from "../lib/tool-activity-view";
import { statusLabel, statusTone } from "./ActivityList";

export type RoutineHistoryState = { history: RoutineHistory | null; failed: boolean };

/** A recurring run that starts this long after its scheduled time is shown as late. */
const LATE_RUN_MS = 15 * 60_000;

/** When a recurring run started late, the time it was due. */
export function routineRunDueLate(run: Pick<RoutineRun, "scheduledFor" | "startedAt">): string | null {
  if (!run.scheduledFor || !run.startedAt) return null;
  return Date.parse(run.startedAt) - Date.parse(run.scheduledFor) >= LATE_RUN_MS ? run.scheduledFor : null;
}
export function RoutineRunHistory({ routineId, client = rpc, refreshToken = 0, pollInterval = 15_000, onState }: {
  routineId: string;
  client?: RpcClient;
  refreshToken?: number;
  pollInterval?: number;
  onState?: (routineId: string, state: RoutineHistoryState) => void;
}) {
  const { i18n, t } = useLingui();
  const [history, setHistory] = useState<RoutineHistory | null>(null);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const firstPageRequest = useRef(0);
  const acceptedFirstPage = useRef(0);
  const expandedRef = useRef(false);
  const hasLoadedOlder = useRef(false);
  const listId = useId();
  const runs = history?.runs ?? null;
  useEffect(() => { onState?.(routineId, { history, failed }); }, [routineId, history, failed, onState]);

  useEffect(() => {
    expandedRef.current = expanded;
  }, [expanded]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    // A non-retryable answer stops polling until the routine or revision changes.
    let refused = false;
    generation.current += 1;
    setHistory(null);
    setFailed(false);
    setLoadingMore(false);
    hasLoadedOlder.current = false;

    async function loadFirstPage() {
      try {
        const page = await client.routines.history({ routineId });
        if (cancelled) return;
        hasLoadedOlder.current = false;
        setHistory(page);
        setFailed(false);
      } catch (error) {
        refused = !isRetryableError(error);
        if (!cancelled) setFailed(true);
      }
    }

    async function poll() {
      // Expanded browsing uses explicit Refresh only so loaded older pages stay coherent.
      if (expandedRef.current) {
        if (!cancelled) timer = window.setTimeout(() => void poll(), pollInterval);
        return;
      }
      const request = generation.current;
      const sequence = ++firstPageRequest.current;
      try {
        const page = await client.routines.history({ routineId });
        if (
          cancelled ||
          request !== generation.current ||
          expandedRef.current ||
          sequence < acceptedFirstPage.current
        )
          return;
        acceptedFirstPage.current = sequence;
        hasLoadedOlder.current = false;
        setHistory(page);
        setFailed(false);
      } catch (error) {
        refused = !isRetryableError(error);
        if (
          !cancelled &&
          request === generation.current &&
          !expandedRef.current &&
          sequence >= acceptedFirstPage.current
        )
          setFailed(true);
      } finally {
        if (!cancelled && !refused) timer = window.setTimeout(() => void poll(), pollInterval);
      }
    }

    void loadFirstPage().then(() => {
      if (!cancelled && !refused) timer = window.setTimeout(() => void poll(), pollInterval);
    });
    return () => {
      cancelled = true;
      generation.current += 1;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [routineId, revision, client, refreshToken, pollInterval]);

  function toggleExpanded() {
    const next = !expanded;
    expandedRef.current = next;
    generation.current += 1;
    setLoadingMore(false);
    setExpanded(next);
    if (next || !hasLoadedOlder.current) return;
    const request = generation.current;
    const sequence = ++firstPageRequest.current;
    void client.routines
      .history({ routineId })
      .then((page) => {
        if (
          request !== generation.current ||
          expandedRef.current ||
          sequence < acceptedFirstPage.current
        )
          return;
        acceptedFirstPage.current = sequence;
        hasLoadedOlder.current = false;
        setHistory(page);
        setFailed(false);
      })
      .catch(() => {
        if (
          request === generation.current &&
          !expandedRef.current &&
          sequence >= acceptedFirstPage.current
        )
          setFailed(true);
      });
  }

  async function loadMore() {
    if (!history?.nextCursor || loadingMore) return;
    const request = generation.current;
    setLoadingMore(true);
    try {
      const page = await client.routines.history({ routineId, before: history.nextCursor });
      if (request !== generation.current) return;
      hasLoadedOlder.current = true;
      setHistory((current) =>
        current
          ? {
              runs: [
                ...current.runs,
                ...page.runs.filter(
                  (run) => !current.runs.some((existing) => existing.id === run.id),
                ),
              ],
              nextCursor: page.nextCursor,
            }
          : current,
      );
      setFailed(false);
    } catch {
      if (request === generation.current) setFailed(true);
    } finally {
      if (request === generation.current) setLoadingMore(false);
    }
  }

  function sourceLabel(source: RoutineRun["source"]): string | null {
    switch (source) {
      case "schedule":
        return t`Scheduled`;
      case "watch":
        return t`Change detected`;
      case "manual":
        return t`Run by you`;
      case "script":
        return t`Local script`;
      case "chat":
        return t`Mentioned in chat`;
      case "webhook":
        return t`Webhook`;
      case "github":
        return t`GitHub event`;
      case "retry":
        return t`Automatic retry`;
      default:
        return null;
    }
  }

  function renderMissed(missed: NonNullable<RoutineRun["missed"]>) {
    const count = missed.count;
    return (
      <p data-testid="routine-run-missed" className="mt-1">
        {missed.reason === "busy" ? (
          <Plural
            value={count}
            one="# earlier run was folded into this one: the run before it had not started yet"
            other="# earlier runs were folded into this one: the run before them had not started yet"
          />
        ) : (
          <Plural
            value={count}
            one="# earlier run did not happen: the server was not running at its time"
            other="# earlier runs did not happen: the server was not running at their time"
          />
        )}
      </p>
    );
  }

  function renderRun(run: RoutineHistory["runs"][number]) {
    const at = run.startedAt ?? run.createdAt;
    const label = sourceLabel(run.source);
    const dueLate = routineRunDueLate(run);
    const formatDue = (value: string) =>
      new Date(value).toLocaleString(i18n.locale || "en", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    const due = dueLate ? formatDue(dueLate) : null;
    const duration =
      run.startedAt && run.completedAt
        ? formatToolActivityDuration(Date.parse(run.completedAt) - Date.parse(run.startedAt))
        : null;
    const chatTo = routineThreadPath(run);
    return (
      <li key={run.id} className="py-2.5 text-[13px]" data-testid="routine-run-row">
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate">
            {label ? (
              <span data-testid="routine-run-source">
                {label}
                <span aria-hidden> · </span>
              </span>
            ) : null}
            <time dateTime={at} title={new Date(at).toLocaleString(i18n.locale || "en")}>
              {new Date(at).toLocaleString(i18n.locale || "en", {
                month: "short",
                day: "numeric",
                year: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </time>
          </span>
          {run.quiet && run.status === "completed" ? (
            <span data-testid="routine-run-quiet" className="text-muted-foreground">
              <Trans>Nothing new</Trans>
            </span>
          ) : (
            <span className={statusTone(run.status)}>{statusLabel(run.status)}</span>
          )}
        </div>
        {due ? (
          <p data-testid="routine-run-late" className="mt-1">
            {t`Ran late: it was due ${due}`}
          </p>
        ) : null}
        {run.missed ? renderMissed(run.missed) : null}
        {run.status === "failed" && run.error ? (
          <div className="mt-1 text-destructive">
            <p>{normalizeRunError(run.error, translateRunError, i18n.locale || "en").summary}</p>
            <details key={run.error} className="mt-1">
              <summary className="w-fit cursor-pointer">{t`Details`}</summary>
              <pre className="mt-2 whitespace-pre-wrap break-words text-xs">{run.error}</pre>
            </details>
          </div>
        ) : null}
        <div className="mt-1 flex items-center justify-between gap-2">
          <span>{duration}</span>
          {chatTo ? (
            <Link to={chatTo} className="text-foreground underline underline-offset-2">
              <Trans>View chat</Trans>
            </Link>
          ) : null}
        </div>
      </li>
    );
  }

  return (
    <section data-testid="routine-run-history" className="mt-8 text-sm text-muted-foreground">
      <div className="flex items-center justify-between gap-2">
        <h3>
          <Button
            variant="text"
            aria-expanded={expanded}
            aria-controls={listId}
            onClick={toggleExpanded}
            className="gap-2 font-normal"
          >
            <Trans>Run history</Trans>
            <ChevronDown
              size={14}
              aria-hidden
              className={`transition-transform duration-150 ease-out motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`}
            />
          </Button>
        </h3>
        {expanded || failed ? (
          <Button size="xs" variant="ghost" onClick={() => setRevision((value) => value + 1)}>
            <Trans>Refresh</Trans>
          </Button>
        ) : null}
      </div>
      {failed ? (
        <p role="alert" className="mt-2 text-[13.5px] text-destructive">
          <Trans>Could not load run history</Trans>
        </p>
      ) : runs === null ? (
        <LoadingSkeleton className="mt-2" />
      ) : runs.length === 0 ? (
        <p className="mt-2 text-[13.5px]">
          <Trans>No runs yet</Trans>
        </p>
      ) : null}
      {runs && runs.length > 0 ? (
        <div id={listId} className="mt-2">
          <ul className="divide-y divide-border">{runs.slice(0, 1).map(renderRun)}</ul>
          <Collapsible open={expanded} className="contents">
            <CollapsibleContent className="flex flex-col">
              <ul className="divide-y divide-border border-t border-border">
                {runs.slice(1).map(renderRun)}
              </ul>
            </CollapsibleContent>
          </Collapsible>
        </div>
      ) : null}
      {expanded && history?.nextCursor ? (
        <Button
          size="xs"
          variant="ghost"
          disabled={loadingMore}
          onClick={() => void loadMore()}
          className="mt-2"
        >
          <Trans>Load older runs</Trans>
        </Button>
      ) : null}
    </section>
  );
}
