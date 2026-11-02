import { randomUUID } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const excluded = new Set([
  ".git",
  ".codex",
  ".agents",
  "node_modules",
  "outputs",
  "out",
  "dist",
  "build",
  "release",
  "coverage",
  ".cache",
  ".turbo",
  ".vite",
  "data",
  "logs",
  "sessions",
  "models",
  ".venv",
  "venv",
  "__pycache__",
  ".next",
  "target",
  "Pods",
  "DerivedData",
]);
const hiddenSource = new Set([".gitignore", ".gitattributes", ".dockerignore", ".editorconfig"]);
const sourceFolders = new Set([
  "src",
  "apps",
  "packages",
  "landing",
  "python",
  "scripts",
  "tests",
  "assets",
  "docs",
  "specs",
  "infra",
  "public",
  "config",
  "native",
]);
export async function agentWorkspace(root: string) {
  for (const relative of ["src/agent", "."]) {
    const folder = path.join(root, relative);
    if (
      await stat(path.join(folder, "scripts/desktop-development.mjs")).then(
        (s) => s.isFile(),
        () => false,
      )
    )
      return folder;
  }
  throw new Error("The development source is incomplete.");
}
/** Copy code, not installations, credentials, local state, caches or dependency junctions. */
export async function snapshotDevelopmentSource(source: string, target: string) {
  const from = await realpath(source);
  const to = path.resolve(target);
  if (to === from || to.startsWith(from + path.sep))
    throw new Error("Development copy must be outside its source tree.");
  await cp(from, to, {
    recursive: true,
    errorOnExist: true,
    force: false,
    filter: async (filename) => {
      if (filename === from) return true;
      const relative = path.relative(from, filename),
        segments = relative.split(path.sep);
      // These are generated runtime trees, including retained build recoveries.
      // They are packaged separately, never as development source.
      if (
        segments.some(
          (segment, index) =>
            segment === "apps" &&
            segments[index + 1] === "desktop" &&
            /^local-server(?:$|\.(?:previous|partial)-)/.test(segments[index + 2] ?? ""),
        )
      )
        return false;
      if (segments.length === 1) {
        const info = await lstat(filename);
        if (info.isDirectory() && !sourceFolders.has(segments[0]!)) return false;
        if (
          info.isFile() &&
          !/^(?:package(?:-lock)?\.json|tsconfig.*\.json|.*\.config\.[cm]?[jt]s|.*\.toml|README(?:\..*)?|LICENSE(?:\..*)?|THIRD_PARTY\.md|AGENTS\.md|PRODUCT\.md|DESIGN\.md|CHANGELOG\.md|CONTRIBUTING\.md|SECURITY\.md|Dockerfile|Makefile|\.gitignore|\.gitattributes|\.dockerignore|\.editorconfig)$/.test(
            segments[0]!,
          )
        )
          return false;
      }
      const name = path.basename(filename);
      if (
        excluded.has(name) ||
        (name.startsWith(".") && !hiddenSource.has(name)) ||
        /\.(?:tsbuildinfo|pem|key|p12|gguf|onnx|bin|asar|sqlite|sqlite3|db|log|safetensors|pt|pth|ckpt)$/i.test(
          name,
        )
      )
        return false;
      return !(await lstat(filename)).isSymbolicLink();
    },
  });
}
async function installedVersion(folder: string, name: string) {
  const require = createRequire(path.join(folder, "package.json"));
  let entry: string;
  try {
    entry = require.resolve(name + "/package.json");
  } catch {
    try {
      entry = require.resolve(name);
    } catch {
      return undefined;
    }
  }
  for (let current = path.dirname(entry); ; current = path.dirname(current)) {
    try {
      const pkg = JSON.parse(await readFile(path.join(current, "package.json"), "utf8"));
      if (pkg.name === name) return pkg.version as string;
    } catch {}
    if (path.dirname(current) === current) return undefined;
  }
}
/** Standalone tooling graph: install web dependencies without the server/mobile workspaces. */
export async function developmentToolchain(workspace: string) {
  const packages = new Map<string, { folder: string; pkg: any }>();
  for (const directory of ["apps", "packages"])
    for (const name of await readdir(path.join(workspace, directory))) {
      const folder = path.join(workspace, directory, name);
      try {
        const pkg = JSON.parse(await readFile(path.join(folder, "package.json"), "utf8"));
        packages.set(pkg.name, { folder, pkg });
      } catch {}
    }
  const web = JSON.parse(await readFile(path.join(workspace, "apps/web/package.json"), "utf8"));
  const dependencies: Record<string, string> = {},
    visited = new Set<string>();
  async function visit(name: string, version: string, owner: string) {
    if (visited.has(name)) return;
    visited.add(name);
    if (name === "react-native" || name.startsWith("@ronradtke/react-native")) return;
    const local = packages.get(name);
    if (local) {
      for (const [dep, pin] of Object.entries(local.pkg.dependencies ?? {}))
        await visit(dep, String(pin), local.folder);
      return;
    }
    dependencies[name] = (await installedVersion(owner, name)) ?? version;
  }
  for (const [name, version] of Object.entries({ ...web.dependencies, ...web.devDependencies }))
    await visit(name, String(version), path.join(workspace, "apps/web"));
  const root = JSON.parse(await readFile(path.join(workspace, "package.json"), "utf8"));
  for (const name of ["esbuild", "typescript", "vitest", "@types/node"])
    if (root.devDependencies?.[name]) await visit(name, root.devDependencies[name], workspace);
  return { name: "mycellios-development-tools", private: true, type: "module", dependencies };
}
export class DevelopmentCopy {
  private pending?: Promise<{ root: string; workspace: string; validate(): Promise<void> }>;
  folder: string;
  readonly directory: string;
  private readonly seeds: () => Promise<string[]>;
  private readonly prepare: (workspace: string) => Promise<void>;
  constructor(
    directory: string,
    seeds: () => Promise<string[]>,
    prepare: (workspace: string) => Promise<void>,
  ) {
    this.directory = directory;
    this.seeds = seeds;
    this.prepare = prepare;
    this.folder = path.join(directory, "workspace");
  }
  ensure() {
    this.pending ??= this.open().catch((error) => {
      this.pending = undefined;
      throw error;
    });
    return this.pending;
  }
  private async open() {
    await mkdir(this.directory, { recursive: true });
    const directory = await realpath(this.directory);
    this.folder = path.join(directory, "workspace");
    const marker = path.join(directory, "workspace.json");
    let identity: { device: string; inode: string } | undefined;
    try {
      identity = JSON.parse(await readFile(marker, "utf8"));
    } catch {}
    if (!identity) {
      if (
        await lstat(this.folder).then(
          () => true,
          () => false,
        )
      )
        throw new Error(
          "An existing development folder has no valid descriptor. It has been preserved.",
        );
      let source: string | undefined;
      for (const candidate of await this.seeds())
        try {
          await agentWorkspace(candidate);
          source = candidate;
          break;
        } catch {}
      if (!source) throw new Error("This installation does not include its development source.");
      const staging = path.join(directory, "preparing-" + randomUUID());
      await snapshotDevelopmentSource(source, staging);
      const seedWorkspace = await agentWorkspace(source);
      const seedTools = await readFile(
        path.join(seedWorkspace, "development-toolchain.json"),
        "utf8",
      ).then(JSON.parse, () => developmentToolchain(seedWorkspace));
      const copiedWorkspace = await agentWorkspace(staging);
      await writeFile(
        path.join(copiedWorkspace, "development-toolchain.json"),
        JSON.stringify(seedTools, null, 2),
      );
      await rename(staging, this.folder);
      const info = await stat(this.folder, { bigint: true });
      identity = { device: String(info.dev), inode: String(info.ino) };
      await writeFile(marker, JSON.stringify(identity), { flag: "wx", mode: 0o600 });
    }
    const expected = identity;
    const validate = async () => {
      const info = await stat(this.folder, { bigint: true });
      if (
        (await realpath(this.folder)) !== this.folder ||
        String(info.dev) !== expected.device ||
        String(info.ino) !== expected.inode
      )
        throw new Error("The local development copy changed location.");
    };
    await validate();
    const workspace = await agentWorkspace(this.folder);
    await this.prepare(workspace);
    await validate();
    return { root: this.folder, workspace, validate };
  }
}
export async function linkDevelopmentTools(workspace: string, toolchain: string) {
  const destination = path.join(workspace, "node_modules");
  if (
    !(await lstat(destination).then(
      () => true,
      () => false,
    ))
  )
    await symlink(toolchain, destination, process.platform === "win32" ? "junction" : "dir");
}
export async function linkDevelopmentPackages(workspace: string, toolchain: string) {
  for (const directory of ["apps", "packages"])
    for (const name of await readdir(path.join(workspace, directory))) {
      const folder = path.join(workspace, directory, name);
      let pkg: { name: string };
      try {
        pkg = JSON.parse(await readFile(path.join(folder, "package.json"), "utf8"));
      } catch {
        continue;
      }
      if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i.test(pkg.name))
        throw new Error("Invalid development workspace package name");
      const destination = path.join(toolchain, ...pkg.name.split("/"));
      if (
        !(await lstat(destination).then(
          () => true,
          () => false,
        ))
      ) {
        await mkdir(path.dirname(destination), { recursive: true });
        await symlink(folder, destination, process.platform === "win32" ? "junction" : "dir");
      }
    }
}
