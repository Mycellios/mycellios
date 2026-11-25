import { afterEach, expect, it, vi } from "vitest";
import { nativeEnvironment } from "./native-agent-process.js";
import {
  loginShell, loginShellPath, nativeSearchEnvironment, parseLoginShellPath, resetLoginShellPath, withLoginShellPath,
} from "./native-login-path.js";

afterEach(() => resetLoginShellPath());

it("keeps only the absolute folders the login shell printed between the markers", () => {
  expect(parseLoginShellPath("Welcome!\n__MYCELLIOS_PATH__/opt/homebrew/bin:relative:/usr/bin\n__MYCELLIOS_PATH__ bye"))
    .toBe("/opt/homebrew/bin:/usr/bin");
  expect(parseLoginShellPath("no markers")).toBeNull();
  expect(parseLoginShellPath("__MYCELLIOS_PATH__relative__MYCELLIOS_PATH__")).toBeNull();
});

it("uses the person's known shell and otherwise the platform's default", () => {
  const exists = (file: string) => file === "/opt/homebrew/bin/fish" || file === "/bin/zsh";
  expect(loginShell({ SHELL: "/opt/homebrew/bin/fish" }, "darwin", exists)).toBe("/opt/homebrew/bin/fish");
  expect(loginShell({ SHELL: "/usr/bin/python3" }, "darwin", exists)).toBe("/bin/zsh");
  expect(loginShell({ SHELL: "relative/zsh" }, "linux", exists)).toBe("/bin/sh");
  expect(loginShell({}, "linux", exists)).toBe("/bin/sh");
});

it("reads the login shell once, bounded, and puts its folders first", async () => {
  const run = vi.fn(async (_shell: string, args: string[], timeoutMs: number) => {
    expect(args[0]).toBe("-ilc");
    expect(timeoutMs).toBeLessThanOrEqual(5_000);
    return "__MYCELLIOS_PATH__/opt/homebrew/bin:/usr/bin__MYCELLIOS_PATH__";
  });
  await expect(loginShellPath({ platform: "win32", run })).resolves.toBeNull();
  expect(run).not.toHaveBeenCalled();
  await Promise.all([loginShellPath({ platform: "darwin", run }), loginShellPath({ platform: "darwin", run })]);
  await loginShellPath({ platform: "darwin", run });
  expect(run).toHaveBeenCalledOnce();
  expect(withLoginShellPath("/usr/bin:/bin")).toBe("/opt/homebrew/bin:/usr/bin:/bin");
  expect((await nativeSearchEnvironment({ PATH: "/bin", HOME: "/home/person" }))).toEqual({
    PATH: "/opt/homebrew/bin:/usr/bin:/bin", HOME: "/home/person" });
  // Processes the app starts get the same folders; an explicit environment is left as given.
  expect(nativeEnvironment().PATH?.startsWith("/opt/homebrew/bin:/usr/bin")).toBe(true);
  expect(nativeEnvironment({ PATH: "/bin" })).toEqual({ PATH: "/bin", DISABLE_AUTOUPDATER: "1" });
});

it("asks a shell that gave no PATH again only after a while", async () => {
  let now = 0;
  const run = vi.fn().mockRejectedValueOnce(new Error("timed out")).mockResolvedValue("__MYCELLIOS_PATH__/usr/local/bin__MYCELLIOS_PATH__");
  await expect(loginShellPath({ platform: "linux", run, now: () => now })).resolves.toBeNull();
  await expect(loginShellPath({ platform: "linux", run, now: () => now })).resolves.toBeNull();
  expect(run).toHaveBeenCalledOnce();
  now = 11 * 60_000;
  await expect(loginShellPath({ platform: "linux", run, now: () => now })).resolves.toBe("/usr/local/bin");
  expect(withLoginShellPath(undefined)).toBe("/usr/local/bin");
});
