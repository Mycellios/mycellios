import { anySignal } from "@mycellios/core";

const HISTORY_FIRST_LIMIT_MS = 3_500;
const NAVIGATION_SETTLE_MS = 250;
const SECONDARY_READ_TIMEOUT_MS = 15_000;
const MAX_SECONDARY_READS = 2;

// Only the reads started by the chat controls use this queue.
const SECONDARY_CHAT_READS = new Set([
  "development/list",
  "links/favicon",
  "me",
  "models/credentials",
  "models/list",
  "routines/list",
  "skills/list",
  "tasks/awaitingReplies",
  "tasks/overview",
  "tasks/waits",
  "threads/pinned",
  "threads/queueState",
  "usage/tasks",
]);

type ChatReadHold = {
  release: () => void;
  users: number;
  settle?: ReturnType<typeof setTimeout>;
};

let hold: ChatReadHold | undefined;
let runningReads = 0;
const queuedReads: Array<() => void> = [];

function drainSecondaryReads(): void {
  if (hold) return;
  while (runningReads < MAX_SECONDARY_READS && queuedReads.length) {
    queuedReads.shift()!();
  }
}

/** Let a new chat load its transcript before its surrounding controls fetch. */
export function prioritizeChatHistory(): () => void {
  if (!hold) {
    const next: ChatReadHold = {
      users: 0,
      release: () => {
        clearTimeout(deadline);
        clearTimeout(next.settle);
        if (hold === next) {
          hold = undefined;
          drainSecondaryReads();
        }
      },
    };
    const deadline = setTimeout(next.release, HISTORY_FIRST_LIMIT_MS);
    hold = next;
  }

  const current = hold;
  clearTimeout(current.settle);
  current.users += 1;
  return () => {
    current.users -= 1;
    if (hold === current && current.users === 0) {
      // Include the first paint and reuse the hold if another click remounts the shell.
      current.settle = setTimeout(current.release, NAVIGATION_SETTLE_MS);
    }
  };
}

/** Limit only the reads deferred by a chat and new secondary reads during their drain. */
export function runWithChatReadPriority<T>(
  procedure: string | undefined,
  signal: AbortSignal,
  read: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const draining = runningReads > 0 || queuedReads.length > 0;
  if (!procedure || !SECONDARY_CHAT_READS.has(procedure) || (!hold && !draining)) {
    return read(signal);
  }

  const queuedSignal = anySignal([signal, AbortSignal.timeout(SECONDARY_READ_TIMEOUT_MS)]);
  if (queuedSignal.aborted) return Promise.reject(queuedSignal.reason);

  return new Promise<T>((resolve, reject) => {
    const cancel = () => {
      const index = queuedReads.indexOf(start);
      if (index >= 0) queuedReads.splice(index, 1);
      reject(queuedSignal.reason);
    };
    const start = () => {
      queuedSignal.removeEventListener("abort", cancel);
      runningReads += 1;
      void Promise.resolve().then(() => read(queuedSignal)).then(resolve, reject).finally(() => {
        runningReads -= 1;
        drainSecondaryReads();
      });
    };
    queuedSignal.addEventListener("abort", cancel, { once: true });
    queuedReads.push(start);
    drainSecondaryReads();
  });
}
