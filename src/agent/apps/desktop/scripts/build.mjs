import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { workspaceAliases } from "./workspace-aliases.mjs";
import { releaseInputs, writeReleaseReceipt } from "./release-continuity.mjs";

const agentRoot = path.resolve("../..");
const inputs = await releaseInputs(agentRoot);

await build({
  entryPoints: ["src/main.ts"],
  outfile: "dist/main.js",
  bundle: true,
  alias: await workspaceAliases(path.resolve("../..")),
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  banner: {
    js: 'import { createRequire as __desktopCreateRequire } from "node:module"; const require = __desktopCreateRequire(import.meta.url);',
  },
  external: ["electron", "electron-updater", "koffi", "@sentry/electron"],
});

execFileSync(process.execPath, ["--check", "dist/main.js"], { stdio: "inherit" });
execFileSync(process.execPath, ["scripts/copy-static.mjs"], { stdio: "inherit" });
await writeReleaseReceipt(agentRoot, "desktop", inputs);
