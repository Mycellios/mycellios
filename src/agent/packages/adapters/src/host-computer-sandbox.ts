import type {
  AdapterContext,
  CommandRequest,
  ComputerFileEntry,
  ComputerRef,
  PortableFile,
  ProcessEvent,
  SandboxProvider,
  WorkspaceDirectoryRequest,
} from "@rakazo/adapter-kit";
import { boundedSandboxCommandTimeoutMs } from "@rakazo/core";
import { describeDesktopSandbox } from "./desktop-sandbox.js";
import type {
  HostComputerEnvironment,
  HostComputerFrame,
  HostComputerRequest,
} from "./host-computer-protocol.js";
import {
  HOST_COMPUTER_MAX_BYTES,
  HOST_COMPUTER_MAX_FILE_BYTES,
  hostComputerDeadlineMs,
} from "./host-computer-protocol.js";

/** Authenticated native host transport. Commands are never retried after a lost response. */
export class HostComputerSandbox implements SandboxProvider {
  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly transport?: (input: HostComputerRequest, context: AdapterContext) => Promise<Response>,
  ) {}
  describe() {
    return describeDesktopSandbox();
  }

  private async *request<T>(input: HostComputerRequest, context: AdapterContext): AsyncIterable<T> {
    input = { ...input, botId: context.botId ?? input.botId, ...(context.projectSessionId?{projectSessionId:context.projectSessionId}:{}) };
    if ((!this.url || !this.token) && !this.transport)
      throw new Error("Local computer access requires the desktop app. Enable it in the app menu.");
    const body = JSON.stringify({ ...input, runId: context.runId });
    if (Buffer.byteLength(body) > HOST_COMPUTER_MAX_BYTES)
      throw new Error("Local computer request is too large");
    const signal = AbortSignal.any([
      context.signal,
      AbortSignal.timeout(hostComputerDeadlineMs(input)),
    ]);
    const response = this.transport ? await this.transport({ ...input, runId: context.runId }, { ...context, signal }) : await fetch(new URL("/computer", this.url), {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body,
      signal,
      redirect: "error",
    });
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new Error(
        response.headers.get("x-mycellios-desktop-error") === "desktop_disconnected"
          ? "The paired PC is disconnected. Start Mycellios Desktop on that computer."
          : response.headers.get("x-mycellios-desktop-error") === "desktop_connection_changed"
            ? "The PC connection changed during this run. Check existing results before starting a new request."
            : response.status === 429
              ? "The PC request queue is full. Wait for current work to finish; this operation was not dispatched."
              : response.status === 413
                ? "The PC request is too large. This operation was not dispatched."
                : response.status === 401 || response.status === 403
                  ? "Local computer access is unavailable: the Desktop session or computer permission was refused. Check Mycellios Desktop."
                  : "The PC bridge could not accept this operation. Check the PC connection and existing results before retrying.",
      );
    }
    const reader = response.body.getReader();
    const abort = () => {
      void reader.cancel(signal.reason).catch(() => undefined);
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    const decoder = new TextDecoder();
    let pending = "";
    try {
      while (true) {
        signal.throwIfAborted();
        const chunk = await reader.read();
        signal.throwIfAborted();
        if (chunk.done) break;
        pending += decoder.decode(chunk.value, { stream: true });
        let newline = pending.indexOf("\n");
        while (newline !== -1) {
          signal.throwIfAborted();
          if (newline > HOST_COMPUTER_MAX_BYTES)
            throw new Error("Local computer response is too large");
          const frame = JSON.parse(pending.slice(0, newline)) as HostComputerFrame<T>;
          pending = pending.slice(newline + 1);
          if ("error" in frame) throw new Error(frame.error);
          if ("heartbeat" in frame) {
            newline = pending.indexOf("\n");
            continue;
          }
          if ("done" in frame) {
            return;
          }
          yield frame.value;
          newline = pending.indexOf("\n");
        }
        if (pending.length > HOST_COMPUTER_MAX_BYTES)
          throw new Error("Local computer response is too large");
      }
      throw new Error("Local computer disconnected. Check the result before retrying.");
    } finally {
      signal.removeEventListener("abort", abort);
      const cancellation = reader.cancel().catch(() => undefined);
      if (!signal.aborted) await cancellation;
      reader.releaseLock();
    }
  }
  private async one<T>(input: HostComputerRequest, context: AdapterContext): Promise<T> {
    let result: T | undefined;
    for await (const value of this.request<T>(input, context)) result = value;
    return result as T;
  }
  environment(computer: ComputerRef, context: AdapterContext) {
    return this.one<HostComputerEnvironment>(
      { method: "environment", botId: computer.botId },
      context,
    );
  }
  commandStatus(computer: ComputerRef, commandId: string | undefined, context: AdapterContext) {
    return this.one({ method: "commandStatus", botId: computer.botId, commandId }, context);
  }
  provision(input: { botId: string; homePath: string }, context: AdapterContext) {
    return this.one<ComputerRef>({ method: "provision", botId: input.botId }, context);
  }
  async prepare(computer: ComputerRef, context: AdapterContext) {
    await this.one({ method: "prepare", botId: computer.botId }, context);
  }
  isRunning(computer: ComputerRef, context: AdapterContext) {
    return this.one<boolean>({ method: "isRunning", botId: computer.botId }, context);
  }
  execute(computer: ComputerRef, command: CommandRequest, context: AdapterContext) {
    return this.request<ProcessEvent>(
      {
        method: "execute",
        botId: computer.botId,
        command: { ...command, timeoutMs: boundedSandboxCommandTimeoutMs(command.timeoutMs) },
      },
      context,
    );
  }
  workspaceDirectories(
    computer: ComputerRef,
    directories: WorkspaceDirectoryRequest,
    context: AdapterContext,
  ) {
    return this.one<string[]>(
      { method: "workspaceDirectories", botId: computer.botId, directories },
      context,
    );
  }
  async cancelRunWork(
    computer: ComputerRef,
    _computerId: string,
    runId: string,
    context: AdapterContext,
  ) {
    await this.one({ method: "cancelRunWork", botId: computer.botId, targetRunId: runId }, context);
  }
  listFiles(computer: ComputerRef, path: string, context: AdapterContext) {
    return this.one<ComputerFileEntry[]>(
      { method: "listFiles", botId: computer.botId, path },
      context,
    );
  }
  async readFile(
    computer: ComputerRef,
    path: string,
    context: AdapterContext,
    options?: { maxBytes?: number },
  ) {
    const content = await this.one<string>(
      {
        method: "readFile",
        botId: computer.botId,
        path,
        maxBytes: Math.min(
          options?.maxBytes ?? HOST_COMPUTER_MAX_FILE_BYTES,
          HOST_COMPUTER_MAX_FILE_BYTES,
        ),
      },
      context,
    );
    return new Uint8Array(Buffer.from(content, "base64"));
  }
  async writeFile(computer: ComputerRef, file: PortableFile, context: AdapterContext) {
    await this.one(
      {
        method: "writeFile",
        botId: computer.botId,
        file: { ...file, content: Buffer.from(file.content).toString("base64") },
      },
      context,
    );
  }
  async *exportWorkspace(
    computer: ComputerRef,
    context: AdapterContext,
  ): AsyncIterable<PortableFile> {
    for await (const file of this.request<{ path: string; content: string; executable?: boolean }>(
      { method: "exportWorkspace", botId: computer.botId },
      context,
    )) {
      yield { ...file, content: new Uint8Array(Buffer.from(file.content, "base64")) };
    }
  }
  async importWorkspace(
    computer: ComputerRef,
    files: AsyncIterable<PortableFile>,
    context: AdapterContext,
  ) {
    for await (const file of files) await this.writeFile(computer, file, context);
  }
  snapshot(computer: ComputerRef, context: AdapterContext) {
    return this.one<{ id: string; createdAt: string }>(
      { method: "snapshot", botId: computer.botId },
      context,
    );
  }
  async stop(computer: ComputerRef, context: AdapterContext) {
    await this.one({ method: "stop", botId: computer.botId }, context);
  }
  async destroy(computer: ComputerRef, context: AdapterContext) {
    await this.one({ method: "destroy", botId: computer.botId }, context);
  }
  async connectScreen(): Promise<never> {
    throw new Error(
      "Local screen control is unavailable. Use commands to work with files and apps.",
    );
  }
  async sendInput(): Promise<never> {
    throw new Error("Local screen control is unavailable");
  }
  async observe(): Promise<never> {
    throw new Error("Local screen control is unavailable");
  }
  async act(): Promise<never> {
    throw new Error("Local screen control is unavailable");
  }
}
