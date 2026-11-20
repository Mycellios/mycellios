import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  APP_CONTROL_MAX_OUTPUT_BYTES,
  APP_CONTROL_TIMEOUT_MS,
  type AppControlRequest,
  type AppControlResult,
  AppControlInputError,
  actionResult,
  appControlInvocation,
  boundedTreeResult,
  failureResult,
  forbiddenApp,
  parseEnvelope,
  snapshotIdOfRef,
} from "./app-control.js";

/** Pinned agent-desktop 1.3.1 (Apache-2.0). Bytes are verified before every call. */
export const APP_CONTROL_BINARIES: Readonly<Record<string, { file: string; sha256: string }>> = {
  "win32-x64": {
    file: "agent-desktop-win32-x64.exe",
    sha256: "a7ef5e539fb97287a35eb9ed49d3803b4d6bd705bc4106eb28617229f9be679e",
  },
};

export function appControlBinary(platform: string, arch: string) {
  return APP_CONTROL_BINARIES[`${platform}-${arch}`];
}

export type AppControlExec = (
  file: string,
  args: string[],
  options: { stdin?: string; env: NodeJS.ProcessEnv; signal: AbortSignal },
) => Promise<string>;

const execCli: AppControlExec = (file, args, options) =>
  new Promise((resolve, reject) => {
    const child = execFile(
      file,
      args,
      {
        env: options.env,
        signal: options.signal,
        timeout: APP_CONTROL_TIMEOUT_MS,
        maxBuffer: APP_CONTROL_MAX_OUTPUT_BYTES,
        windowsHide: true,
        encoding: "utf8",
      },
      (error, stdout) => {
        // The CLI exits non-zero with a JSON error envelope; keep that envelope.
        if (stdout && stdout.trim()) resolve(stdout);
        else reject(error ?? new Error("agent-desktop returned no result"));
      },
    );
    child.stdin?.end(options.stdin ?? "");
  });

/** Snapshots this host returned, so a ref can be traced to the application it belongs to. */
const MAX_SNAPSHOTS = 64;

export class AppControlRunner {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly snapshots = new Map<string, string>();

  constructor(
    private readonly options: {
      binary: string;
      sha256: string;
      /**
       * Private state folder; the CLI otherwise writes desktop content to the user's home. The CLI
       * creates it with an owner-only ACL and refuses a folder that inherited broader access.
       */
      stateDir: string;
      exec?: AppControlExec;
      readBinary?: (file: string) => Promise<Uint8Array>;
    },
  ) {}

  /** One call at a time: actions on a desktop must not interleave. */
  run(request: AppControlRequest, signal: AbortSignal): Promise<AppControlResult> {
    const next = this.queue.then(() => this.runOne(request, signal));
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async runOne(request: AppControlRequest, signal: AbortSignal): Promise<AppControlResult> {
    signal.throwIfAborted();
    let invocation;
    try {
      invocation = appControlInvocation(request);
    } catch (error) {
      if (error instanceof AppControlInputError) return { ok: false, code: "INVALID_ARGS", error: error.message };
      throw error;
    }
    if (request.op === "act") {
      const app = this.snapshots.get(snapshotIdOfRef(request.ref));
      if (!app)
        return {
          ok: false,
          code: "STALE_REF",
          error: "This ref does not come from a current pc_snapshot. Take a new snapshot and use its refs.",
          newSnapshot: true,
        };
      if (forbiddenApp(app)) return refused();
    }
    if (request.op === "press" || request.op === "snapshot") {
      const owner = await this.windowApp(request.windowId, signal);
      if (owner === undefined)
        return { ok: false, code: "WINDOW_NOT_FOUND", error: "That window is not open. Call pc_windows again." };
      if (forbiddenApp(owner)) return refused();
    }
    const envelope = parseEnvelope(await this.call(invocation.argv, invocation.stdin, signal));
    if (envelope.ok !== true) return failureResult(envelope);
    switch (request.op) {
      case "windows":
        return { ok: true, data: visibleWindows(envelope.data) };
      case "snapshot": {
        const data = envelope.data as { app?: unknown; snapshot_id?: unknown } | undefined;
        if (forbiddenApp(data?.app)) return refused();
        if (typeof data?.snapshot_id === "string") this.remember(data.snapshot_id, String(data.app));
        return boundedTreeResult(data);
      }
      default:
        return actionResult(envelope);
    }
  }

  private remember(snapshotId: string, app: string) {
    this.snapshots.delete(snapshotId);
    this.snapshots.set(snapshotId, app);
    while (this.snapshots.size > MAX_SNAPSHOTS) this.snapshots.delete(this.snapshots.keys().next().value!);
  }

  private async windowApp(windowId: string, signal: AbortSignal): Promise<string | undefined> {
    const envelope = parseEnvelope(await this.call(["list-windows"], undefined, signal));
    if (envelope.ok !== true || !Array.isArray(envelope.data)) return undefined;
    const match = envelope.data.find(
      (window: unknown) => (window as { id?: unknown } | null)?.id === windowId,
    ) as { app_name?: unknown } | undefined;
    return match ? String(match.app_name ?? "") : undefined;
  }

  private async call(argv: string[], stdin: string | undefined, signal: AbortSignal) {
    const bytes = await (this.options.readBinary ?? readFile)(this.options.binary);
    if (createHash("sha256").update(bytes).digest("hex") !== this.options.sha256)
      throw new Error("The app control component failed its integrity check.");
    return (this.options.exec ?? execCli)(this.options.binary, argv, {
      ...(stdin === undefined ? {} : { stdin }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(APP_CONTROL_TIMEOUT_MS)]),
      env: minimalEnvironment(this.options.stateDir),
    });
  }
}

function refused(): AppControlResult {
  return {
    ok: false,
    code: "APP_NOT_ALLOWED",
    error: "Micos cannot operate this application (Mycellios itself, password managers or system security prompts).",
  };
}

/** Forbidden applications are not listed at all. */
function visibleWindows(data: unknown) {
  if (!Array.isArray(data)) return [];
  return data
    .filter((window) => !forbiddenApp((window as { app_name?: unknown } | null)?.app_name))
    .slice(0, 100)
    .map((window) => {
      const { id, app_name, title, is_focused, minimized } = window as Record<string, unknown>;
      return { id, app: app_name, title: typeof title === "string" ? title.slice(0, 200) : "", focused: is_focused === true, minimized: minimized === true };
    });
}

/** No account, provider or host credentials reach the CLI. */
function minimalEnvironment(stateDir: string): NodeJS.ProcessEnv {
  const keep = ["SystemRoot", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "PATH", "Path", "HOME", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "DISPLAY", "XDG_RUNTIME_DIR"];
  const env: NodeJS.ProcessEnv = {};
  for (const key of keep) if (process.env[key] !== undefined) env[key] = process.env[key];
  env.AGENT_DESKTOP_HOME = stateDir;
  return env;
}
