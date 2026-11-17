import { appendFile, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  desktopDiagnosticRunId,
  desktopDiagnosticStage,
  desktopFailureCode,
  desktopOperationId,
} from "@rakazo/contracts";

const EVENTS = [
  "startup",
  "previous_unclean_exit",
  "heartbeat",
  "quit",
  "suspend",
  "resume",
  "renderer_exit",
  "child_exit",
  "main_failure",
  "relay_connected",
  "relay_poll_failed",
  "relay_http_failure",
  "relay_expired",
  "relay_stopped",
  "operation_received",
  "operation_native_started",
  "operation_confirmed",
  "operation_failed",
  "delivery_lost",
  "update_started",
] as const;
type Event = (typeof EVENTS)[number];
const EXIT_REASONS = [
  "clean-exit",
  "abnormal-exit",
  "killed",
  "crashed",
  "oom",
  "launch-failed",
  "integrity-failure",
  "memory-eviction",
];
const ERROR_CODES = [
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ABORT_ERR",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
];
const ERROR_NAMES = [
  "Error",
  "TypeError",
  "RangeError",
  "SyntaxError",
  "AbortError",
  "TimeoutError",
];

/** Preserve the native failure category, never a URL, command, body or raw exception text. */
export function desktopExceptionFields(error: unknown): Record<string, unknown> {
  try {
    const e = error as { name?: unknown; code?: unknown; cause?: { code?: unknown } } | null;
    return {
      errorName: ERROR_NAMES.find((name) => name === e?.name) ?? "Error",
      errorCode: ERROR_CODES.find((code) => code === e?.code || code === e?.cause?.code),
    };
  } catch {
    return { errorName: "Error" };
  }
}

function safeFields(value: Record<string, unknown>) {
  const result: Record<string, string | number | boolean> = {};
  const code = desktopFailureCode(value.code),
    stage = desktopDiagnosticStage(value.stage),
    operationId = desktopOperationId(value.operationId);
  if (code) result.code = code;
  if (stage) result.stage = stage;
  if (operationId) result.operationId = operationId;
  const runId = desktopDiagnosticRunId(value.runId);
  if (runId) result.runId = runId;
  if (
    typeof value.method === "string" &&
    [
      "agentRun",
      "agentMessage",
      "execute",
      "environment",
      "isRunning",
      "readFile",
      "writeFile",
      "listFiles",
      "abort",
      "status",
    ].includes(value.method)
  )
    result.method = value.method;
  for (const key of ["elapsedMs", "lastSequence", "httpStatus", "active", "exitCode", "gapMs"])
    if (
      typeof value[key] === "number" &&
      Number.isSafeInteger(value[key]) &&
      Math.abs(value[key]) <= Number.MAX_SAFE_INTEGER
    )
      result[key] = value[key];
  if (typeof value.claimed === "boolean") result.claimed = value.claimed;
  if (typeof value.reason === "string" && EXIT_REASONS.includes(value.reason))
    result.reason = value.reason;
  if (typeof value.errorName === "string" && ERROR_NAMES.includes(value.errorName))
    result.errorName = value.errorName;
  if (typeof value.errorCode === "string" && ERROR_CODES.includes(value.errorCode))
    result.errorCode = value.errorCode;
  return result;
}

