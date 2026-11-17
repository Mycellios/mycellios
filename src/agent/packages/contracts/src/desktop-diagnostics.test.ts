import { expect, it } from "vitest";
import {
  DESKTOP_FAILURE_CODES,
  desktopDiagnosticMessage,
  parseDesktopDiagnostic,
  desktopLegacyFailureCode,
} from "./desktop-diagnostics.js";
const operationId = "12345678-1234-4321-8765-123456789abc";
it.each(DESKTOP_FAILURE_CODES)(
  "round-trips the fixed reason %s without arbitrary error data",
  (code) => {
    expect(
      parseDesktopDiagnostic(
        desktopDiagnosticMessage({ code, phase: "callback", stage: "result_ack", operationId }),
      ),
    ).toEqual({ code, phase: "callback", stage: "result_ack", operationId });
  },
);
it("rejects forged suffixes and never copies unrecognized diagnostic input", () => {
  const message = desktopDiagnosticMessage({
    code: "desktop_disconnected",
    phase: "run",
    stage: "poll",
    operationId,
  });
  expect(parseDesktopDiagnostic(message + " password=secret")).toBeUndefined();
  expect(
    parseDesktopDiagnostic(message.replace("desktop_disconnected", "https://private.test")),
  ).toBeUndefined();
  expect(parseDesktopDiagnostic(message.replace(operationId, "token-secret"))).toBeUndefined();
  expect(desktopLegacyFailureCode("Bearer private-secret")).toBe("relay_stream_failure");
  expect(desktopLegacyFailureCode("toString")).toBe("relay_stream_failure");
  expect(desktopLegacyFailureCode("Desktop disconnected. Check results before retrying.")).toBe(
    "desktop_disconnected",
  );
});
