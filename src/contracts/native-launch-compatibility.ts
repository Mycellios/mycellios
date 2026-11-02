/** First release whose sealed Python launch options accept operationTimeoutSeconds. */
export const MINIMUM_NATIVE_LAUNCH_VERSION = "0.2.80";

/** Tunnel protocol identity alone does not guarantee Python launch-option compatibility. */
export function supportsCurrentNativeLaunch(version: string | undefined): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:\+[A-Za-z0-9.-]+)?$/.exec(version ?? "");
  if (!match) return false;
  const [major, minor, patch] = match.slice(1).map(Number);
  if (![major, minor, patch].every(Number.isSafeInteger)) return false;
  return major! > 0 || minor! > 2 || (minor === 2 && patch! >= 80);
}
