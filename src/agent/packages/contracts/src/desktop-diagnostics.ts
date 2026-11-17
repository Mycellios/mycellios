/** Bounded diagnostic metadata. Never put request data or exception messages here. */
export const DESKTOP_FAILURE_CODES = [
  "desktop_disconnected",
  "desktop_busy",
  "desktop_connection_changed",
  "desktop_request_too_large",
  "delivery_lost",
  "native_transport_interrupted",
  "native_session_missing",
  "native_host_failure",
  "access_revoked",
  "project_revoked",
  "command_cancelled",
  "command_timeout",
  "dispatch_timeout",
  "response_disconnected",
  "result_buffer_exceeded",
  "relay_restarted",
  "relay_stream_failure",
  "stream_incomplete",
  "invalid_frame",
  "callback_drain_timeout",
] as const;
export type DesktopFailureCode = (typeof DESKTOP_FAILURE_CODES)[number];
export const DESKTOP_DIAGNOSTIC_STAGES = [
  "dispatch",
  "native_request",
  "native_stream",
  "result_ack",
  "poll",
  "callback_drain",
] as const;
export type DesktopDiagnosticStage = (typeof DESKTOP_DIAGNOSTIC_STAGES)[number];
export type DesktopFailureDiagnostic = {
  code: DesktopFailureCode;
  phase: "run" | "callback";
  stage: DesktopDiagnosticStage;
  operationId?: string;
};
export const DESKTOP_INTERRUPTED_MESSAGE =
  "Desktop execution interrupted; check existing results before retrying";
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function desktopOperationId(value: unknown): string | undefined {
  return typeof value === "string" && uuid.test(value) ? value.toLowerCase() : undefined;
}
export function desktopDiagnosticRunId(value: unknown): string | undefined {
  return typeof value === "string" && (/^c[a-z0-9]{24,31}$/.test(value) || uuid.test(value))
    ? value
    : undefined;
}
export function desktopFailureCode(value: unknown): DesktopFailureCode | undefined {
  return DESKTOP_FAILURE_CODES.find((code) => code === value);
}
export function desktopDiagnosticStage(value: unknown): DesktopDiagnosticStage | undefined {
  return DESKTOP_DIAGNOSTIC_STAGES.find((stage) => stage === value);
}
/** Existing error storage is text; encode only fixed words and an optional UUID. */
export function desktopDiagnosticMessage(value: DesktopFailureDiagnostic): string {
  return `${DESKTOP_INTERRUPTED_MESSAGE} [desktop:${desktopFailureCode(value.code) ?? "relay_stream_failure"}:${value.phase === "callback" ? "callback" : "run"}:${desktopDiagnosticStage(value.stage) ?? "native_stream"}:${desktopOperationId(value.operationId) ?? "none"}]`;
}
export function parseDesktopDiagnostic(value: string): DesktopFailureDiagnostic | undefined {
  if (value.length > 400 || !value.startsWith(`${DESKTOP_INTERRUPTED_MESSAGE} [desktop:`)) return;
  const match = /^\[desktop:([a-z_]+):(run|callback):([a-z_]+):([a-f0-9-]+|none)\]$/.exec(
    value.slice(DESKTOP_INTERRUPTED_MESSAGE.length + 1),
  );
  if (!match) return;
  const code = desktopFailureCode(match[1]),
    stage = desktopDiagnosticStage(match[3]);
  const operationId = desktopOperationId(match[4]);
  if (!code || !stage || (match[4] !== "none" && !operationId)) return;
  return {
    code,
    phase: match[2] as "run" | "callback",
    stage,
    ...(operationId ? { operationId } : {}),
  };
}

const legacyCodes: Record<string, DesktopFailureCode> = {
  "Desktop disconnected. Check results before retrying.": "desktop_disconnected",
  "Local computer access was revoked.": "access_revoked",
  "Project access was revoked.": "project_revoked",
  "Desktop command cancelled. Check results before retrying.": "command_cancelled",
  "Desktop command timed out. Check results before retrying.": "command_timeout",
  "The PC request timed out before dispatch. No command was started.": "dispatch_timeout",
  "Desktop response disconnected. Check results before retrying.": "response_disconnected",
  "Desktop result exceeded its buffer": "result_buffer_exceeded",
  "Desktop relay restarted. Check results before retrying.": "relay_restarted",
  "Desktop delivery was interrupted. Check results before retrying.": "delivery_lost",
  "Desktop operation interrupted. Check results before retrying.": "native_transport_interrupted",
  "Local computer operation failed": "native_host_failure",
};
export function desktopLegacyFailureCode(message: unknown): DesktopFailureCode {
  return typeof message === "string" && Object.hasOwn(legacyCodes, message)
    ? legacyCodes[message]!
    : "relay_stream_failure";
}
