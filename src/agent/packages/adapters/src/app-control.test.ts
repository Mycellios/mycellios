import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { actionResult, appControlInvocation, appControlRequest, boundedTreeResult, failureResult, forbiddenApp } from "./app-control.js";
import { AppControlRunner, type AppControlExec } from "./app-control-runner.js";

const REF = "@s34h3jfj94wwtx:e1";

describe("app control requests", () => {
  it("accepts only snapshot-scoped refs, window ids and plain key combos", () => {
    expect(appControlRequest.safeParse({ op: "act", ref: REF, action: "click" }).success).toBe(true);
    for (const ref of ["@e1", "e1", "--headed", "@s34h3jfj94wwtx:e1 --headed"])
      expect(appControlRequest.safeParse({ op: "act", ref, action: "click" }).success).toBe(false);
    expect(appControlRequest.safeParse({ op: "snapshot", windowId: "--app" }).success).toBe(false);
    expect(appControlRequest.safeParse({ op: "press", windowId: "w-1", keys: "ctrl+s" }).success).toBe(true);
    expect(appControlRequest.safeParse({ op: "press", windowId: "w-1", keys: "ctrl+s --force" }).success).toBe(false);
    expect(appControlRequest.safeParse({ op: "windows", app: "-v" }).success).toBe(false);
  });

  it("sends text on stdin, never in arguments, and never asks for physical input", () => {
    const set = appControlInvocation({ op: "act", ref: REF, action: "set_value", text: "secret words" });
    expect(set).toEqual({ argv: ["set-value", REF, "--stdin"], stdin: "secret words" });
    const press = appControlInvocation({ op: "press", windowId: "w-7", keys: "ctrl+s" });
    expect(press.argv).toEqual(["press", "ctrl+s", "--window-id", "w-7"]);
    for (const invocation of [set, press, appControlInvocation({ op: "act", ref: REF, action: "click" })])
      expect(invocation.argv).not.toContain("--headed");
    expect(() => appControlInvocation({ op: "act", ref: REF, action: "set_value" })).toThrow();
    expect(() => appControlInvocation({ op: "act", ref: REF, action: "click", text: "x" })).toThrow();
  });

  it("refuses Mycellios, password managers and security prompts", () => {
    for (const app of ["Mycellios Desktop.exe", "1Password.exe", "KeePassXC.exe", "consent.exe", "SecurityAgent", "", undefined])
      expect(forbiddenApp(app)).toBe(true);
    for (const app of ["Notepad.exe", "chrome.exe", "Finder"]) expect(forbiddenApp(app)).toBe(false);
  });

  it("counts an action as done only when the application confirmed it", () => {
    const verified = { ok: true, data: { disposition: { delivery: "delivered_verified" }, details: {} } };
    expect(actionResult(verified)).toMatchObject({ ok: true, confirmed: true });
    const notCommitted = { ok: true, data: { disposition: { delivery: "delivered_verified" }, details: { application_commit: "not_verified" } } };
    expect(actionResult(notCommitted)).toMatchObject({ confirmed: false, note: expect.stringContaining("pc_snapshot") });
    expect(actionResult({ ok: true, data: { disposition: { delivery: "delivered_unverified" } } })).toMatchObject({ confirmed: false });
  });

  it("asks for a new snapshot after stale refs and keeps retry unsafe unless the CLI says otherwise", () => {
    expect(failureResult({ ok: false, error: { code: "STALE_REF", message: "gone" } })).toMatchObject({ code: "STALE_REF", newSnapshot: true, retry: "unsafe" });
  });

  it("bounds the tree returned to the model", () => {
    expect(boundedTreeResult({ tree: "x".repeat(60_000) })).toMatchObject({ ok: false, code: "TOO_LARGE" });
    expect(boundedTreeResult({ tree: "small" })).toEqual({ ok: true, data: { tree: "small" } });
  });
});

describe("app control runner", () => {
  const binary = new TextEncoder().encode("pinned binary");
  const sha256 = createHash("sha256").update(binary).digest("hex");
  const windows = [{ id: "w-1", app_name: "Notepad.exe", title: "notes" }, { id: "w-2", app_name: "1Password.exe", title: "vault" }];
  function runner(respond: (argv: string[]) => unknown, bytes = binary) {
    const exec = vi.fn<AppControlExec>(async (_file, argv) => JSON.stringify(respond(argv)));
    const instance = new AppControlRunner({ binary: "agent-desktop.exe", sha256, stateDir, exec, readBinary: async () => bytes });
    return { instance, exec };
  }
  const signal = new AbortController().signal;
  const stateDir = path.join(tmpdir(), "mycellios-app-control-test");
  const respond = (argv: string[]) =>
    argv[0] === "list-windows"
      ? { ok: true, data: windows }
      : argv[0] === "snapshot"
        ? { ok: true, data: { app: "Notepad.exe", snapshot_id: "s34h3jfj94wwtx", tree: {} } }
        : { ok: true, data: { disposition: { delivery: "delivered_verified" }, details: {} } };

  it("refuses to run a binary that does not match its pin", async () => {
    const { instance, exec } = runner(respond, new TextEncoder().encode("tampered"));
    await expect(instance.run({ op: "windows" }, signal)).rejects.toThrow(/integrity/);
    expect(exec).not.toHaveBeenCalled();
  });

  it("hides forbidden apps and refuses to read them", async () => {
    const { instance } = runner(respond);
    const listed = await instance.run({ op: "windows" }, signal);
    expect(JSON.stringify(listed)).not.toContain("1Password");
    expect(await instance.run({ op: "snapshot", windowId: "w-2" }, signal)).toMatchObject({ ok: false, code: "APP_NOT_ALLOWED" });
  });

  it("acts only on refs from its own snapshots and keeps state in the private folder", async () => {
    const { instance, exec } = runner(respond);
    expect(await instance.run({ op: "act", ref: REF, action: "click" }, signal)).toMatchObject({ code: "STALE_REF" });
    await instance.run({ op: "snapshot", windowId: "w-1" }, signal);
    expect(await instance.run({ op: "act", ref: REF, action: "click" }, signal)).toMatchObject({ ok: true, confirmed: true });
    const env = exec.mock.calls.at(-1)![2].env;
    expect(env.AGENT_DESKTOP_HOME).toBe(stateDir);
    expect(Object.keys(env).every((key) => !/TOKEN|KEY|SECRET|PASSWORD/i.test(key))).toBe(true);
  });
});

describe("app control pin", () => {
  it("matches the digest of the locked agent-desktop package", async () => {
    const { readFile } = await import("node:fs/promises");
    const { APP_CONTROL_BINARIES } = await import("./app-control-runner.js");
    const pin = APP_CONTROL_BINARIES["win32-x64"]!;
    const sidecar = path.resolve(import.meta.dirname, "../../../node_modules/agent-desktop/bin", `${pin.file}.sha256`);
    expect((await readFile(sidecar, "utf8")).trim().split(/\s+/)[0]).toBe(pin.sha256);
  });
});
