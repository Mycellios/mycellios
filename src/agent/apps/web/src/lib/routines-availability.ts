/** Temporary UI launch gate; does not alter saved routines or scheduled jobs. */
export function routinesAvailable(): boolean {
  return import.meta.env.VITE_MYCELLIOS_ROUTINES === "true";
}
