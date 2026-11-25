const HISTORY_FIRST_LIMIT_MS = 3_500;
const NAVIGATION_SETTLE_MS = 250;

// Secondary reads started by the chat chrome. Never hold sends, task actions,
// authorization recovery, history, or realtime streams.
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
  done: Promise<void>;
  release: () => void;
  users: number;
  settle?: ReturnType<typeof setTimeout>;
};

let hold: ChatReadHold | undefined;

/** Let a new chat load its transcript before its surrounding controls fetch. */
export function prioritizeChatHistory(): () => void {
  if (!hold) {
    let resolve!: () => void;
    const done = new Promise<void>((finish) => { resolve = finish; });
    const next: ChatReadHold = {
      done,
      users: 0,
      release: () => {
        clearTimeout(deadline);
        clearTimeout(next.settle);
        if (hold === next) hold = undefined;
        resolve();
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

export function waitForSecondaryChatRead(procedure: string | undefined, signal?: AbortSignal) {
  const current = hold;
  if (!current || !procedure || !SECONDARY_CHAT_READS.has(procedure)) return;
  if (!signal) return current.done;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<void>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    void current.done.then(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    });
  });
}
