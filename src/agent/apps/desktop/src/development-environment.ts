import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import {
  agentWorkspace,
  DevelopmentCopy,
  linkDevelopmentPackages,
  linkDevelopmentTools,
} from "./development-copy.js";
import type { prepareHostComputer } from "./host-computer.js";
import { normalizeServerUrl } from "./setup-config.js";

export { nativeProjectSpace } from "./project-session.js";

export interface DevelopmentProject {
  key: string;
  root: string;
  workspace: string;
  server: string;
  project: { name: string };
  validate(): Promise<void>;
}
type Host = Awaited<ReturnType<typeof prepareHostComputer>>;
export class NativeDevelopmentEnvironment {
  private readonly copy: DevelopmentCopy;
  private active = false;
  private mounted = new Map<string, string>();
  private preparing: ReturnType<typeof spawn> | undefined;
  private environment: Record<string, string> = {};
  constructor(
    private readonly options: {
      directory: string;
      getStable(): BrowserWindow | null;
      getServer(): string | null;
      seeds(): Promise<string[]>;
      npmCli(): Promise<string>;
      host(): Host | undefined;
      owner(): Promise<string>;
      bind(botId: string): Promise<void>;
      dedicate?(botId: string): Promise<void>;
      changed(active: boolean): void;
    },
  ) {
    this.copy = new DevelopmentCopy(options.directory, options.seeds, (workspace) =>
      this.prepare(workspace),
    );
  }
  private context() {
    const stable = this.options.getStable(),
      server = normalizeServerUrl(this.options.getServer() ?? "");
    if (!stable || stable.isDestroyed() || !server)
      throw new Error("Open the stable application first.");
    const page = new URL(stable.webContents.getURL()),
      base = new URL(server),
      prefix = base.pathname.replace(/\/$/, "");
    if (
      page.origin !== base.origin ||
      !(page.pathname === prefix || page.pathname.startsWith(prefix + "/"))
    )
      throw new Error("The server changed.");
    return { stable, server };
  }
  authorize(event: IpcMainInvokeEvent) {
    try {
      const { stable } = this.context();
      return event.sender === stable.webContents && event.senderFrame === event.sender.mainFrame;
    } catch {
      return false;
    }
  }
  state() {
    return { active: this.active };
  }
  dispose() {
    this.preparing?.kill();
    this.preparing = undefined;
  }
  private async prepare(workspace: string) {
    const tools = path.join(this.options.directory, "tools");
    await mkdir(tools, { recursive: true });
    const descriptor = await readFile(path.join(workspace, "development-toolchain.json"), "utf8");
    const digest = createHash("sha256").update(descriptor).digest("hex");
    const ready = await readFile(path.join(tools, "ready"), "utf8").catch(() => "");
    if (
      ready !== digest ||
      !(await stat(path.join(tools, "node_modules/vite/package.json")).then(
        () => true,
        () => false,
      ))
    ) {
      await writeFile(path.join(tools, "package.json"), descriptor);
      const npm = await this.options.npmCli();
      await new Promise<void>((resolve, reject) => {
        const child = spawn(
          process.execPath,
          [
            npm,
            "install",
            "--prefix",
            tools,
            "--ignore-scripts",
            "--no-audit",
            "--no-fund",
            "--legacy-peer-deps",
          ],
          {
            cwd: tools,
            env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
            windowsHide: true,
            stdio: ["ignore", "ignore", "pipe"],
          },
        );
        this.preparing = child;
        child.stderr.on("data", () => {});
        child.once("error", reject);
        child.once("exit", (code) => {
          if (this.preparing === child) this.preparing = undefined;
          code === 0
            ? resolve()
            : reject(
                new Error(
                  "Could not prepare development dependencies. Retry with an Internet connection.",
                ),
              );
        });
      });
      await writeFile(path.join(tools, "ready"), digest);
    }
    await linkDevelopmentTools(workspace, path.join(tools, "node_modules"));
    await linkDevelopmentTools(this.copy.folder, path.join(tools, "node_modules"));
    await linkDevelopmentPackages(workspace, path.join(tools, "node_modules"));
    const bin = path.join(this.options.directory, "bin");
    await mkdir(bin, { recursive: true });
    const npm = await this.options.npmCli();
    if (process.platform === "win32") {
      const escapeBatchPath = (value: string) => value.replaceAll("%", "%%");
      await writeFile(
        path.join(bin, "node.cmd"),
        `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${escapeBatchPath(process.execPath)}" %*\r\n`,
      );
      await writeFile(
        path.join(bin, "npm.cmd"),
        `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${escapeBatchPath(process.execPath)}" "${escapeBatchPath(npm)}" %*\r\n`,
      );
    } else {
      const quote = (value: string) => "'" + value.replaceAll("'", "'\"'\"'") + "'";
      for (const [name, argument] of [
        ["node", ""],
        ["npm", quote(npm)],
      ]) {
        const file = path.join(bin, name!);
        await writeFile(
          file,
          `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ${quote(process.execPath)} ${argument} "$@"\n`,
        );
        await chmod(file, 0o700);
      }
    }
    this.environment = { PATH: bin + path.delimiter + (process.env.PATH ?? "") };
  }
  async connect(botId: unknown) {
    if (typeof botId !== "string" || !botId || botId.length > 256) throw new Error("Invalid agent");
    const host = this.options.host();
    if (!host?.isEnabled()) throw new Error("Allow local computer access first.");
    if (this.active) {
      const copy = await this.copy.ensure(),
        owner = await this.options.owner();
      const key = JSON.stringify([owner, copy.root]);
      if (this.mounted.get(botId) !== key || host.project(botId)?.path !== copy.root) {
        await this.options.dedicate?.(botId);
        if ((await this.options.owner()) !== owner) throw new Error("Development account changed.");
        const release = host.lockProject(botId);
        try {
          await host.selectProject(botId, copy.root, {
            defaultFiles: true,
            environment: this.environment,
            validate: async () => {
              if ((await this.options.owner()) !== owner)
                throw new Error("Development account changed.");
              await copy.validate();
            },
          });
          this.mounted.set(botId, key);
        } finally {
          release();
        }
      }
    }
    await this.options.bind(botId);
  }
  async development(value?: unknown): Promise<DevelopmentProject> {
    const captured = this.context(),
      host = this.options.host();
    if (!host?.isEnabled()) throw new Error("Allow local computer access first.");
    const owner = await this.options.owner(),
      copy = await this.copy.ensure();
    if (this.context().server !== captured.server || (await this.options.owner()) !== owner)
      throw new Error("The account changed.");
    const prefix = new URL(captured.server).pathname.replace(/\/$/, "");
    const current = new URL(captured.stable.webContents.getURL()).pathname
      .slice(prefix.length)
      .match(/^\/app\/([^/]+)\/?$/)?.[1];
    if (value !== undefined && value !== current) throw new Error("Open this agent's chat first.");
    this.active = true;
    try {
      if (current) await this.connect(current);
    } catch (error) {
      this.active = false;
      throw error;
    }
    this.options.changed(true);
    return {
      ...copy,
      key: JSON.stringify([captured.server, owner]),
      server: captured.server,
      project: { name: "Mycellios · Local development" },
      validate: async () => {
        if (this.context().server !== captured.server || (await this.options.owner()) !== owner)
          throw new Error("The development account changed.");
        await copy.validate();
      },
    };
  }
}
export async function developmentSourceCandidates(
  appPath: string,
  resources: string,
  userData: string,
) {
  const candidates = [path.join(resources, "development-source")];
  for (let current = path.resolve(appPath); ; current = path.dirname(current)) {
    try {
      const workspace = await agentWorkspace(current),
        repository = path.resolve(workspace, "../..");
      candidates.push(
        await agentWorkspace(repository).then(
          (found) => (found === workspace ? repository : current),
          () => current,
        ),
      );
      break;
    } catch {}
    if (path.dirname(current) === current) break;
  }
  // Compatibility for an older locally installed preview: source seed only, never its working folder.
  try {
    const saved = JSON.parse(
      await readFile(path.join(userData, "development-workspace.json"), "utf8"),
    );
    if (typeof saved.workspace === "string") {
      const workspace = await realpath(saved.workspace);
      const repository = path.resolve(workspace, "../..");
      candidates.push(
        await agentWorkspace(repository).then(
          () => repository,
          () => workspace,
        ),
      );
    }
  } catch {}
  return candidates;
}
