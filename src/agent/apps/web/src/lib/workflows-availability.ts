/** On unless an operator pauses the UI; saved workflows and backend execution are never touched. */
export function workflowsAvailable(): boolean {
  return import.meta.env.VITE_MYCELLIOS_WORKFLOWS !== "false";
}
