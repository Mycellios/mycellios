import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import { Readable } from "node:stream";
import { createPackageFromStreams, extractFile, listPackage, statFile } from "@electron/asar";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Backport two Linux-only fixes to the pinned 0.3.9 desktop bundle. */
export function patchDesktopMain(source) {
  const replacements = [
    ["    frame: mac5,", '    frame: mac5 || platform === "linux",'],
    ["function developmentIcon() {\n  if (app2.isPackaged) return void 0;",
      'function developmentIcon() {\n  if (app2.isPackaged) return process.platform === "linux" ? path12.join(process.resourcesPath, "web", "mycellios", "app-icon-v2-512.png") : void 0;'],
  ];
  let patched = source;
  for (const [before, after] of replacements) {
    if (patched.split(before).length !== 2) throw new Error("desktop_linux_unexpected_main_bundle");
    patched = patched.replace(before, after);
  }
  return patched;
}

/** Preserve every other file, executable bit and native-module unpack flag. */
export async function adaptDesktopLinux(archive, output) {
  const names = listPackage(archive).map(name => name.replaceAll("\\", "/").replace(/^\/+/, ""));
  const originalMain = extractFile(archive, "dist/main.js");
  const patchedMain = Buffer.from(patchDesktopMain(originalMain.toString("utf8")));
  const streams = names.map(name => {
    if (!name || name.split("/").some(part => part === ".." || part === "")) throw new Error("desktop_linux_unsafe_asar_path");
    const entry = statFile(archive, name, false);
    const base = { path: name, unpacked: Boolean(entry.unpacked) };
    if ("files" in entry) return { ...base, type: "directory" };
    if ("link" in entry) throw new Error("desktop_linux_unexpected_asar_link");
    const size = name === "dist/main.js" ? patchedMain.length : entry.size;
    const mode = entry.unpacked ? statSync(`${archive}.unpacked/${name}`).mode : entry.executable ? 0o100755 : 0o100644;
    return { ...base, type: "file", stat: { size, mode },
      streamGenerator: () => Readable.from(name === "dist/main.js" ? patchedMain : extractFile(archive, name)) };
  });
  await createPackageFromStreams(output, streams);
  const outputNames = listPackage(output).map(name => name.replaceAll("\\", "/").replace(/^\/+/, ""));
  if (JSON.stringify(names) !== JSON.stringify(outputNames)) throw new Error("desktop_linux_asar_inventory_changed");
  let retainedFiles = 0;
  for (const name of names) {
    const before = statFile(archive, name, false);
    const after = statFile(output, name, false);
    if (Boolean(before.unpacked) !== Boolean(after.unpacked) || Boolean(before.executable) !== Boolean(after.executable)) {
      throw new Error(`desktop_linux_asar_metadata_changed:${name}`);
    }
    if ("files" in before) continue;
    if (before.unpacked && (statSync(`${archive}.unpacked/${name}`).mode & 0o777) !== (statSync(`${output}.unpacked/${name}`).mode & 0o777)) {
      throw new Error(`desktop_linux_unpacked_mode_changed:${name}`);
    }
    const expected = name === "dist/main.js" ? patchedMain : extractFile(archive, name);
    if (digest(expected) !== digest(extractFile(output, name))) throw new Error(`desktop_linux_asar_content_changed:${name}`);
    if (name !== "dist/main.js") retainedFiles++;
  }
  return { changedFiles: ["dist/main.js"], retainedFiles, originalMainSha256: digest(originalMain), patchedMainSha256: digest(patchedMain) };
}
