import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { workspaceAliases } from "./workspace-aliases.mjs";
import { releaseInputs, writeReleaseReceipt } from "./release-continuity.mjs";
import { stagePrismaResources } from "./prisma-resources.mjs";

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.resolve(desktop, "../..");
const target = path.join(desktop, "local-server");
const inputs = await releaseInputs(root);
// Called inside the existing build job; do not acquire a second scheduler turn here.
if (!process.argv.includes("--bundle-only")) {
  try {
    await rename(target, `${target}.previous-${Date.now()}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const npmCli = process.env.npm_execpath || path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
  if (!existsSync(npmCli) || !/npm-cli\.js$/.test(npmCli)) throw new Error("Run packaging through npm");
  const staging = await mkdtemp(path.join(tmpdir(), "mycellios-server-build-"));
  if (!path.resolve(staging).startsWith(path.resolve(tmpdir()) + path.sep))
    throw new Error("Invalid deployment staging path");
  try {
    const rootManifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
    delete rootManifest.devDependencies;
    delete rootManifest.scripts;
    await cp(path.join(root, "package-lock.json"), path.join(staging, "package-lock.json"));
    await cp(path.join(root, "tsconfig.base.json"), path.join(staging, "tsconfig.base.json"));
    const projects = new Map();
    for (const folder of ["apps", "packages"]) {
      for (const entry of await readdir(path.join(root, folder), { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const relative = path.join(folder, entry.name);
        try {
          const manifest = JSON.parse(
            await readFile(path.join(root, relative, "package.json"), "utf8"),
          );
          projects.set(manifest.name, { relative, manifest });
        } catch {
          /* Only workspace package directories have a manifest. */
        }
      }
    }
    const selected = new Set();
    const pending = ["@rakazo/api"];
    while (pending.length) {
      const name = pending.pop();
      if (selected.has(name)) continue;
      const project = projects.get(name);
      if (!project) throw new Error("Missing API workspace dependency");
      selected.add(name);
      for (const [dependency, version] of Object.entries({
        ...project.manifest.dependencies,
        ...project.manifest.optionalDependencies,
      })) {
        if (projects.has(dependency)) pending.push(dependency);
      }
      await cp(path.join(root, project.relative), path.join(staging, project.relative), {
        recursive: true,
        filter: (file) => {
          const name = path.basename(file);
          return (
            !["node_modules", "dist", "out", ".git", ".codex", ".agents"].includes(name) &&
            !(name.startsWith(".env") && !name.endsWith("example"))
          );
        },
      });
    }
    rootManifest.workspaces = [...selected].map(name => projects.get(name).relative.split(path.sep).join("/"));
    await writeFile(path.join(staging, "package.json"), JSON.stringify(rootManifest, null, 2));
    const npm = args => execFileSync(process.execPath, [npmCli, ...args], {cwd:staging, stdio:"inherit", env:{...process.env, NODE_ENV:"production"}});
    npm(["install", "--package-lock-only", "--ignore-scripts", "--omit=dev", "--no-audit", "--no-fund"]);
    npm(["ci", "--omit=dev", "--no-audit", "--no-fund"]);
    npm(["run", "generate", "--workspace", "@rakazo/db"]);
    // Keep the relocatable hoisted production tree together with its workspace links.
    await cp(staging, target, {recursive:true, dereference:true});
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
await mkdir(path.join(target, "dist"), { recursive: true });
const outfile = path.join(target, "dist", "desktop-local-entry.js");
await build({
  entryPoints: [path.join(root, "apps/api/src/desktop-local-entry.ts")],
  outfile,
  bundle: true,
  alias: {
    ...await workspaceAliases(root),
    // Its client was generated from this release's schema inside the production tree.
    '@rakazo/db': path.join(target, 'packages/db/src/index.ts'),
  },
  platform: "node",
  format: "esm",
  target: "node24",
  conditions: ["node"],
  tsconfig: path.join(root, "scripts", "tsconfig.server-build.json"),
  sourcemap: true,
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
  },
  plugins: [
    {
      name: "deployed-dependencies",
      setup(builder) {
        builder.onResolve({ filter: /^[^./]/ }, async (args) => {
          if (
            args.pluginData?.deployed ||
            args.kind === "entry-point" ||
            path.isAbsolute(args.path) ||
            args.path.startsWith("node:") ||
            args.path.startsWith("@rakazo/")
          )
            return undefined;
          let owner = path.dirname(args.importer);
          while (owner.startsWith(root)) {
            try {
              const pkg = JSON.parse(await readFile(path.join(owner, "package.json"), "utf8"));
              if (pkg.name?.startsWith("@rakazo/")) {
                const location =
                  pkg.name === "@rakazo/api" ? target : path.join(target, "node_modules", pkg.name);
                const resolved = await builder.resolve(args.path, {
                  resolveDir: await realpath(location),
                  kind: args.kind,
                  pluginData: { deployed: true },
                });
                if (resolved.errors.length) return { errors: resolved.errors };
                if (resolved.external) return { path: resolved.path, external: true };
                return {
                  path: `./${path.relative(path.dirname(outfile), resolved.path).split(path.sep).join("/")}`,
                  external: true,
                };
              }
            } catch {
              /* walk to package boundary */
            }
            owner = path.dirname(owner);
          }
          return { path: args.path, external: true };
        });
      },
    },
  ],
});
await stagePrismaResources(path.join(root, "packages/db/prisma"), path.join(target, "prisma"));
await writeFile(
  path.join(target, "prisma.config.mjs"),
  'import { defineConfig } from "prisma/config";\nexport default defineConfig({ schema: "prisma/schema.prisma", migrations: { path: "prisma/migrations" }, datasource: { url: process.env.DATABASE_MIGRATION_URL } });\n',
);

await writeReleaseReceipt(root, "local-server", inputs);
