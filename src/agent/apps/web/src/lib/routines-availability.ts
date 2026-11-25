/** On unless an operator pauses the UI; saved routines and scheduled jobs are never touched. */
export function routinesAvailable(): boolean {
  return import.meta.env.VITE_MYCELLIOS_ROUTINES !== "false";
}
