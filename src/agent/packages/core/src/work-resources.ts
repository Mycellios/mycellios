/** Resource names are coordination metadata, never a filesystem or permission grant. */
export function isMicoTaskThread(thread: { taskBotId?: string | null; projectKey?: string | null; taskKey?: string | null }) {
  return Boolean(thread.taskBotId && thread.projectKey === `mico:${thread.taskBotId}` &&
    thread.taskKey?.startsWith(`mico-task:${thread.taskBotId}:`));
}

export function nativeWorkProjectSession(
  thread: { id: string; taskBotId?: string | null; projectKey?: string | null; taskKey?: string | null },
  task: { delegationState?: string | null },
): string | undefined {
  // Internal delegated conversations use the Mico's existing workspace. Explicit
  // development projects retain the native binding and its independent admission.
  const internalWork = task.delegationState && thread.projectKey?.startsWith("work:") &&
    (thread.taskKey?.startsWith("delegation:") || thread.taskKey?.startsWith("work-transfer:"));
  return thread.taskBotId && !internalWork && !isMicoTaskThread(thread) ? thread.id : undefined;
}

export function normalizeWorkResources(resources: string[]): string[] {
  if (resources.length > 16) throw new Error("At most 16 resources may be reserved");
  return [...new Set(resources.map(resource => {
    if (resource === "host" || resource === "browser" || resource === "none") return resource;
    if (!resource.startsWith("workspace:")) throw new Error("Use host, browser or workspace:<absolute path>");
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
    (a.startsWith("workspace:") && b.startsWith("workspace:") && (a.startsWith(b + "/") || b.startsWith(a + "/")))));
}
