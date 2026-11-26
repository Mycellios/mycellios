import type { ProjectSummary } from "@mycellios/contracts";

const PROJECT_HISTORY_PRELOAD_LIMIT = 12;
const PROJECT_HISTORY_READ_BATCH = 2;

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
): [botId: string, threadId: string][] {
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
  const targets: [string, string][] = [];
  // Fill the two initial read slots from the preferred project, then give the
  // other folders a turn before warming older conversations.
  for (let offset = 0; offset < PROJECT_HISTORY_PRELOAD_LIMIT; offset += PROJECT_HISTORY_READ_BATCH) {
    const before = targets.length;
    for (const queue of queues) {
      for (const { botId, threadId } of queue.slice(offset, offset + PROJECT_HISTORY_READ_BATCH)) {
        targets.push([botId, threadId]);
        if (targets.length === PROJECT_HISTORY_PRELOAD_LIMIT) return targets;
      }
    }
    if (targets.length === before) break;
  }
  return targets;
}
