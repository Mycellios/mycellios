import { anySignal } from "@mycellios/core";

// Bound only the reads that gate first paint. Writes and event streams retain
// their own cancellation/timeout contracts; an expired read is never a sign-out.
export const STARTUP_READ_TIMEOUT_MS = 15_000;
const paths = ["/api/auth/get-session", "/rpc/bootstrap", "/rpc/spaces/list",
  "/rpc/bots/listArchived", "/rpc/groups/listArchived"];

export const startupFetch: typeof fetch = (input, init) => {
  const request = input instanceof Request ? input : null;
  const url = new URL(request?.url ?? String(input),
    typeof location === "undefined" ? "http://localhost" : location.origin);
  const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
  const bounded = paths.some(path => url.pathname.endsWith(path)) &&
    (url.pathname.endsWith("/api/auth/get-session") ? method === "GET" : method === "POST");
  if (!bounded) return fetch(input, init);
  const caller = init?.signal ?? request?.signal;
  const deadline = AbortSignal.timeout(STARTUP_READ_TIMEOUT_MS);
  return fetch(input, { ...init, signal: caller ? anySignal([caller, deadline]) : deadline });
};
