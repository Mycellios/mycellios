import type { FastifyInstance } from "fastify";

type DiagnosticLogger = Pick<FastifyInstance["log"], "info" | "warn"> | null;

export interface RuntimeStreamRecoveryReport {
  sendOffset: number;
  acknowledgedOffset: number;
  receiveOffset: number;
  bufferedFromOffset: number;
}

export interface RuntimeStreamTerminalDiagnostic {
  type: "runtime.stream.end" | "runtime.stream.error";
  originWorkerId: string;
  reason?: string;
}

interface StreamDiagnosticContext {
  streamId: string; sourceNodeId: string | null; destinationNodeId: string;
  transportMode: string; createdAt: number;
  bytesSourceToDestination: number; bytesDestinationToSource: number;
}

/** Metadata only: never include an envelope, recovery credential or token bytes. */
export function logRuntimeStreamTermination(logger: DiagnosticLogger, session: StreamDiagnosticContext,
  message?: string, terminal?: RuntimeStreamTerminalDiagnostic): void {
  const failed = Boolean(message) || terminal?.type === "runtime.stream.error";
  if (!failed && (session.sourceNodeId === null || Date.now() - session.createdAt < 30_000)) return;
  const diagnostic = {
    streamId: session.streamId, sourceNodeId: session.sourceNodeId,
    destinationNodeId: session.destinationNodeId, transportMode: session.transportMode,
    originWorkerId: terminal?.originWorkerId ?? null, terminalType: terminal?.type ?? null,
    reason: (message ?? terminal?.reason ?? "stream-ended").replace(/[\x00-\x1f\x7f]/g, " ").slice(0, 256),
    lifetimeMs: Math.max(0, Date.now() - session.createdAt),
    bytesSourceToDestination: session.bytesSourceToDestination,
    bytesDestinationToSource: session.bytesDestinationToSource,
  };
  // A diagnostic sink must not interrupt stream disposal or peer notification.
  try {
    if (failed) logger?.warn(diagnostic, "runtime stream terminated");
    else logger?.info(diagnostic, "runtime stream terminated");
  } catch { /* Existing transport lifecycle remains authoritative. */ }
}

export function logDuplicateWorkerHello(logger: DiagnosticLogger, workerId: string, identityKind: string | null): void {
  try { logger?.warn({ workerId, identityKind }, "duplicate worker hello rejected"); }
  catch { /* Logging must not affect rejection of a duplicate connection. */ }
}

export function runtimeStreamReportEquals(
  left: RuntimeStreamRecoveryReport,
  right: RuntimeStreamRecoveryReport,
): boolean {
  return (
    left.sendOffset === right.sendOffset
    && left.acknowledgedOffset === right.acknowledgedOffset
    && left.receiveOffset === right.receiveOffset
    && left.bufferedFromOffset === right.bufferedFromOffset
  );
}
