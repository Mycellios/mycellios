import { expect, it } from "vitest";
import { desktopDiagnosticMessage, DESKTOP_FAILURE_CODES } from "@mycellios/contracts";
import {
  DESKTOP_OWNER_UNRESOLVED_ERROR,
  DESKTOP_RUN_INTERRUPTED_ERROR,
  DESKTOP_UNREACHABLE_ERROR,
  desktopSetupInterruptedMessage,
  desktopRunDiagnosticText,
  isInterruptedRunError,
  isUncertainDesktopRun,
  normalizeRunError,
  RUN_INTERRUPTED_BY_MAINTENANCE_ERROR,
  userRunError,
} from "./run-error.js";
const operationId = "12345678-1234-4321-8765-123456789abc";
it.each(DESKTOP_FAILURE_CODES)(
  "keeps %s uncertain and preserves its safe diagnostic through storage",
  (code) => {
    const message = desktopDiagnosticMessage({
      code,
      phase: "run",
      stage: "native_stream",
      operationId,
    });
    expect(userRunError(Error(message))).toBe(message);
    expect(isUncertainDesktopRun(message)).toBe(true);
    expect(normalizeRunError(message)).toMatchObject({
      kind: "interrupted",
      // A deploy restarting the relay names the update instead of the person's PC.
      summary: code === "relay_restarted"
        ? "Mycellios restarted for an update while this turn was running. Review what it already did before continuing."
        : "Desktop could not confirm the result. Review what it already did before continuing.",
    });
    expect(
      JSON.parse(desktopRunDiagnosticText(message, "cm00000000000000000000001")!),
    ).toMatchObject({
      runId: "cm00000000000000000000001",
      operationId,
      code,
      outcome: "unconfirmed",
    });
  },
);
it("copies only fixed legacy information and rejects arbitrary provider errors", () => {
  expect(desktopRunDiagnosticText("password=secret", "cm00000000000000000000001")).toBeUndefined();
  const value = desktopRunDiagnosticText(
    "Desktop execution interrupted; check existing results before retrying",
    "https://private.test",
  )!;
  expect(JSON.parse(value)).toMatchObject({ runId: null, code: "unknown_legacy_interruption" });
  expect(value).not.toContain("private.test");
});

it("reports a computer setup failure after Desktop dispatch as an uncertain interruption", () => {
  const message = desktopSetupInterruptedMessage("Local computer request is too large.");
  expect(message).toBe(
    "Desktop turn interrupted while preparing its computer: Local computer request is too large. Check what the Mico already did, then send a new message.",
  );
  expect(isUncertainDesktopRun(message)).toBe(true);
  expect(userRunError(Error(message))).toBe(message);
  expect(normalizeRunError(message)).toMatchObject({ kind: "interrupted" });
});

it("tells an infrastructure interruption from a model or owner failure", () => {
  const transport = desktopDiagnosticMessage({ code: "native_transport_interrupted", phase: "run", stage: "native_stream", operationId });
  expect(isInterruptedRunError(transport)).toBe(true);
  expect(isInterruptedRunError(DESKTOP_RUN_INTERRUPTED_ERROR)).toBe(true);
  expect(isInterruptedRunError(RUN_INTERRUPTED_BY_MAINTENANCE_ERROR)).toBe(true);
  expect(isInterruptedRunError(DESKTOP_UNREACHABLE_ERROR)).toBe(true);
  for (const failure of [null, "", DESKTOP_OWNER_UNRESOLVED_ERROR, "429: rate limited", "The model returned an unusable response."])
    expect(isInterruptedRunError(failure)).toBe(false);
});
