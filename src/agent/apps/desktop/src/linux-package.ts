import { execFileSync } from "node:child_process";

/** The Linux package that owns the running executable. */
export type LinuxPackageKind = "fedora-x64" | "linux-x64";

type Run = (command: string, args: string[]) => string | null;

function runTool(command: string, args: string[]): string | null {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      timeout: 5_000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    // Missing tools and unowned paths are both ordinary: no catalog offer follows.
    return null;
  }
}

/**
 * A catalog update replaces a package, so the running executable must belong to
 * one. AppImages and unpackaged builds own nothing and stay manual downloads.
 */
export function linuxPackageKind(executable: string, run: Run = runTool): LinuxPackageKind | null {
  if (run("rpm", ["-qf", "--qf", "%{NAME}", executable]) === "mycellios-desktop")
    return "fedora-x64";
  const owner = run("dpkg-query", ["-S", executable]);
  return owner?.startsWith("mycellios-desktop:") ? "linux-x64" : null;
}
