/** Temporary launch gate. Preserve the Store implementation for explicit reactivation. */
export function hifaStoreEnabled(): boolean {
  return import.meta.env.VITE_MYCELLIOS_HIFA_STORE === "true";
}
