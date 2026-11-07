import type { ThreadSnapshot } from "@rakazo/contracts";
import { isUncertainDesktopRun } from "@rakazo/core";
import { isUnsafeRunRetry } from "./retry-error";

/** The API remains authoritative about recorded effects and original-message ownership. */
export function canRetryThreadRun(snapshot: ThreadSnapshot | null, runId?: string): boolean {
  const run = snapshot?.run;
  if (!snapshot || !run || (runId && run.id !== runId) || run.status !== "failed" || run.trigger !== "user") return false;
  if (isUncertainDesktopRun(run.error)) return false;
  return !snapshot.messages.some(message =>
    message.runId === run.id && message.role === "bot" && !message.id.startsWith("progress:"),
  );
}

type RetryOutcome = "retried" | "changed" | "not_retryable" | "unsafe" | "busy" | "inactive";

function retryConflict(error: unknown): RetryOutcome | null {
  if (isUnsafeRunRetry(error)) return "unsafe";
  if (!error || typeof error !== "object" || ("code" in error && error.code !== "CONFLICT")) return null;
  const message = "message" in error ? error.message : null;
  if (message === "Only failed message requests can be retried.") return "not_retryable";
  if (message === "Wait for the current task to finish before retrying.") return "busy";
  return null;
}

/** Read the current state, then retry only the exact saved turn. Never copy text or files. */
export async function retryOriginalThreadRun(input: {
  runId: string;
  threadId: string;
  refresh: () => Promise<ThreadSnapshot>;
  retry: () => Promise<unknown>;
  isCurrent: () => boolean;
}): Promise<RetryOutcome> {
  const snapshot = await input.refresh();
  if (!input.isCurrent()) return "inactive";
  if (snapshot.threadId !== input.threadId || !canRetryThreadRun(snapshot, input.runId)) return "changed";
  try {
    await input.retry();
    if (!input.isCurrent()) return "inactive";
    // Acceptance is final even when the subsequent observation fails.
    await input.refresh().catch(() => undefined);
    return input.isCurrent() ? "retried" : "inactive";
  } catch (error) {
    if (!input.isCurrent()) return "inactive";
    const outcome = retryConflict(error);
    if (!outcome) throw error;
    await input.refresh();
    return input.isCurrent() ? outcome : "inactive";
  }
}
