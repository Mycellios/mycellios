import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// tsc only emits the TypeScript sources; the preload bridges and the setup
// window's static assets have to be copied into dist alongside them.
const STATIC_FILES = ["preload.cjs", "setup-preload.cjs", "setup.html", "setup.css", "setup.js", "window-chrome.html", "window-native-chrome.html", "window-chrome.css", "window-chrome-preload.cjs"];
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
await Promise.all([
  ...STATIC_FILES.map((file) => copyFile(path.join(root, "src", file), path.join(dist, file))),
  copyFile(TOKENS_FILE, path.join(dist, "tokens.css")),
  copyFile(
    webRequire.resolve("@fontsource-variable/geist/files/geist-latin-wght-normal.woff2"),
    path.join(dist, "geist-latin-wght-normal.woff2"),
  ),
]);
