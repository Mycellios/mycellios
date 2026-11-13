import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { lstat, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { nodeEnrollmentBundleSchema } from "../../../../contracts/node-control.js";
import type { DesktopRuntimeStatus } from "../../../../contracts/desktop-runtime.js";
import { readPrivateFile, writePrivateFile } from "./setup-store.js";

export const CONTRIBUTION_ORIGIN = "https://www.mycellios.com";

export function mayManageContribution(sender: string, mainFrame: boolean) {
  if (!mainFrame) return false;
  try {
    const url = new URL(sender);
    return url.origin === CONTRIBUTION_ORIGIN && !url.username && !url.password &&
      (url.pathname === "/dashboard" || url.pathname === "/agent" || url.pathname.startsWith("/agent/"));
  } catch { return false; }
}

export class ContributionRuntime {
  private installing = false;
  constructor(private readonly options: {
    platform: NodeJS.Platform;
    arch?: NodeJS.Architecture;
    resources: string;
    userData: string;
    programFiles: string;
    programData: string;
    linuxRoot?: string;
    linuxConfig?: string;
    macRoot?: string;
    macConfig?: string;
    run?: (executable: string, args: string[]) => Promise<number>;
    now?: () => number;
  }) {}

  private supported() {
    return ["win32", "linux", "darwin"].includes(this.options.platform) &&
      (this.options.platform !== "darwin" || (this.options.arch ?? process.arch) === "arm64");
  }

  private layout() {
    const mac = this.options.platform === "darwin";
    const unix = mac || this.options.platform === "linux";
    return {
      unix,
      root: mac ? this.options.macRoot ?? "/Library/Application Support/Mycellios/Product" : unix ? this.options.linuxRoot ?? "/opt/mycellios" : path.join(this.options.programFiles, "Mycellios"),
      config: mac ? this.options.macConfig ?? "/Library/Application Support/Mycellios/Configuration/node.json" : unix ? this.options.linuxConfig ?? "/etc/mycellios/node.json" : path.join(this.options.programData, "Mycellios", "Configuration", "node.json"),
    };
  }

  private privileged(script: string, arguments_: string[], windowsArguments: string[]) {
    const run = this.options.run ?? runInstaller;
    if (this.options.platform === "darwin") {
      const command = ["/bin/sh", script, ...arguments_].map(shellQuote).join(" ");
      const literal = '"' + command.replaceAll("\\", "\\\\").replaceAll('"', '\\"') + '"';
      return run("/usr/bin/osascript", ["-e", "do shell script " + literal + " with administrator privileges"]);
    }
    return this.options.platform === "linux" ? run("pkexec", [script, ...arguments_]) : run("powershell.exe", windowsArguments);
  }

  async status(): Promise<DesktopRuntimeStatus> {
    const { unix, root, config: configPath } = this.layout();
    let installed = false;
    try { const info = await lstat(path.join(root, "bin", unix ? "node" : "node.exe")); installed = info.isFile() && !info.isSymbolicLink(); } catch {}
    let enrolled = false;
    let protectedConfiguration = false;
    let nodeId: string | null = null;
    try {
      const info = await lstat(configPath);
      // An inaccessible existing service is never permission to create another identity.
      enrolled = true;
      if (info.isFile() && !info.isSymbolicLink() && info.size <= 64 * 1024) {
        const config = JSON.parse(await readFile(configPath, "utf8"));
        if (typeof config.nodeId === "string" && /^[A-Za-z0-9._-]{1,128}$/.test(config.nodeId)) nodeId = config.nodeId;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") enrolled = true;
      protectedConfiguration = ["EACCES", "EPERM"].includes((error as NodeJS.ErrnoException).code ?? "");
    }
    // Service configuration remains private. Only root/admin publishes this non-secret descriptor.
    if (enrolled && installed && protectedConfiguration && !nodeId) {
      try {
        const publicPath = path.join(root, "desktop-node.json");
        const info = await lstat(publicPath);
        if (unix && process.platform !== "win32" && (info.uid !== 0 || (info.mode & 0o022) !== 0)) throw new Error("Untrusted descriptor");
        const value = JSON.parse(await readPrivateFile(publicPath, 4096) ?? "null");
        if (value?.schema === "mycellios-desktop-runtime-status/1" && typeof value.nodeId === "string" && /^[A-Za-z0-9._-]{1,128}$/.test(value.nodeId)) nodeId = value.nodeId;
      } catch { /* An existing but unreadable identity is never permission to replace it. */ }
    }
    let version: string | null = null;
    try {
      const raw = await readPrivateFile(path.join(root, unix ? "app/manifest.json" : "package.json"), 64 * 1024);
      const value = JSON.parse(raw ?? "null");
      if (typeof value?.version === "string" && /^\d+\.\d+\.\d+$/.test(value.version)) version = value.version;
    } catch {}
    return { supported: this.supported(), installed, enrolled, nodeId, version, installing: this.installing };
  }

  async identify(): Promise<DesktopRuntimeStatus> {
    if (!this.supported()) throw new Error("Contribution setup is not available on this platform.");
    if (this.installing) throw new Error("Contribution setup is already running.");
    const before = await this.status();
    if (!before.installed || !before.enrolled) return before;
    this.installing = true;
    try {
      const root = path.join(this.options.resources, "contribution");
      const script = this.options.platform === "darwin" ? "describe-runtime-macos.sh" : "describe-runtime.sh";
      const code = await this.privileged(path.join(root, script), [], ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(root, "describe-runtime.ps1")]);
      if (code !== 0) throw new Error("The existing runtime identity could not be read. No identity was changed.");
      return { ...await this.status(), installing: false };
    } finally { this.installing = false; }
  }

  async enroll(value: unknown): Promise<DesktopRuntimeStatus> {
    if (!this.supported()) throw new Error("Contribution setup is not available on this platform.");
    if (this.installing) throw new Error("Contribution setup is already running.");
    const parsed = nodeEnrollmentBundleSchema.safeParse(value);
    if (!parsed.success) throw new Error("Invalid contribution pairing request.");
    const bundle = parsed.data;
    if (bundle.coordinatorUrl !== CONTRIBUTION_ORIGIN ||
      Date.parse(bundle.expiresAt) <= (this.options.now?.() ?? Date.now()))
      throw new Error("This pairing request expired or belongs to another server.");
    this.installing = true;
    let grantPath: string | undefined;
    try {
      if ((await this.status()).enrolled) throw new Error("This computer already has a runtime identity. Manage the existing node instead.");
      const root = path.join(this.options.resources, "contribution");
      const linux = this.options.platform === "linux";
      const mac = this.options.platform === "darwin";
      const expectedFile = mac ? "mycellios-runtime.pkg" : linux ? "mycellios-runtime.deb" : "mycellios-runtime.msi";
      const manifest = JSON.parse(await readFile(path.join(root, "runtime.json"), "utf8"));
      if (manifest.schema !== "mycellios-desktop-runtime/1" ||
        manifest.file !== expectedFile || !/^[a-f0-9]{64}$/.test(manifest.sha256))
        throw new Error("The bundled runtime could not be verified.");
      const msi = path.join(root, manifest.file);
      const info = await lstat(msi);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error("The bundled runtime could not be verified.");
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(msi)) hash.update(chunk);
      const digest = hash.digest("hex");
      if (digest !== manifest.sha256) throw new Error("The bundled runtime could not be verified.");
      const grants = path.join(this.options.userData, "runtime-pairing");
      await mkdir(grants, { recursive: true, mode: 0o700 });
      grantPath = path.join(grants, `${bundle.enrollmentId}.json`);
      await writePrivateFile(grantPath, JSON.stringify(bundle));
      const code = await this.privileged(path.join(root, mac ? "install-runtime-macos.sh" : "install-runtime.sh"), [msi, manifest.sha256, grantPath], [
        "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(root, "install-runtime.ps1"),
        "-Msi", msi, "-ExpectedSha256", manifest.sha256, "-Enrollment", grantPath,
      ]);
      if (code !== 0) throw new Error(code === 1223 ? "Installation was cancelled." : "Contribution setup did not complete. Your existing data was retained.");
      const result = await this.status();
      if (!result.installed || !result.enrolled) throw new Error("Contribution setup has not been confirmed.");
      return { ...result, installing: false };
    } finally {
      if (grantPath) await rm(grantPath, { force: true });
      this.installing = false;
    }
  }
}

function shellQuote(value: string) {
  if (/[\r\n\0]/.test(value)) throw new Error("Invalid installer path.");
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

function runInstaller(executable: string, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, shell: false, stdio: "ignore" });
    const timeout = setTimeout(() => { child.kill(); reject(new Error("Contribution setup timed out.")); }, 15 * 60_000);
    child.once("error", () => { clearTimeout(timeout); reject(new Error("Could not start contribution setup.")); });
    child.once("exit", (code) => { clearTimeout(timeout); resolve(code ?? -1); });
  });
}
