import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ComputerRef } from "@mycellios/adapter-kit";
import { afterEach, beforeEach, expect, it } from "vitest";
import { HostComputerSandbox } from "./host-computer-sandbox.js";
import { startHostComputerServer } from "./host-computer-server.js";

const context = { operationId: "test", traceId: "test", spaceId: "test", userId: "test", signal: new AbortController().signal };
const token = "cd".repeat(32);
let root: string;
let server: Awaited<ReturnType<typeof startHostComputerServer>>;
let client: HostComputerSandbox;
let computer: ComputerRef;

beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), "rakazo-app-control-")));
  server = await startHostComputerServer({
    root,
    token,
    hostname: "127.0.0.1",
    // Never executed here: these tests cover admission, not the CLI.
    appControl: { binary: path.join(root, "missing.exe"), sha256: "0".repeat(64), stateDir: path.join(root, "state") },
  });
  client = new HostComputerSandbox(`http://127.0.0.1:${server.port}`, token);
  server.setEnabled(true);
  computer = await client.provision({ botId: "test-bot", homePath: "/unused" }, context);
});
afterEach(async () => {
  await server.close();
  await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
});

it("advertises and admits app control only after the owner's separate opt-in", async () => {
  expect(server.appControlAvailable()).toBe(true);
  expect((await client.environment(computer, context))?.appControl).toBeUndefined();
  expect(await client.appControl(computer, { op: "windows" }, context)).toMatchObject({ ok: false, code: "APP_CONTROL_OFF" });
  server.setAppControlAllowed(true);
  expect((await client.environment(computer, context))?.appControl).toBe(true);
  server.setAppControlAllowed(false);
  expect((await client.environment(computer, context))?.appControl).toBeUndefined();
});

it("never offers app control to isolated project conversations", async () => {
  server.setAppControlAllowed(true);
  const project = { ...context, projectSessionId: "project-1" };
  const result = await client.appControl(computer, { op: "windows" }, project).catch(() => undefined);
  expect(result === undefined || (result as { ok?: boolean }).ok === false).toBe(true);
});

it("rejects malformed requests before they reach the CLI", async () => {
  server.setAppControlAllowed(true);
  await expect(client.appControl(computer, { op: "act", ref: "--headed", action: "click" }, context)).rejects.toThrow();
});
