import { ComputerUpdatingError } from "./computer-errors.js";
import type {
  AdapterContext,
  CommandRequest,
  ComputerFileEntry,
  ComputerRef,
  PortableFile,
  ProcessEvent,
  SandboxProvider,
  WorkspaceDirectoryRequest,
} from "@mycellios/adapter-kit";
import { boundedSandboxCommandTimeoutMs } from "@mycellios/core";
import { getLogger } from "@mycellios/logging";
import { describeDesktopSandbox } from "./desktop-sandbox.js";
import { projectLeaseOwner } from "./project-execution.js";
import type {
  HostComputerEnvironment,
  HostComputerFrame,
  HostComputerRequest,
} from "./host-computer-protocol.js";
import {
  HOST_COMPUTER_MAX_BYTES,
  HOST_COMPUTER_MAX_FILE_BYTES,
  HOST_COMPUTER_MAX_WORKSPACE_FILE_BYTES,
  hostComputerDeadlineMs,
} from "./host-computer-protocol.js";
import {
  isWorkspaceTransferExcluded,
  workspaceTransferDigest,
  workspaceTransferPieces,
} from "./workspace-transfer.js";

/** How long a completed result waits for the transport to close on its own. */
export const HOST_COMPUTER_COMPLETION_DRAIN_MS = 10_000;

async function drainCompletedResponse(reader: ReadableStreamDefaultReader<Uint8Array>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<undefined>((resolve) => {
    timer = setTimeout(resolve, HOST_COMPUTER_COMPLETION_DRAIN_MS, undefined);
  });
  try {
    while (true) {
      const next = await Promise.race([reader.read(), expired]);
      if (!next || next.done) return;
    }
  } catch {
    // The result is already complete; a late transport error cannot change it.
  } finally {
    clearTimeout(timer);
  }
}

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
    if (["stop", "destroy", "cancelRunWork"].includes(input.method) && context.botId) {
      const owner = projectLeaseOwner(context.botId);
      if (owner) {
        if (context.projectSessionId && context.projectSessionId !== owner.projectSessionId)
          throw new Error("The cleanup belongs to another project conversation.");
        context = { ...context, ...owner };
      }
    }
    // The name travels only with its own Mico id; the PC uses it to name a new folder.
    const botName = context.botId ? context.botName?.trim().slice(0, 200) : undefined;
    input = { ...input, botId: context.botId ?? input.botId, ...(botName ? { botName } : {}), ...(context.projectSessionId?{projectSessionId:context.projectSessionId}:{}) };
    if ((!this.url || !this.token) && !this.transport)
      throw new Error("Local computer access requires the desktop app. Enable it in the app menu.");
    const ownedInput = { ...input, ...(context.runId ? { runId: context.runId } : {}) };
    const body = JSON.stringify(ownedInput);
    if (Buffer.byteLength(body) > HOST_COMPUTER_MAX_BYTES)
      throw new Error("Local computer request is too large");
    const signal = AbortSignal.any([
      context.signal,
      AbortSignal.timeout(hostComputerDeadlineMs(input)),
    ]);
    const response = this.transport ? await this.transport(ownedInput, { ...context, signal }) : await fetch(new URL("/computer", this.url), {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body,
      signal,
      redirect: "error",
    });
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      if (response.headers.get("x-mycellios-desktop-error") === "desktop_updating") {
        context.onComputerUpdate?.(false);
        throw new ComputerUpdatingError(false);
      }
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
          if ("error" in frame) {
            if ("code" in frame && frame.code === "desktop_updating") {
              context.onComputerUpdate?.(frame.dispatched !== false);
              throw new ComputerUpdatingError(frame.dispatched !== false);
            }
            throw new Error(frame.error);
          }
          if ("heartbeat" in frame) {
            newline = pending.indexOf("\n");
            continue;
          }
          if ("done" in frame) {
            // The relay ends the response only after the PC acknowledges its final
            // chunk. Closing earlier reads as a cancellation and drops that
            // acknowledgement, so a complete result is drained, never cancelled.
            await drainCompletedResponse(reader);
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
  appControl(computer: ComputerRef, request: Record<string, unknown>, context: AdapterContext) {
    // The host validates the request shape; the server only forwards it.
    return this.one<unknown>(
      { method: "appControl", botId: computer.botId, request } as unknown as HostComputerRequest,
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
  /** Sends one file larger than a single request as ordered, checksummed pieces. */
  private async writeFileInPieces(computer: ComputerRef, file: PortableFile, context: AdapterContext) {
    const sha256 = workspaceTransferDigest(file.content);
    for (const piece of workspaceTransferPieces(file.content))
      await this.one(
        {
          method: "writeFileChunk",
          botId: computer.botId,
          file: {
            path: file.path,
            offset: piece.offset,
            size: file.content.byteLength,
            sha256,
            content: Buffer.from(piece.content).toString("base64"),
            ...(file.executable ? { executable: true } : {}),
          },
        },
        context,
      );
  }
  /**
   * Seeds a PC workspace from the server copy. Excluded paths never travel and large
   * files move in pieces when the PC supports them. A refused file (such as a path
   * outside the workspace) still aborts the copy so it can be retried.
   */
  async importWorkspace(
    computer: ComputerRef,
    files: AsyncIterable<PortableFile>,
    context: AdapterContext,
  ) {
    let chunkedWrites: boolean | undefined;
    const skipped = { excluded: 0, tooLarge: 0 };
    for await (const file of files) {
      if (isWorkspaceTransferExcluded(file.path)) {
        skipped.excluded++;
        continue;
      }
      if (file.content.byteLength <= HOST_COMPUTER_MAX_FILE_BYTES) {
        await this.writeFile(computer, file, context);
        continue;
      }
      chunkedWrites ??=
        (await this.environment(computer, context).catch(() => undefined))?.chunkedWrites === true;
      if (!chunkedWrites || file.content.byteLength > HOST_COMPUTER_MAX_WORKSPACE_FILE_BYTES) {
        skipped.tooLarge++;
        continue;
      }
      await this.writeFileInPieces(computer, file, context);
    }
    if (skipped.excluded || skipped.tooLarge)
      getLogger().warn("computer.workspace_import_skipped", {
        "workspace.skipped.excluded": skipped.excluded,
        "workspace.skipped.too_large": skipped.tooLarge,
      });
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
