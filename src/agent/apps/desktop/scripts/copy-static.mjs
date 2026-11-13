import { copyFile, mkdir, writeFile, chmod } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {fetchNodeRuntimeLicense} from './node-runtime-license.mjs';

// tsc only emits the TypeScript sources; the preload bridges and the setup
// window's static assets have to be copied into dist alongside them.
const STATIC_FILES = ["preload.cjs", "setup-preload.cjs", "setup.html", "setup.css", "setup.js"];
STATIC_FILES.push("companion-preload.cjs", "companion.html", "companion.css", "companion.js");
STATIC_FILES.push("floating-chat-preload.cjs");
const TOKENS_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../packages/ui-tokens/src/tokens.css",
);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
STATIC_FILES.push("project-browser-preload.cjs");
STATIC_FILES.push("manual-update-helper.ps1");
const dist = path.join(root, "dist");
const webRequire = createRequire(path.join(root, "../web/package.json"));

await mkdir(dist, { recursive: true });
// Audio inference uses plain Node: Electron's V8 memory cage rejects the native
// model library's external buffers. Package the build runtime, never a user's
// PATH executable selected by the renderer. Platform builds must run natively.
if (process.versions.electron) throw new Error("Desktop packaging needs standalone Node");
const voiceNode = path.join(dist, process.platform === "win32" ? "voice-node.exe" : "voice-node");
await copyFile(process.execPath, voiceNode);
const voiceNodeHash = createHash("sha256");
for await (const bytes of createReadStream(voiceNode)) voiceNodeHash.update(bytes);
await writeFile(path.join(dist, "voice-node-runtime.json"), JSON.stringify({
  platform: process.platform, arch: process.arch, version: process.version, sha256: voiceNodeHash.digest("hex"),
}) + "\n");
if (process.platform !== "win32") await chmod(voiceNode, 0o755);
await writeFile(path.join(dist, "voice-node-LICENSE.txt"), await fetchNodeRuntimeLicense(process.version));
await mkdir(path.join(dist, "assets"), { recursive: true });
await Promise.all(["icon.ico", "icon.png", "icon-macos.png"].map((file) =>
  copyFile(path.join(root, "assets", file), path.join(dist, "assets", file)),
));
await Promise.all([
  ...STATIC_FILES.map((file) => copyFile(path.join(root, "src", file), path.join(dist, file))),
  copyFile(TOKENS_FILE, path.join(dist, "tokens.css")),
  copyFile(
    webRequire.resolve("@fontsource-variable/geist/files/geist-latin-wght-normal.woff2"),
    path.join(dist, "geist-latin-wght-normal.woff2"),
  ),
]);
