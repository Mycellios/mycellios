import { t } from "@lingui/core/macro";
import type { RunActivityRow } from "@mycellios/contracts";

/** What a call says about other work: something finished, failed, or is waiting for the person. */
export type CallNoticeKind = "finished" | "failed" | "waiting";
export type CallNotice = { key: string; name: string; kind: CallNoticeKind };

type NoticeRun = Pick<
  RunActivityRow,
  | "runId"
  | "botName"
  | "groupId"
  | "groupName"
  | "threadId"
  | "status"
  | "trigger"
  | "notificationsEnabled"
  | "updatedAt"
>;

/**
 * Other work worth telling the caller about, changed since the call started: never the
 * conversation on the call, and with the same quiet rules as background alerts (muted Micos,
 * routine results and turns another Mico started finish quietly; their failures and questions
 * still count). `seen` holds keys already announced in this call.
 */
export function callNotices(
  runs: readonly NoticeRun[],
  options: { since: number; callThreadId: string | null; seen: ReadonlySet<string> },
): CallNotice[] {
  const notices: CallNotice[] = [];
  const keys = new Set<string>();
  for (const run of runs) {
    if (!run.notificationsEnabled || run.threadId === options.callThreadId) continue;
    const at = Date.parse(run.updatedAt);
    if (!Number.isFinite(at) || at < options.since) continue;
    const kind: CallNoticeKind | null =
      run.status === "completed"
        ? "finished"
        : run.status === "failed"
          ? "failed"
          : run.status === "waiting_input" || run.status === "waiting_takeover"
            ? "waiting"
            : null;
    if (!kind) continue;
    if (
      kind === "finished" &&
      (run.trigger === "routine" ||
        run.trigger === "bot_message" ||
        run.trigger === "delegated_task")
    )
      continue;
    const key = `${run.runId}:${run.status}`;
    if (options.seen.has(key) || keys.has(key)) continue;
    keys.add(key);
    notices.push({ key, name: (run.groupId ? run.groupName : run.botName) || run.botName, kind });
  }
  return notices;
}

function nameList(list: readonly string[]): string {
  const unique = [...new Set(list)];
  if (unique.length <= 3) return unique.join(", ");
  const first = unique.slice(0, 3).join(", ");
  return t`${first} and others`;
}

const waitingLine = (names: string) => t`Heads up: ${names} is waiting for you.`;
const failedLine = (names: string) => t`Work by ${names} failed.`;
const finishedLine = (names: string) => t`${names} finished.`;

/** One short spoken line per kind, waiting first: it is the one that needs the caller. */
export function callNoticeSpeech(notices: readonly CallNotice[]): string {
  const of = (kind: CallNoticeKind) =>
    notices.filter((notice) => notice.kind === kind).map((notice) => notice.name);
  const waiting = of("waiting");
  const failed = of("failed");
  const finished = of("finished");
  const lines: string[] = [];
  if (waiting.length) lines.push(waitingLine(nameList(waiting)));
  if (failed.length) lines.push(failedLine(nameList(failed)));
  if (finished.length) lines.push(finishedLine(nameList(finished)));
  return lines.join(" ");
}
