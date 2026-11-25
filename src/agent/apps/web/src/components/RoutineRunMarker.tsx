import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { cn } from "@mycellios/ui-web";
import { ChevronRight, Repeat } from "lucide-react";
import { useId, useState } from "react";
import { Link } from "react-router-dom";
import type { RoutineRunBlock } from "../lib/routine-run-groups";

type RoutineRun = { id: string; createdAt: string; block: RoutineRunBlock };

/** The routine conversation a marker links to, opened as its tab beside the main chat. */
export function routineRunTarget(block: Pick<RoutineRunBlock, "fromBotId" | "taskId">) {
  return {
    pathname: `/app/${encodeURIComponent(block.fromBotId)}`,
    search: `?task=${encodeURIComponent(block.taskId)}`,
  };
}

function RunText({ block }: { block: RoutineRunBlock }) {
  const { t } = useLingui();
  const routine = block.routineName;
  switch (block.status) {
    case "quiet":
      return <>{t`${routine} ran, nothing new`}</>;
    case "failed":
      return <>{t`${routine} failed`}</>;
    case "paused":
      return <>{t`${routine} ran and paused itself`}</>;
    default:
      return <>{t`${routine} ran`}</>;
  }
}

function outcomeTone(block: RoutineRunBlock) {
  if (block.status === "failed") return "text-destructive";
  if (block.status === "quiet") return "text-muted-foreground/80";
  return "text-muted-foreground";
}

function OpenLink({ block }: { block: RoutineRunBlock }) {
  return (
    <Link
      data-testid="routine-run-open"
      to={routineRunTarget(block)}
      className="shrink-0 font-medium text-foreground/80 underline-offset-4 hover:text-foreground hover:underline"
    >
      <Trans>Open</Trans>
    </Link>
  );
}

/**
 * A routine that works in its own conversation leaves a compact line in the main chat for each
 * run, with a link to that conversation. Consecutive runs of the same routine share one line
 * that opens to list them; the answers stay in the routine conversation.
 */
export function RoutineRunMarker({
  runs,
  locale,
  revealMessageId,
}: {
  runs: readonly RoutineRun[];
  locale: string;
  revealMessageId?: string;
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const listId = useId();
  const latest = runs.at(-1);
  if (!latest) return null;
  // The transcript looks up the exact row in the same commit as the jump.
  if (!open && revealMessageId && runs.some(run => run.id === revealMessageId)) setOpen(true);
  const time = (at: string) =>
    new Date(at).toLocaleTimeString(locale || "en", { hour: "numeric", minute: "2-digit" });
  const rowClass = "flex min-h-6 w-fit max-w-full items-center gap-1.5 py-0.5 text-[12px]";
  if (runs.length === 1) {
    return (
      <div
        data-testid="routine-run-marker"
        data-outcome={latest.block.status}
        className={cn(rowClass, outcomeTone(latest.block))}
      >
        <Repeat aria-hidden size={13} strokeWidth={1.8} className="shrink-0" />
        <span dir="auto" className="min-w-0 wrap-anywhere">
          <RunText block={latest.block} />
        </span>
        <span aria-hidden>·</span>
        <OpenLink block={latest.block} />
      </div>
    );
  }
  const count = runs.length;
  const routine = latest.block.routineName;
  return (
    <div data-testid="routine-run-group" className="flex flex-col items-start">
      <div className={cn(rowClass, "text-muted-foreground")}>
        <button
          type="button"
          data-testid="routine-run-group-toggle"
          aria-expanded={open}
          aria-controls={listId}
          aria-label={open ? t`Hide the runs of ${routine}` : t`Show the runs of ${routine}`}
          onClick={() => setOpen((value) => !value)}
          className="flex min-w-0 cursor-pointer items-center gap-1 rounded-md outline-none hover:text-foreground/75 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <ChevronRight
            aria-hidden
            size={14}
            strokeWidth={1.8}
            className={`shrink-0 transition-transform duration-150 motion-reduce:transition-none ${open ? "rotate-90" : ""}`}
          />
          <span dir="auto" className="min-w-0 wrap-anywhere">
            <Plural value={count} one={`# run of ${routine}`} other={`# runs of ${routine}`} />
          </span>
        </button>
        <span aria-hidden>·</span>
        <OpenLink block={latest.block} />
      </div>
      {open ? (
        <ul id={listId} data-testid="routine-run-group-list" className="ms-5 flex flex-col">
          {runs.map((run) => (
            <li
              key={run.id}
              data-message-id={run.id}
              data-outcome={run.block.status}
              className={cn(rowClass, outcomeTone(run.block))}
            >
              <time dateTime={run.createdAt} className="shrink-0 tabular-nums">
                {time(run.createdAt)}
              </time>
              <span dir="auto" className="min-w-0 wrap-anywhere">
                <RunText block={run.block} />
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
