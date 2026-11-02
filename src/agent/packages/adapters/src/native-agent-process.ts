import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";

export interface NativeCommand {
  command: string;
  args?: string[];
}
export type WireMessage = {
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: unknown;
};

export function nativeEnvironment(source = process.env): NodeJS.ProcessEnv {
  return Object.fromEntries(
    [
      "PATH",
      "Path",
      "HOME",
      "USERPROFILE",
      "APPDATA",
      "LOCALAPPDATA",
      "SystemRoot",
      "WINDIR",
      "TEMP",
      "TMP",
      "TMPDIR",
      "LANG",
      "LC_ALL",
      "PATHEXT",
    ].flatMap((key) => (source[key] === undefined ? [] : [[key, source[key]]])),
  );
}

export function findNativeCommand(
  name: "codex" | "claude",
  env = process.env,
): NativeCommand | null {
  const paths = (env.PATH ?? env.Path ?? "").split(delimiter).filter(isAbsolute);
  const home = env.USERPROFILE ?? env.HOME;
  if (home) paths.push(join(home, ".local", "bin"));
  for (const dir of paths) {
    const file = join(dir, process.platform === "win32" ? `${name}.exe` : name);
    if (existsSync(file)) return { command: file };
  }
  // npm's Windows .cmd shim cannot be executed without a shell. Run its fixed JS entry instead.
  if (process.platform === "win32" && env.APPDATA) {
    const file = join(
      env.APPDATA,
      "npm",
      "node_modules",
      name === "codex" ? "@openai/codex/bin/codex.js" : "@anthropic-ai/claude-code/cli.js",
    );
    if (existsSync(file)) return { command: process.execPath, args: [file] };
  }
  return null;
}

export class NativeEventQueue<T> implements AsyncIterable<T> {
  private values: T[] = [];
  private wake?: () => void;
  private ended = false;
  private failure?: Error;
  push(value: T) {
    if (this.ended) return;
    if (this.values.length >= 4096) {
      this.fail(new Error("Native agent event buffer exceeded its limit"));
      return;
    }
    this.values.push(value);
    this.wake?.();
  }
  end() {
    this.ended = true;
    this.wake?.();
  }
  fail(error: Error) {
    if (this.ended) return;
    this.failure = error;
    this.end();
  }
  async *[Symbol.asyncIterator]() {
    for (;;) {
      const value = this.values.shift();
      if (value !== undefined) {
        yield value;
        continue;
      }
      if (this.failure) throw this.failure;
      if (this.ended) return;
      await new Promise<void>((resolve) => {
        this.wake = resolve;
      });
      this.wake = undefined;
    }
  }
}

/** Owns one child and its descendants; never shells out to interpret an agent command. */
export class NativeAgentProcess {
  readonly child: ChildProcessWithoutNullStreams;
  readonly closed: Promise<void>;
  private sequence = 0;
  private pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private failure?: Error;
  private buffer = "";
  private stopping?: Promise<void>;
  constructor(
    command: NativeCommand,
    args: string[],
    cwd: string,
    onMessage: (message: WireMessage) => void,
    onFailure: (error: Error) => void,
  ) {
    if (!isAbsolute(command.command))
      throw new Error("A native agent command must be an absolute path");
    this.child = spawn(command.command, [...(command.args ?? []), ...args], {
      cwd,
      env: { ...nativeEnvironment(), ELECTRON_RUN_AS_NODE: "1" },
      stdio: "pipe",
      windowsHide: true,
      detached: process.platform !== "win32",
    });
    this.closed = new Promise((resolve) => {
      this.child.once("close", () => resolve());
    });
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.resume(); // CLI diagnostics may contain credentials; never forward them.
    this.child.stdin.on("error", (error) => this.fail(error, onFailure));
    this.child.on("error", () =>
      this.fail(new Error("Could not start the native agent. Check its installation."), onFailure),
    );
    this.child.on("close", (code) => {
      if (!this.stopping)
        this.fail(
          new Error(`Native agent exited before completion (${code ?? "signal"})`),
          onFailure,
        );
      this.rejectPending(new Error("Native agent process closed"));
    });
    this.child.stdout.on("data", (chunk: string) => {
      this.buffer += chunk;
      if (this.buffer.length > 8 * 1024 * 1024) {
        this.fail(new Error("Native agent protocol line is too large"), onFailure);
        return;
      }
      for (;;) {
        const end = this.buffer.indexOf("\n");
        if (end < 0) break;
        const line = this.buffer.slice(0, end);
        this.buffer = this.buffer.slice(end + 1);
        if (!line.trim()) continue;
        try {
          const message = JSON.parse(line) as WireMessage;
          if (typeof message.id === "number" && !message.method && this.pending.has(message.id)) {
            const waiter = this.pending.get(message.id)!;
            this.pending.delete(message.id);
            clearTimeout(waiter.timer);
            if (message.error)
              waiter.reject(new Error("Native agent rejected the protocol request"));
            else waiter.resolve(message.result);
          } else onMessage(message);
        } catch {
          this.fail(new Error("Native agent returned an invalid protocol message"), onFailure);
        }
      }
    });
  }
  send(message: unknown) {
    if (!this.failure && !this.child.stdin.destroyed)
      this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }
  request<T>(method: string, params: unknown, timeoutMs = 30000): Promise<T> {
    if (this.failure) return Promise.reject(this.failure);
    const id = ++this.sequence;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Native agent request timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }
  private rejectPending(error: Error) {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
  }
  private fail(error: Error, onFailure: (error: Error) => void) {
    if (this.failure) return;
    this.failure = error;
    this.rejectPending(error);
    onFailure(error);
    void this.stop();
  }
  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.stopping = (async () => {
      const pid = this.child.pid;
      if (pid && this.child.exitCode === null && this.child.signalCode === null) {
        if (process.platform === "win32") {
          await new Promise<void>((resolve) =>
            execFile(
              join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe"),
              ["/PID", String(pid), "/T", "/F"],
              { windowsHide: true },
              () => resolve(),
            ),
          );
        } else {
          try {
            process.kill(-pid, "SIGTERM");
          } catch {
            this.child.kill();
          }
        }
      }
      const timer = setTimeout(() => {
        if (pid && process.platform !== "win32") {
          try {
            process.kill(-pid, "SIGKILL");
          } catch {
            /* already closed */
          }
        }
      }, 2000);
      await this.closed;
      clearTimeout(timer);
      this.rejectPending(new Error("Native agent stopped"));
    })();
    return this.stopping;
  }
}
