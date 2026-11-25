import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { posix, win32 } from "node:path";
import type { NativeEngineAccountRequest, NativeEngineAccountResult } from "@mycellios/contracts";
import { NativeEngineAccountResultSchema } from "@mycellios/contracts";
import type { NativeCommand } from "./native-agent-process.js";
import { NativeAgentProcess, nativeCommandAvailable, nativeEnvironment } from "./native-agent-process.js";
import { forgetNativeSignIn, watchNativeSignIn } from "./native-signin.js";

/**
 * Signs the PC's own CLIs in and out for the person (specs/native-engines/spec.md phase 1).
 * The CLI keeps its credential store and receives the provider's callback itself: nothing
 * here reads, copies or logs a token, an account or a sign-in page address. Only a device
 * code, which the person must type elsewhere, leaves this module.
 */

/** How long a started sign-in waits for the person before its CLI process is closed. */
export const NATIVE_SIGN_IN_WINDOW_MS = 10 * 60_000;
const REQUEST_MS = 15_000;
const NAMES = { codex: "Codex", claude: "Claude Code" } as const;

export type NativeAccountHost = {
  /** Opens an https page in the PC's default browser; Desktop passes its shell. */
  openExternal?: (url: string) => Promise<void>;
  /** Starts a detached program (a terminal window); tests replace it. */
  launch?: (file: string, args: string[], options: { verbatim: boolean }) => void;
  now?: () => number;
  /** Tests only: the platform whose terminal opens. */
  platform?: NodeJS.Platform;
};

type Login = { child: NativeAgentProcess; loginId: string; timer: ReturnType<typeof setTimeout> };
const logins = new Map<string, Login>();
const loginKey = (engine: string, command: NativeCommand) =>
  JSON.stringify([engine, command.command, command.args ?? []]);

/** Ends a pending Codex sign-in, cancelling it in the CLI unless it already completed. */
async function endLogin(key: string, cancel = true) {
  const login = logins.get(key);
  if (!login) return;
  logins.delete(key);
  clearTimeout(login.timer);
  if (cancel && login.loginId)
    await login.child.request("account/login/cancel", { loginId: login.loginId }, 3_000).catch(() => undefined);
  await login.child.stop().catch(() => undefined);
}

function httpsPage(value: unknown) {
  if (typeof value !== "string" || value.length > 4096) throw new Error("The CLI did not return a sign-in page.");
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("The CLI did not return a sign-in page."); }
  if (url.protocol !== "https:") throw new Error("The CLI returned a sign-in page that is not HTTPS.");
  return url.toString();
}

async function startCodexApp(command: NativeCommand, onMessage: (message: { method?: string }) => void,
  onFailure: () => void) {
  const child = new NativeAgentProcess(command, ["app-server", "-c", "mcp_servers={}"], homedir(), onMessage, onFailure);
  try {
    await child.request("initialize", { clientInfo: { name: "mycellios-sign-in", version: "0.1.0" },
      capabilities: { experimentalApi: true } }, REQUEST_MS);
    child.send({ method: "initialized", params: {} });
    return child;
  } catch (error) {
    await child.stop().catch(() => undefined);
    throw error;
  }
}

async function codexSignIn(command: NativeCommand, flow: "browser" | "device", host: NativeAccountHost) {
  if (flow === "browser" && !host.openExternal) throw new Error("This PC cannot open its browser for you.");
  const key = loginKey("codex", command);
  // One sign-in at a time: the CLI's callback listener and device code belong to one login.
  await endLogin(key);
  const now = host.now ?? Date.now;
  let login: Login | undefined;
  const child = await startCodexApp(command, (message) => {
    if (message.method !== "account/login/completed") return;
    if (login && logins.get(key) === login) void endLogin(key, false);
    forgetNativeSignIn("codex", command);
  }, () => { if (login && logins.get(key) === login) void endLogin(key, false); });
  try {
    const started = await child.request<Record<string, unknown>>("account/login/start",
      { type: flow === "device" ? "chatgptDeviceCode" : "chatgpt" }, REQUEST_MS);
    const loginId = typeof started?.loginId === "string" ? started.loginId.slice(0, 256) : "";
    const result: NativeEngineAccountResult = flow === "device"
      ? NativeEngineAccountResultSchema.parse({ status: "device", userCode: started?.userCode,
        verificationUrl: httpsPage(started?.verificationUrl) })
      : { status: "browser" };
    login = { child, loginId, timer: setTimeout(() => void endLogin(key), NATIVE_SIGN_IN_WINDOW_MS) };
    login.timer.unref?.();
    logins.set(key, login);
    watchNativeSignIn("codex", command, now() + NATIVE_SIGN_IN_WINDOW_MS);
    if (flow === "browser") await host.openExternal!(httpsPage(started?.authUrl));
    return result;
  } catch (error) {
    if (logins.get(key) === login) await endLogin(key);
    else await child.stop().catch(() => undefined);
    throw error instanceof Error && /sign-in page|browser/.test(error.message)
      ? error : new Error("Codex could not start its sign-in. Try again.");
  }
}

