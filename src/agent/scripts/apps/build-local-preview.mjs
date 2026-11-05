import { build as bundle } from "esbuild";
import { build } from "vite";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";

// Run through compilar.ps1. Build only the added surface, preserving the installed
// host renderer and other agents' unpublished UI/native changes byte-for-byte.
const output = path.resolve("../../outputs/apps-local");
const agentRoot = process.cwd();
await mkdir(output, { recursive: true });
await bundle({
  entryPoints: ["apps/desktop/src/apps-studio-ipc.ts"],
  outfile: path.join(output, "apps-studio-ipc.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: ["electron"],
});
const configFile = path.resolve("scripts/apps/local-preview.vite.ts");
process.chdir(path.resolve("apps/web"));
await build({ configFile });
const css = path.join(output, "renderer", "apps-preview.css");
const source = await readFile(css, "utf8");
await writeFile(
  css,
  `/* Scoped local Apps preview; existing application styles are preserved. */\n@scope ([data-apps-studio]) {\n${source}\n}\n.apps-local-menu{display:flex;align-items:center;gap:8px;margin:0 12px 12px;padding:8px 12px;border:0;border-radius:8px;color:inherit;background:transparent;text-align:start;cursor:pointer;font:inherit;font-size:14px}.apps-local-menu:hover{background:var(--accent)}.apps-local-menu:focus-visible{outline:2px solid var(--ring);outline-offset:2px}\n`,
);
const files = ["apps-studio-ipc.mjs", "renderer/apps-preview.js", "renderer/apps-preview.css"];
const hashes = {};
for (const file of files)
  hashes[file] = createHash("sha256")
    .update(await readFile(path.join(output, file)))
    .digest("hex");
await writeFile(
  path.join(output, "build.json"),
  JSON.stringify(
    {
      schema: "mycellios-apps-local-build/1",
      head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      hashes,
      production: false,
    },
    null,
    2,
  ),
);
console.log(`Local Apps preview built: ${output}`);
if (process.argv.includes("--prepare")) execFileSync(process.execPath, ["scripts/apps/prepare-local-install.mjs"], { cwd: agentRoot, stdio: "inherit" });
