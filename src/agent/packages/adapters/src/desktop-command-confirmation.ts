import { setTimeout as delay } from "node:timers/promises";

/** How long a lost desktop stream may wait for a receipt that is already on the PC. */
export const COMMAND_RESULT_CONFIRM_MS = 15_000;

export const UNCONFIRMED_COMMAND_RESULT =
  "The command finished on the PC, but its result was not confirmed in time. Check the command output before running it again.";

const UNCONFIRMED_DELIVERY = [
  "Desktop execution interrupted",
  "Desktop execution disconnected",
  "Desktop operation interrupted",
  "Desktop delivery was interrupted",
  "Desktop command timed out",
  "Desktop response disconnected",
  "Desktop command cancelled",
  "Desktop executor unavailable",
  "Local computer disconnected",
  "Shell stream ended without a confirmed exit",
] as const;

const TERMINAL_STATES = new Set(["completed", "failed", "interrupted"]);

export type SavedCommandResult = {
  runId: string;
  state: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  stdoutTail?: string;
  stderrTail?: string;
  outputTruncated?: boolean;
};

export function isUnconfirmedCommandDelivery(error: unknown): boolean {
  if (!(error instanceof Error) || error.name === "AbortError") return false;
  return UNCONFIRMED_DELIVERY.some((prefix) => error.message === prefix || error.message.startsWith(`${prefix}`));
}

export function savedCommandResult(value: unknown): SavedCommandResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.runId !== "string" || typeof row.state !== "string") return null;
  if (row.exitCode !== null && (typeof row.exitCode !== "number" || !Number.isInteger(row.exitCode))) return null;
  if (typeof row.stdout !== "string" || typeof row.stderr !== "string") return null;
  return {
    runId: row.runId,
    state: row.state,
    exitCode: typeof row.exitCode === "number" ? row.exitCode : null,
    stdout: row.stdout,
    stderr: row.stderr,
    ...(typeof row.stdoutTail === "string" ? { stdoutTail: row.stdoutTail } : {}),
    ...(typeof row.stderrTail === "string" ? { stderrTail: row.stderrTail } : {}),
    ...(row.outputTruncated === true ? { outputTruncated: true } : {}),
  };
}

export function commandResultText(result: Pick<SavedCommandResult, "stdout" | "stderr" | "stdoutTail" | "stderrTail" | "outputTruncated">): { stdout: string; stderr: string } {
  const withTail = (body: string, tail?: string) => result.outputTruncated && tail ? `${body}\n[retained tail]\n${tail}` : body;
  return { stdout: withTail(result.stdout, result.stdoutTail), stderr: withTail(result.stderr, result.stderrTail) };
}

function savedReceipts(value: unknown): SavedCommandResult[] {
  const rows = Array.isArray(value) ? value : [value];
  return rows.flatMap((row) => {
    const receipt = savedCommandResult(row);
    return receipt ? [receipt] : [];
  });
}

function terminalReceipt(receipts: readonly SavedCommandResult[], runId: string): SavedCommandResult | undefined {
  return receipts.find((receipt) => receipt.runId === runId && typeof receipt.exitCode === "number" && TERMINAL_STATES.has(receipt.state));
}

/**
 * Read a command receipt that the PC already saved. A lost observer never re-executes the command.
 * The timeout bounds this wait only; the operating-system process keeps its own deadline.
 */
export async function confirmDesktopCommandResult(options: {
  runId: string;
  toolName: string;
  commandId: string;
  startedAt: number;
  read: () => Promise<unknown>;
  signal: AbortSignal;
  timeoutMs?: number;
  log?: (event: string, fields: Record<string, string | number | undefined>) => void;
  now?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}): Promise<
  | { confirmed: true; code: number; stdout: string; stderr: string }
  | { confirmed: false; error: string }
> {
  const timeoutMs = options.timeoutMs ?? COMMAND_RESULT_CONFIRM_MS;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms, signal) => delay(ms, undefined, { signal }));
  const log = options.log ?? (() => undefined);
  const started = now();
  while (now() - started <= timeoutMs) {
    if (options.signal.aborted) {
      const reason = options.signal.reason;
      throw reason instanceof Error ? reason : new Error("The command confirmation was aborted");
    }
    try {
      const receipt = terminalReceipt(savedReceipts(await options.read()), options.runId);
      if (receipt && typeof receipt.exitCode === "number") {
        const text = commandResultText(receipt);
        log("desktop.command.result_confirmed", {
          "run.id": options.runId,
          "tool.name": options.toolName,
          "desktop.command.id": options.commandId,
          "desktop.elapsed_ms": now() - options.startedAt,
          "desktop.exit_code": receipt.exitCode,
        });
        return { confirmed: true, code: receipt.exitCode, stdout: text.stdout, stderr: text.stderr };
      }
    } catch (error) {
      if (options.signal.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
    }
    const remaining = timeoutMs - (now() - started);
    if (remaining <= 0) break;
    await sleep(Math.min(200, remaining), options.signal);
  }
  log("desktop.command.result_unconfirmed", {
    "run.id": options.runId,
    "tool.name": options.toolName,
    "desktop.command.id": options.commandId,
    "desktop.elapsed_ms": now() - options.startedAt,
  });
  return { confirmed: false, error: UNCONFIRMED_COMMAND_RESULT };
}
