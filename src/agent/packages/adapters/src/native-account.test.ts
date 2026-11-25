import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nativeEngineAccount, resetNativeAccountLogins, terminalLaunch } from "./native-account.js";
import { nativeSignInState, resetNativeSignInCache } from "./native-signin.js";

const fixture = fileURLToPath(new URL("./fixtures/native-agent.mjs", import.meta.url));
const codex = (...flags: string[]) => ({ command: process.execPath, args: [fixture, "codex", ...flags] });
const protocolLog = async () => join(await mkdtemp(join(tmpdir(), "native-account-")), "protocol.log");
const until = async (check: () => Promise<boolean>) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error("condition not reached");
};

afterEach(async () => {
  await resetNativeAccountLogins();
  resetNativeSignInCache();
});

describe("Codex sign-in", () => {
  it("opens the CLI's own HTTPS sign-in page and closes the CLI once the sign-in completes", async () => {
    const log = await protocolLog();
    const openExternal = vi.fn(async () => undefined);
    const command = codex("--fixture-login-completes", "--protocol-log", log);
    await expect(nativeEngineAccount({ action: "signIn", engine: "codex", flow: "browser" }, command, { openExternal }))
      .resolves.toEqual({ status: "browser" });
    expect(openExternal).toHaveBeenCalledWith("https://auth.example.test/start?state=synthetic");
    await until(async () => (await readFile(log, "utf8")).includes("account/login/start"));
    // The completed login is never cancelled: only the start and the handshake reached the CLI.
    await new Promise(resolve => setTimeout(resolve, 100));
    expect((await readFile(log, "utf8")).trim().split("\n")).toEqual(["initialize", "initialized", "account/login/start"]);
  });

  it("returns a device code for another device and keeps the login open for it", async () => {
    const result = await nativeEngineAccount({ action: "signIn", engine: "codex", flow: "device" }, codex(), {});
    expect(result).toEqual({ status: "device", userCode: "ABCD-1234", verificationUrl: "https://auth.example.test/device" });
  });

  it("cancels the previous login before starting another one", async () => {
    const log = await protocolLog();
    const command = codex("--protocol-log", log);
    await nativeEngineAccount({ action: "signIn", engine: "codex", flow: "device" }, command, {});
    await nativeEngineAccount({ action: "signIn", engine: "codex", flow: "device" }, command, {});
    await until(async () => (await readFile(log, "utf8")).includes("account/login/cancel"));
  });

  it("refuses a sign-in page that is not HTTPS and never opens it", async () => {
    const openExternal = vi.fn(async () => undefined);
    await expect(nativeEngineAccount({ action: "signIn", engine: "codex", flow: "browser" },
      codex("--fixture-http-login"), { openExternal })).rejects.toThrow("not HTTPS");
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("needs a browser for the browser flow", async () => {
    await expect(nativeEngineAccount({ action: "signIn", engine: "codex", flow: "browser" }, codex(), {}))
      .rejects.toThrow("cannot open its browser");
  });

  it("signs out through the app server and asks the CLI again afterwards", async () => {
    const log = await protocolLog();
    const command = codex("--protocol-log", log);
    const probe = vi.fn(async () => true);
    expect(await nativeSignInState("codex", command, { probe })).toBe(true);
    await expect(nativeEngineAccount({ action: "signOut", engine: "codex" }, command, {})).resolves.toEqual({ status: "signedOut" });
    expect(await readFile(log, "utf8")).toContain("account/logout");
    probe.mockResolvedValueOnce(false);
    expect(await nativeSignInState("codex", command, { probe })).toBe(false);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("says when the CLI is not installed", async () => {
    await expect(nativeEngineAccount({ action: "signIn", engine: "codex", flow: "device" }, null, {}))
      .rejects.toThrow("Codex is not installed on this PC.");
  });
});

describe("Claude Code sign-in", () => {
  it("opens a terminal on the PC with the CLI's own login", async () => {
    const launch = vi.fn();
    const command = { command: process.execPath, args: [fixture, "claude"] };
    await expect(nativeEngineAccount({ action: "signIn", engine: "claude", flow: "browser" }, command,
      { launch, platform: "win32" })).resolves.toEqual({ status: "terminal" });
    expect(launch).toHaveBeenCalledTimes(1);
    const [file, args, options] = launch.mock.calls[0]!;
    expect(file).toMatch(/cmd\.exe$/i);
    expect(options).toEqual({ verbatim: true });
    expect(args[0]).toContain(`"${process.execPath}" "${fixture}" "claude" "auth" "login"`);
  });

  it("cannot give a code to another device", async () => {
    const launch = vi.fn();
    await expect(nativeEngineAccount({ action: "signIn", engine: "claude", flow: "device" },
      { command: process.execPath, args: [fixture, "claude"] }, { launch })).rejects.toThrow("signs in on the PC");
    expect(launch).not.toHaveBeenCalled();
  });
});

describe("terminalLaunch", () => {
  const argv = ["/opt/cli/claude", "auth", "login"];

  it("quotes each part for cmd.exe on Windows", () => {
    const launch = terminalLaunch(["C:\\Program Files\\Claude\\claude.exe", "auth", "login"], "win32", { SystemRoot: "C:\\Windows" });
    expect(launch?.file).toMatch(/^C:\\Windows[\\/]System32[\\/]cmd\.exe$/);
    expect(launch?.args).toEqual(["/d /c start \"Sign in\" \"C:\\Program Files\\Claude\\claude.exe\" \"auth\" \"login\""]);
    expect(launch?.verbatim).toBe(true);
  });

  it("asks Terminal to run the shell-quoted command on macOS", () => {
    const launch = terminalLaunch(["/Users/someone/it's/claude", "auth", "login"], "darwin");
    expect(launch?.file).toBe("/usr/bin/osascript");
    expect(launch?.args[1]).toBe(`tell application "Terminal" to do script "'/Users/someone/it'\\\\''s/claude' 'auth' 'login'"`);
  });

  it("uses the first terminal it finds on Linux", () => {
    const exists = (file: string) => file === "/usr/bin/xterm";
    expect(terminalLaunch(argv, "linux", { PATH: "/usr/local/bin:/usr/bin" }, exists))
      .toEqual({ file: "/usr/bin/xterm", args: ["-e", ...argv], verbatim: false });
    expect(terminalLaunch(argv, "linux", { PATH: "/usr/bin" }, () => false)).toBeNull();
  });

  it("refuses relative commands and characters a shell could read as syntax", () => {
    expect(terminalLaunch(["claude", "auth", "login"], "linux", { PATH: "/usr/bin" }, () => true)).toBeNull();
    for (const part of ["a\"b", "50%", "a&b", "a|b", "a^b", "line\nbreak", "$(id)"])
      expect(terminalLaunch(["/opt/cli/claude", part], "win32")).toBeNull();
  });
});
