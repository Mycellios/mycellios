/** A private preview is not enabled by including its sources in a public release. */
export function privateAppsEnabled(production: boolean, operatorOptIn?: string): boolean {
  return !production || operatorOptIn === "1";
}

/** The qualified fixed Video Studio is released independently of private previews.
 * This availability switch never grants account, Space or computer access. */
export function videoStudioEnabled(operatorSetting?: string): boolean {
  return operatorSetting === undefined || operatorSetting === "1";
}
