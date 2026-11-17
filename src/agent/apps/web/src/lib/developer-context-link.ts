import { appPath } from "./app-path";

export type DeveloperChatContext = {
  botId: string;
  spaceId?: string | null;
  threadId?: string | null;
  taskThreadId?: string;
  runId?: string | null;
};

/** An authenticated chat destination with lookup IDs, never a sharing capability. */
export function developerContextLink(
  context: DeveloperChatContext,
  origin: string,
  base = import.meta.env.BASE_URL,
): string {
  // Start from the deployment origin, not the current URL's query or fragment:
  // transient login/review tokens and unrelated panels must never be copied.
  const url = new URL(appPath(`/app/${encodeURIComponent(context.botId)}`, base), new URL(origin).origin);
  if (context.spaceId) url.searchParams.set("noticeSpace", context.spaceId);
  if (context.taskThreadId) url.searchParams.set("task", context.taskThreadId);
  if (context.threadId) url.searchParams.set("threadId", context.threadId);
  if (context.runId) url.searchParams.set("runId", context.runId);
  return url.href;
}
