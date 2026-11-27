import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { DesktopSandboxProvider } from "./desktop-sandbox.js";
import { HostComputerSandbox } from "./host-computer-sandbox.js";
import { startHostComputerServer } from "./host-computer-server.js";
import { isMissingPcWorkspaceError, PC_WORKSPACE_MISSING } from "./workspace-transfer.js";

const context = {
  operationId: "test",
  traceId: "test",
  spaceId: "test",
  userId: "test",
  signal: new AbortController().signal,
};
const bytes = new TextEncoder().encode("%PDF-1.4\nworkspace fixture");

it("does not mistake a file probe for a provisioned workspace", async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "desktop-recovery-")));
  const desktop = new DesktopSandboxProvider({ root });
  const ref = {
    id: "desktop-probe",
    botId: "probe",
    kind: "desktop" as const,
    providerRef: path.join(root, "desktop-computers", "probe"),
  };
  try {
    await expect(desktop.readFile(ref, "attachments/missing.pdf", context)).rejects.toThrow();
    expect(await desktop.isRunning(ref, context)).toBe(false);
    const computer = await desktop.provision({ botId: "probe", homePath: "" }, context);
    expect(computer.fresh).toBe(true);
    await desktop.writeFile(computer, { path: "attachments/sample.pdf", content: bytes });
    expect(await desktop.readFile(computer, "attachments/sample.pdf", context)).toEqual(bytes);
    const reused = await desktop.provision({ botId: "probe", homePath: "" }, context);
    expect(reused.fresh).toBe(false);
    expect(await desktop.readFile(reused, "attachments/sample.pdf", context)).toEqual(bytes);
  } finally {
    desktop.cancelAllCommands();
    await rm(root, { recursive: true, force: true });
  }
});

it("recreates a missing cached home without replacing another agent workspace", async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "desktop-recovery-")));
  const desktop = new DesktopSandboxProvider({ root });
  try {
    const first = await desktop.provision({ botId: "first", homePath: "" }, context);
    const other = await desktop.provision({ botId: "other", homePath: "" }, context);
    await desktop.writeFile(other, { path: "keep.txt", content: bytes });
    await rm(first.providerRef, { recursive: true });
    expect(await desktop.isRunning(first, context)).toBe(false);
    const recovered = await desktop.provision({ botId: "first", homePath: "" }, context);
    expect(recovered.fresh).toBe(true);
    expect(await desktop.isRunning(recovered, context)).toBe(true);
    await desktop.writeFile(recovered, { path: "attachments/sample.pdf", content: bytes });
    expect(await desktop.readFile(other, "keep.txt", context)).toEqual(bytes);
  } finally {
    desktop.cancelAllCommands();
    await rm(root, { recursive: true, force: true });
  }
});

it("recovers through the host transport and executes after transferring an attachment", async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "desktop-host-recovery-")));
  const token = "ab".repeat(32);
  const server = await startHostComputerServer({ root, token, hostname: "127.0.0.1" });
  server.setEnabled(true);
  const client = new HostComputerSandbox(`http://127.0.0.1:${server.port}`, token);
  const ref = {
    id: "opaque",
    botId: "probe",
    kind: "desktop" as const,
    providerRef: "host:opaque",
  };
  try {
    await expect(client.readFile(ref, "attachments/missing.pdf", context)).rejects.toThrow(
      "computer file not found",
    );
    expect(await client.isRunning(ref, context)).toBe(false);
    const computer = await client.provision({ botId: "probe", homePath: "" }, context);
    await client.writeFile(
      computer,
      { path: "bots/probe/attachments/sample.pdf", content: bytes },
      context,
    );
    expect(await client.readFile(computer, "bots/probe/attachments/sample.pdf", context)).toEqual(
      bytes,
    );
    const events = [];
    for await (const event of client.execute(
      computer,
      {
        argv: [
          process.execPath,
          "-e",
          "console.log(require('fs').readFileSync('bots/probe/attachments/sample.pdf','utf8').startsWith('%PDF'))",
        ],
        timeoutMs: 10000,
      },
      context,
    ))
      events.push(event);
    expect(events).toContainEqual({ type: "exit", code: 0 });
    expect(events.some((event) => event.type === "stdout" && event.data.includes("true"))).toBe(
      true,
    );
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
  }
});

it("reports a Mico folder this PC does not have as a missing workspace, not a missing file", async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "desktop-missing-workspace-")));
  const token = "cd".repeat(32);
  const server = await startHostComputerServer({ root, token, hostname: "127.0.0.1" });
  server.setEnabled(true);
  const client = new HostComputerSandbox(`http://127.0.0.1:${server.port}`, token);
  // A folder another PC made: its path does not exist here.
  const ref = {
    id: "elsewhere",
    botId: "elsewhere",
    kind: "desktop" as const,
    providerRef: path.join(root, "made-on-another-pc", "elsewhere"),
  };
  try {
    const copy = async () => {
      for await (const _file of client.exportWorkspace(ref, context)) void _file;
    };
    const error = await copy().then(() => undefined, (cause: unknown) => cause);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(PC_WORKSPACE_MISSING);
    expect(isMissingPcWorkspaceError(error)).toBe(true);
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});
