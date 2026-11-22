/**
 * Destinations that survive sign-in. Only fixed, first-party app paths are
 * accepted so a crafted `next` value can never redirect elsewhere.
 */
const DESTINATIONS = {
  "/integrations/setup": "/integrations/setup",
  "api-keys": "/app?settings=api-keys",
} as const;

export type SignInNext = keyof typeof DESTINATIONS;

/** The `next` value to carry through sign-in for a protected location, if any. */
export function signInNextFor(pathname: string, search: string): SignInNext | null {
  if (pathname === "/app" && new URLSearchParams(search).get("settings") === "api-keys") return "api-keys";
  return null;
}

/** Where a signed-in user lands for a `next` value; unknown values use the app. */
export function signInDestination(next: string | null): string {
  return next !== null && Object.hasOwn(DESTINATIONS, next)
    ? DESTINATIONS[next as SignInNext]
    : "/app";
}
