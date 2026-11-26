import type { ProjectSummary } from "@mycellios/contracts";

const PROJECT_HISTORY_PRELOAD_LIMIT = 12;
const PROJECT_HISTORY_PRELOAD_CONCURRENCY = 2;
type HistoryTarget = [botId: string, threadId: string];
type WarmHistory = (botId: string, threadId: string) => Promise<void>;

export function projectHistoryPreferenceKey(userId: string, spaceId: string): string {
  return `mycellios:last-project-thread:${JSON.stringify([userId, spaceId])}`;
}

export function readLastProjectThread(key: string | undefined): string | null {
  if (!key) return null;
  try { return localStorage.getItem(key); } catch { return null; }
}

export function projectHistoryPreloads(
  projects: readonly ProjectSummary[],
  intendedProjectId: string | undefined,
  expandedProjectId: string | undefined,
  lastProjectThread: string | null,
  activeThread: string | undefined,
): HistoryTarget[] {
  const preferred = projects.find(item => item.id === intendedProjectId && item.conversations.length)
    ?? projects.find(item => item.id === expandedProjectId && item.conversations.length)
    ?? projects.find(item => item.conversations.some(chat => chat.threadId === lastProjectThread))
    ?? projects.findLast(item => item.conversations.length);
  if (!preferred) return [];
  const queues = [preferred, ...projects.filter(project => project !== preferred).reverse()]
    .map(project => {
      const eligible = project.conversations.filter(chat => chat.threadId !== activeThread);
      const remembered = eligible.find(chat => chat.threadId === lastProjectThread);
      return remembered ? [remembered, ...eligible.filter(chat => chat !== remembered)] : eligible;
    });
  const targets: HistoryTarget[] = [];
  // Fill the two initial read slots from the preferred project, then give the
  // other folders a turn before warming older conversations.
  for (let offset = 0; offset < PROJECT_HISTORY_PRELOAD_LIMIT; offset += PROJECT_HISTORY_PRELOAD_CONCURRENCY) {
    const before = targets.length;
    for (const queue of queues) {
      for (const { botId, threadId } of queue.slice(offset, offset + PROJECT_HISTORY_PRELOAD_CONCURRENCY)) {
        targets.push([botId, threadId]);
        if (targets.length === PROJECT_HISTORY_PRELOAD_LIMIT) return targets;
      }
    }
    if (targets.length === before) break;
  }
  return targets;
}

/** One background budget across authenticated startup and sidebar remounts. */
export function createProjectHistoryPreloader() {
  const inFlight = new Set<string>();
  let resumeCurrent: (() => void) | undefined;
  let cancelCurrent: (() => void) | undefined;
  let sidebarHasScheduled = false;

  return {
    isInFlight: (threadId: string) => inFlight.has(threadId),
    schedule(targets: readonly HistoryTarget[], warm: WarmHistory, startup = false) {
      if (!targets.length) return;
      if (startup && sidebarHasScheduled) return;
      if (!startup) sidebarHasScheduled = true;
      cancelCurrent?.();
      const pending = [...targets];
      function resume() {
        while (pending.length && document.visibilityState === "visible" &&
          inFlight.size < PROJECT_HISTORY_PRELOAD_CONCURRENCY) {
          const [botId, threadId] = pending.shift()!;
          if (inFlight.has(threadId)) continue;
          inFlight.add(threadId);
          void warm(botId, threadId).catch(() => undefined).finally(() => {
            inFlight.delete(threadId);
            resumeCurrent?.();
          });
        }
        if (!pending.length) cancel();
      }
      function cancel() {
        document.removeEventListener("visibilitychange", resume);
        if (resumeCurrent === resume) {
          resumeCurrent = undefined;
          cancelCurrent = undefined;
        }
      }
      resumeCurrent = resume;
      cancelCurrent = cancel;
      document.addEventListener("visibilitychange", resume);
      resume();
      return cancel;
    },
  };
}

const scopedPreloaders = new Map<string, ReturnType<typeof createProjectHistoryPreloader>>();

export function scopedProjectHistoryPreloader(key: string) {
  let preloader = scopedPreloaders.get(key);
  if (!preloader) {
    preloader = createProjectHistoryPreloader();
    scopedPreloaders.set(key, preloader);
  }
  return preloader;
}
