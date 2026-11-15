/** Store launch default; an operator may still explicitly pause it. */
export function hifaStoreEnabled(): boolean {
  return import.meta.env.VITE_MYCELLIOS_HIFA_STORE !== "false";
}