/** Local metadata journal. Its failures and bounds must never block execution. */
export class DesktopDiagnostics {
  private pending: string[] = [];
  private writing?: Promise<void>;
  private failures = 0;
  private dropped = 0;
  private recent: object[] = [];
  private markerWrites = Promise.resolve();
  private markerPending = false;
  private closed = false;
  private timer?: ReturnType<typeof setInterval>;
  private readonly file: string;
  private readonly marker: string;
  private readonly version: string;
  private readonly platform: string;
  constructor(
    private readonly directory: string,
    options: { version: string; platform: string; maxBytes?: number; maxPending?: number },
  ) {
    this.version = /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]{1,60})?$/.test(options.version)
      ? options.version
      : "unknown";
    this.platform = ["win32", "darwin", "linux"].includes(options.platform)
      ? options.platform
      : "unknown";
    this.maxBytes = Math.max(256, Math.min(options.maxBytes ?? 1024 * 1024, 1024 * 1024));
    this.maxPending = Math.max(1, Math.min(options.maxPending ?? 128, 128));
    this.file = path.join(directory, "desktop.ndjson");
    this.marker = path.join(directory, "session.json");
  }
  private readonly maxBytes: number;
  private readonly maxPending: number;
  async start() {
    this.record("startup");
    try {
      const previous = JSON.parse(await this.readBounded(this.marker, 1024));
      if (this.closed) return;
      if (
        previous.clean === false &&
        typeof previous.lastSeen === "number" &&
        Number.isFinite(previous.lastSeen)
      )
        this.record("previous_unclean_exit", {
          gapMs: Math.max(0, Date.now() - previous.lastSeen),
        });
    } catch {
      /* First start or unavailable marker; never infer a crash from absence. */
    }
    if (this.closed) return;
    void this.mark(false);
    this.timer = setInterval(() => {
      this.record("heartbeat");
      void this.mark(false);
    }, 60_000);
    this.timer.unref();
  }
  record(event: Event, fields: Record<string, unknown> = {}) {
    try {
      if (!EVENTS.includes(event)) return;
      if (this.closed) return;
      const value = {
        timestamp: new Date().toISOString(),
        event,
        version: this.version,
        platform: this.platform,
        ...safeFields(fields),
      };
      this.recent.push(value);
      if (this.recent.length > 100) this.recent.shift();
      if (this.pending.length >= this.maxPending) {
        this.dropped++;
        return;
      }
      this.pending.push(JSON.stringify(value) + "\n");
      if (!this.writing) {
        this.writing = this.drain().finally(() => {
          this.writing = undefined;
        });
      }
    } catch {
      this.failures++;
    }
  }
  private async privatePath(file: string) {
    try {
      if ((await lstat(file)).isSymbolicLink()) throw Error("Unsafe diagnostic file");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  private async drain() {
    while (this.pending.length) {
      const lines = this.pending.splice(0, 32).join("");
      try {
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        await this.privatePath(this.file);
        await this.privatePath(`${this.file}.1`);
        let size = await lstat(this.file).then(
          (s) => s.size,
          (e) => {
            if (e.code === "ENOENT") return 0;
            throw e;
          },
        );
        let batch = "";
        const append = async () => {
          if (!batch) return;
          const bytes = Buffer.byteLength(batch);
          if (size + bytes > this.maxBytes) {
            await rm(`${this.file}.1`, { force: true });
            if (size) await rename(this.file, `${this.file}.1`);
            size = 0;
          }
          await appendFile(this.file, batch, { encoding: "utf8", mode: 0o600 });
          size += bytes;
          batch = "";
        };
        for (const line of lines.trimEnd().split("\n")) {
          const bytes = Buffer.byteLength(line + "\n");
          if (bytes > this.maxBytes) {
            this.dropped++;
            continue;
          }
          if (Buffer.byteLength(batch) + bytes > this.maxBytes) await append();
          batch += line + "\n";
        }
        await append();
      } catch {
        this.failures++;
      }
    }
  }
  async flush() {
    await this.writing;
  }
  private mark(clean: boolean) {
    if (!clean && this.markerPending) return this.markerWrites;
    this.markerPending = true;
    this.markerWrites = this.markerWrites
      .then(async () => {
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        await this.privatePath(this.marker);
        await writeFile(
          this.marker,
          JSON.stringify({ clean, lastSeen: Date.now(), version: this.version }),
          { mode: 0o600 },
        );
      })
      .catch(() => {
        this.failures++;
      })
      .finally(() => {
        this.markerPending = false;
      });
    return this.markerWrites;
  }
  private async readBounded(file: string, max: number) {
    await this.privatePath(file);
    if ((await lstat(file)).size > max) throw Error("Diagnostic limit");
    const value = await readFile(file, "utf8");
    if (Buffer.byteLength(value) > max) throw Error("Diagnostic limit");
    return value;
  }
  async snapshot() {
    await this.flush();
    const records: object[] = [];
    for (const file of [`${this.file}.1`, this.file]) {
      try {
        for (const line of (await this.readBounded(file, this.maxBytes)).split("\n")) {
          try {
            const v = JSON.parse(line);
            if (
              EVENTS.includes(v.event) &&
              typeof v.timestamp === "string" &&
              /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v.timestamp)
            )
              records.push({ timestamp: v.timestamp, event: v.event, ...safeFields(v) });
          } catch {
            /* A crash may leave a partial last line. */
          }
        }
      } catch {
        /* Recent memory still provides a diagnostic when disk is unavailable. */
      }
    }
    const unique = new Map<string, object>();
    for (const record of [...records, ...this.recent]) {
      const v = record as Record<string, unknown>;
      const safe = { timestamp: v.timestamp, event: v.event, ...safeFields(v) };
      unique.set(JSON.stringify(safe), safe);
    }
    const events = [...unique.values()].sort((a, b) =>
      String((a as { timestamp: string }).timestamp).localeCompare(
        String((b as { timestamp: string }).timestamp),
      ),
    );
    const counts: Record<string, number> = {};
    for (const event of events) {
      const key = (event as { event: string }).event;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return {
      schema: "mycellios-desktop-diagnostics/1",
      version: this.version,
      platform: this.platform,
      writeFailures: this.failures,
      dropped: this.dropped,
      counts,
      events: events.slice(-100),
    };
  }
  async copyText() {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const partial = new Promise<object>((resolve) => {
        timer = setTimeout(
          () =>
            resolve({
              schema: "mycellios-desktop-diagnostics/1",
              version: this.version,
              platform: this.platform,
              state: "partial",
              writeFailures: this.failures,
              dropped: this.dropped,
              events: [...this.recent],
            }),
          1_000,
        );
      });
      return JSON.stringify(await Promise.race([this.snapshot(), partial]), null, 2);
    } finally {
      clearTimeout(timer);
    }
  }
  async close() {
    if (this.closed) return;
    clearInterval(this.timer);
    this.record("quit");
    this.closed = true;
    await this.mark(true);
    await this.flush();
  }
}

let current: DesktopDiagnostics | undefined;
export function startDesktopDiagnostics(profile: string, version: string, platform: string) {
  current = new DesktopDiagnostics(path.join(profile, "logs", "diagnostics"), {
    version,
    platform,
  });
  void current.start();
  return current;
}
export function recordDesktopDiagnostic(event: Event, fields?: Record<string, unknown>) {
  current?.record(event, fields);
}
export async function desktopDiagnosticsText() {
  return current
    ? current.copyText()
    : JSON.stringify({ schema: "mycellios-desktop-diagnostics/1", state: "unavailable" });
}
