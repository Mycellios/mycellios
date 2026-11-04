export type TaskThreadScope = Readonly<{ botId: string; taskThreadId: string }>;

/** A pinned client cannot redirect an earlier task's request after navigation. */
export function taskThreadInput(path: readonly string[], input: unknown, scope?: TaskThreadScope): unknown {
  if (!scope || !input || typeof input !== "object" || Array.isArray(input)) return input;
  if (path[0] !== "threads" && path[0] !== "bootstrap") return input;
  const value = input as Record<string, unknown>;
  if (path[0] === "bootstrap" && value.botId === undefined)
    return { ...value, botId: scope.botId, taskThreadId: scope.taskThreadId };
  if (value.botId !== scope.botId || value.groupId) return input;
  if (value.taskThreadId !== undefined && value.taskThreadId !== scope.taskThreadId)
    throw new Error("This request belongs to a different task conversation.");
  return { ...value, taskThreadId: scope.taskThreadId };
}

export function taskThreadResult(path: readonly string[], input: unknown, result: unknown, scope?: TaskThreadScope): unknown {
  if (!scope || !input || typeof input !== "object" || !("taskThreadId" in input) || input.taskThreadId !== scope.taskThreadId) return result;
  if (path[0] !== "bootstrap" && !(path[0] === "threads" && ["get", "head", "messages"].includes(path[1] ?? ""))) return result;
  const value = result && typeof result === "object" ? result as Record<string, unknown> : {};
  const snapshot = path[0] === "bootstrap" ? value.thread : value;
  if (!snapshot || typeof snapshot !== "object" || !("threadId" in snapshot) || snapshot.threadId !== scope.taskThreadId)
    throw new Error("The server did not return this task conversation. Update the server and retry.");
  return result;
}
