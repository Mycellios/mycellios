import type { ProjectSummary } from "@mycellios/contracts";

const PROJECT_HISTORY_PRELOAD_LIMIT = 5;

export function projectHistoryPreloads(
  projects: readonly ProjectSummary[],
  intendedProjectId: string | undefined,
  expandedProjectId: string | undefined,
  lastProjectThread: string | null,
  activeThread: string | undefined,
): [botId: string, threadId: string][] {
  const project = projects.find(item => item.id === intendedProjectId && item.conversations.length)
    ?? projects.find(item => item.id === expandedProjectId && item.conversations.length)
    ?? projects.find(item => item.conversations.some(chat => chat.threadId === lastProjectThread))
    ?? projects.findLast(item => item.conversations.length);
  const eligible = (project?.conversations ?? []).filter(chat => chat.threadId !== activeThread);
  const remembered = eligible.find(chat => chat.threadId === lastProjectThread);
  return (remembered ? [remembered, ...eligible.filter(chat => chat !== remembered)] : eligible)
    .slice(0, PROJECT_HISTORY_PRELOAD_LIMIT)
    .map(({ botId, threadId }) => [botId, threadId]);
}
