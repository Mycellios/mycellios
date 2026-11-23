/** An authority answered a lookup with this HTTP status. The body is never kept. */
export class LookupStatusError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
    this.name = "LookupStatusError";
  }
}

const ERRNO_CODE = /^[A-Z][A-Z0-9_]{1,40}$/;

/**
 * Why an authority lookup failed, as a fixed phrase that is safe to log. Provider bodies,
 * headers, URLs and network messages can carry credentials, so only the HTTP status, an
 * errno-style code or the error class name is ever reported.
 */
export function lookupFailureReason(error: unknown, signal?: AbortSignal): string {
  if (error instanceof LookupStatusError) return `HTTP ${error.status}`;
  if (signal?.aborted)
    return (signal.reason as { name?: unknown } | undefined)?.name === "TimeoutError"
      ? "timed out"
      : "cancelled";
  if (!(error instanceof Error)) return "lookup failure";
  if (error.name === "ZodError") return "invalid response";
  if (error instanceof SyntaxError) return "invalid JSON";
  let current: unknown = error;
  for (let depth = 0; current instanceof Error && depth < 5; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && ERRNO_CODE.test(code)) return `network ${code}`;
    current = current.cause;
  }
  return /^[A-Za-z]{1,40}$/.test(error.name) ? `lookup failure ${error.name}` : "lookup failure";
}
