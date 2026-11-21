import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
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
  nodePaths: [path.join(agentRoot, "node_modules")],
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  banner: {
    js: 'import { createRequire as __desktopCreateRequire } from "node:module"; const require = __desktopCreateRequire(import.meta.url);',
  },
  external: ["electron", "electron-updater", "koffi", "@sentry/electron"],
});

// WhatsApp linked device (specs/whatsapp-linked-device): Baileys pulls in libsignal
// (GPL-3.0) and whatsapp-rust-bridge (AGPL-3.0 code), which are incompatible with the
// PolyForm Shield license of Mycellios. Release builds therefore omit the runtime and
// Desktop reports WhatsApp as unavailable. Only a local, non-distributed build may opt in.
const whatsAppRuntime = process.env.MYCELLIOS_DESKTOP_WHATSAPP_RUNTIME === "local-gpl";
rmSync("dist/whatsapp-runtime.js", { force: true });
if (whatsAppRuntime)
  await build({
    entryPoints: ["src/whatsapp/baileys-runtime.ts"],
    outfile: "dist/whatsapp-runtime.js",
    bundle: true,
    nodePaths: [path.join(agentRoot, "node_modules")],
    platform: "node",
    format: "esm",
    target: "node22",
    banner: {
      js: 'import { createRequire as __desktopCreateRequire } from "node:module"; const require = __desktopCreateRequire(import.meta.url);',
    },
    external: ["sharp", "jimp", "link-preview-js", "audio-decode", "bufferutil", "utf-8-validate"],
    logLevel: "warning",
  });

execFileSync(process.execPath, ["--check", "dist/main.js"], { stdio: "inherit" });
if (whatsAppRuntime)
  execFileSync(process.execPath, ["--check", "dist/whatsapp-runtime.js"], { stdio: "inherit" });
execFileSync(process.execPath, ["scripts/copy-static.mjs"], { stdio: "inherit" });
await writeReleaseReceipt(agentRoot, "desktop", inputs);
