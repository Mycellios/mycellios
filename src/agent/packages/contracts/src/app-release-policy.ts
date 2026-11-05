/** A private preview is not enabled by including its sources in a public release. */
export function privateAppsEnabled(production: boolean, operatorOptIn?: string): boolean {
  return !production || operatorOptIn === "1";
}
