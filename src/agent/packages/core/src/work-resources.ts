/** Resource names are coordination metadata, never a filesystem or permission grant. */
export function isMicoTaskThread(thread: { taskBotId?: string | null; projectKey?: string | null; taskKey?: string | null }) {
  return Boolean(thread.taskBotId && thread.projectKey === `mico:${thread.taskBotId}` &&
    thread.taskKey?.startsWith(`mico-task:${thread.taskBotId}:`));
}

export type TaskThreadKind = "conversation" | "routine" | "workflow" | "delegation" | "project" | "other";

/** What started a Mico's side thread, for labels only; it never grants or narrows access. */
export function taskThreadKind(thread: { taskBotId?: string | null; projectKey?: string | null; taskKey?: string | null }): TaskThreadKind {
  const task = thread.taskKey ?? "", project = thread.projectKey ?? "";
  // Delegated work may inherit its requester's project key, so its own task key decides first.
  if (task.startsWith("delegation:") || task.startsWith("work-transfer:")) return "delegation";
  if (task.startsWith("routine:") || project.startsWith("routine:")) return "routine";
  if (task.startsWith("workflow:") || project.startsWith("workflow:")) return "workflow";
  if (project.startsWith("project:")) return "project";
  return isMicoTaskThread(thread) ? "conversation" : "other";
}

/**
 * Delegated or transferred work outside a development project. It runs in the Mico's existing
 * workspace, also when someone later writes in that conversation; a delegation inside a
 * `project:` conversation keeps that project's isolated binding.
 */
export function isInternalWorkThread(thread: { taskBotId?: string | null; projectKey?: string | null; taskKey?: string | null }) {
  return Boolean(thread.taskBotId) && taskThreadKind(thread) === "delegation" && !thread.projectKey?.startsWith("project:");
}

export function nativeWorkProjectSession(
  thread: { id: string; taskBotId?: string | null; projectKey?: string | null; taskKey?: string | null },
  _task: { delegationState?: string | null },
): string | undefined {
  // Internal delegated conversations use the Mico's existing workspace. Explicit
  // development projects retain the native binding and its independent admission.
  return thread.taskBotId && !isInternalWorkThread(thread) && !isMicoTaskThread(thread) ? thread.id : undefined;
}

export function normalizeWorkResources(resources: string[]): string[] {
  if (resources.length > 16) throw new Error("At most 16 resources may be reserved");
  return [...new Set(resources.map(resource => {
    if (resource === "host" || resource === "browser" || resource === "none") return resource;
    if (resource.startsWith("site:")) {
      // A file of the hosted app draft that this request edits, e.g. site:index.html.
      const value = resource.slice(5).replace(/\/+$/, "");
      if (!value || value.length > 512 || value.startsWith("/") ||
          value.split("/").some(part => !part || part === "." || part === ".." || !/^[A-Za-z0-9._-]+$/.test(part)))
        throw new Error("A site resource names a relative app file, e.g. site:index.html");
      return "site:" + value;
    }
    if (!resource.startsWith("workspace:")) throw new Error("Use host, browser, site:<app file> or workspace:<absolute path>");
    let value = resource.slice(10).replaceAll("\\", "/");
    if (!value.startsWith("/") && !/^[a-z]:\//i.test(value)) throw new Error("A workspace resource must be absolute");
    if (value.split("/").some(part => part === ".." || part === ".") || value.length > 4096)
      throw new Error("Normalize the workspace path before reserving it");
    if (/^[a-z]:\//i.test(value) || value.startsWith("//")) value = value.toLowerCase();
    return "workspace:" + value.replace(/\/+$/, "");
  }).filter(resource => resource !== "none"))].sort();
}
export function workResourcesConflict(left: string[], right: string[]) {
  return left.some(a => right.some(b => a === "host" || b === "host" || a === b ||
    (((a.startsWith("workspace:") && b.startsWith("workspace:")) || (a.startsWith("site:") && b.startsWith("site:"))) &&
      (a.startsWith(b + "/") || b.startsWith(a + "/")))));
}
