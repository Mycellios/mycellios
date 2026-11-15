/** Temporary UI launch gate; preserves saved workflows and backend execution. */
export function workflowsAvailable(): boolean {
  return import.meta.env.VITE_MYCELLIOS_WORKFLOWS === "true";
}