/** Characters cmd.exe or a shell could read as syntax inside the quoted command. */
const UNSAFE_ARGUMENT = /["%^&|<>!\r\n`$]/;

/**
 * The program that opens a visible terminal running `argv`, or null when this PC has none.
 * The CLI's interactive sign-in needs a real terminal, so it runs there, not hidden here.
 */
export function terminalLaunch(argv: readonly string[], platformName: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env, exists: (file: string) => boolean = existsSync) {
  const paths = platformName === "win32" ? win32 : posix;
  if (!argv.length || !paths.isAbsolute(argv[0]!) || argv.some(part => !part || UNSAFE_ARGUMENT.test(part))) return null;
  if (platformName === "win32") {
    const cmd = win32.join(environment.SystemRoot ?? "C:\\Windows", "System32", "cmd.exe");
    return { file: cmd, args: [`/d /c start "Sign in" ${argv.map(part => `"${part}"`).join(" ")}`], verbatim: true };
  }
  if (platformName === "darwin") {
    const shell = argv.map(part => `'${part.replaceAll("'", "'\\''")}'`).join(" ");
    const script = shell.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
    return { file: "/usr/bin/osascript", args: ["-e", `tell application "Terminal" to do script "${script}"`,
      "-e", "tell application \"Terminal\" to activate"], verbatim: false };
  }
  const folders = (environment.PATH ?? "").split(posix.delimiter).filter(folder => posix.isAbsolute(folder));
  for (const [name, flag] of [["gnome-terminal", "--"], ["konsole", "-e"], ["xfce4-terminal", "-x"],
    ["xterm", "-e"], ["x-terminal-emulator", "-e"]] as const) {
    const file = folders.map(folder => posix.join(folder, name)).find(exists);
    if (file) return { file, args: [flag, ...argv], verbatim: false };
  }
  return null;
}

function launchDetached(file: string, args: string[], options: { verbatim: boolean }) {
  const child = spawn(file, args, { detached: true, stdio: "ignore", windowsHide: true,
    windowsVerbatimArguments: options.verbatim, env: nativeEnvironment() });
  child.on("error", () => undefined);
  child.unref();
}

function claudeSignIn(command: NativeCommand, flow: "browser" | "device", host: NativeAccountHost) {
  if (flow === "device") throw new Error("Claude Code signs in on the PC. Open Mycellios on that PC to sign in.");
  const launch = terminalLaunch([command.command, ...(command.args ?? []), "auth", "login"], host.platform);
  if (!launch) throw new Error("No terminal was found on this PC. Run claude auth login in a terminal there.");
  (host.launch ?? launchDetached)(launch.file, launch.args, { verbatim: launch.verbatim });
  // The terminal belongs to the person; its sign-in is seen by reading the CLI's status again.
  watchNativeSignIn("claude", command, (host.now ?? Date.now)() + NATIVE_SIGN_IN_WINDOW_MS);
  return { status: "terminal" } as const;
}

async function signOut(engine: "codex" | "claude", command: NativeCommand) {
  await endLogin(loginKey(engine, command));
  if (engine === "codex") {
    const child = await startCodexApp(command, () => undefined, () => undefined);
    try { await child.request("account/logout", {}, REQUEST_MS); }
    finally { await child.stop().catch(() => undefined); }
  } else {
    await new Promise<void>((resolve, reject) => {
      execFile(command.command, [...(command.args ?? []), "auth", "logout"], {
        cwd: homedir(), env: { ...nativeEnvironment(), ELECTRON_RUN_AS_NODE: "1" }, timeout: REQUEST_MS,
        windowsHide: true, maxBuffer: 64 * 1024,
      }, (error) => {
        // A CLI that was already signed out may exit non-zero; the next status read decides.
        if (error && "killed" in error && error.killed) reject(new Error("Claude Code did not sign out in time."));
        else resolve();
      });
    });
  }
  forgetNativeSignIn(engine, command);
  return { status: "signedOut" } as const;
}

/** Signs one installed CLI in or out on this PC, for the person who asked from Mycellios. */
export async function nativeEngineAccount(request: NativeEngineAccountRequest, command: NativeCommand | null,
  host: NativeAccountHost = {}): Promise<NativeEngineAccountResult> {
  if (!command || !nativeCommandAvailable(command)) throw new Error(`${NAMES[request.engine]} is not installed on this PC.`);
  if (request.action === "signOut") return signOut(request.engine, command);
  return request.engine === "codex"
    ? codexSignIn(command, request.flow, host)
    : claudeSignIn(command, request.flow, host);
}

/** Tests only. */
export async function resetNativeAccountLogins() {
  await Promise.all([...logins.keys()].map(key => endLogin(key)));
}
