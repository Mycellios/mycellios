import { expect, it } from "vitest";
import { desktopDiagnosticMessage, DESKTOP_FAILURE_CODES } from "@rakazo/contracts";
import {
  desktopRunDiagnosticText,
  isUncertainDesktopRun,
  normalizeRunError,
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
      summary:
        "Desktop could not confirm the result. Review what it already did before continuing.",
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
