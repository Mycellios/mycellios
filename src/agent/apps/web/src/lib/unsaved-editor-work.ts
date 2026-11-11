const pending = new Set<string>();
const guard = (event: BeforeUnloadEvent) => {
  if (pending.size) event.preventDefault();
};
/** Independent editors must not clear another screen's update/reload protection. */
export function setUnsavedEditorWork(key: string, value: boolean) {
  if (value) pending.add(key);
  else pending.delete(key);
  if (typeof window !== "undefined") {
    window.removeEventListener("beforeunload", guard);
    if (pending.size) window.addEventListener("beforeunload", guard);
  }
}
export const hasUnsavedEditorWork = () => pending.size > 0;
