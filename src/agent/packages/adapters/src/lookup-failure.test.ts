import { describe, expect, it } from "vitest";
import { LookupStatusError, lookupFailureReason } from "./lookup-failure.js";

describe("lookupFailureReason", () => {
  it("reports an authority status without its body", () => {
    expect(lookupFailureReason(new LookupStatusError(503))).toBe("HTTP 503");
  });

  it("separates a timeout from a caller cancellation", () => {
    const timedOut = new AbortController();
    timedOut.abort(new DOMException("deadline", "TimeoutError"));
    expect(lookupFailureReason(new Error("aborted"), timedOut.signal)).toBe("timed out");
    const cancelled = new AbortController();
    cancelled.abort();
    expect(lookupFailureReason(new Error("aborted"), cancelled.signal)).toBe("cancelled");
  });

  it("names an errno code from the cause chain but never a network message", () => {
    const error = new Error("fetch failed", {
      cause: Object.assign(new Error("connect to https://secret.invalid?key=private"), {
        code: "ENOTFOUND",
      }),
    });
    expect(lookupFailureReason(error)).toBe("network ENOTFOUND");
  });

  it("falls back to the error class name only", () => {
    expect(lookupFailureReason(new TypeError("private key=secret"))).toBe(
      "lookup failure TypeError",
    );
    expect(lookupFailureReason(new SyntaxError("Unexpected token in private body"))).toBe(
      "invalid JSON",
    );
    expect(lookupFailureReason("private string")).toBe("lookup failure");
  });
});
