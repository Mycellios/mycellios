import asar from "@electron/asar";
import { readFile, writeFile, mkdir, cp, copyFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import assert from "node:assert/strict";

const extract = (archive, file) => asar.extractFile(archive, path.normalize(file));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const output = path.resolve("../../outputs/apps-local");
const resources = path.join(process.env.LOCALAPPDATA, "Programs", "mycellios-desktop", "resources");
const profile = path.join(process.env.APPDATA, "Mycellios Agent");
const original = path.join(resources, "app.asar");
const preferenceFile = path.join(profile, "local-renderer.json");
const receiptFile = path.join(output, "install.json");

if (process.argv.includes("--apply")) {
  const receipt = JSON.parse(await readFile(receiptFile, "utf8"));
  assert.equal(
    hash(await readFile(original)),
    receipt.originalAsar,
    "Desktop changed after preparation; preserve it and prepare again.",
  );
  assert.equal(
    hash(await readFile(preferenceFile)),
    receipt.originalPreference,
    "Renderer changed after preparation; preserve it and prepare again.",
  );
  assert.equal(hash(await readFile(path.join(output, "app.asar"))), receipt.candidateAsar);
  assert.match(receipt.rendererStage, /^renderer-install-[0-9]+$/);
  assert.equal(hash(await readFile(path.join(profile, receipt.preference.directory, "index.html"))), receipt.baseIndexHash, "The installed UI changed; prepare again without losing that update.");
  const suffix = new Date().toISOString().replace(/[:.]/g, "-");
  await copyFile(original, `${original}.before-apps-${suffix}`);
  await copyFile(preferenceFile, `${preferenceFile}.before-apps-${suffix}`);
  const directory = `local-web/${receipt.rendererHash}`;
  await cp(path.join(output, receipt.rendererStage), path.join(profile, directory), {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  // Apply only after the ordinary Desktop has exited. No process is killed here.
  await copyFile(path.join(output, "app.asar"), original);
  await writeFile(preferenceFile, JSON.stringify({ ...receipt.preference, directory }, null, 2));
  await writeFile(
    path.join(output, "applied.json"),
    JSON.stringify(
      {
        appliedAt: new Date().toISOString(),
        originalAsar: receipt.originalAsar,
        candidateAsar: receipt.candidateAsar,
        directory,
        production: false,
      },
      null,
      2,
    ),
  );
  console.log("Installed only in the ordinary local Desktop profile. Production unchanged.");
} else {
  const originalBytes = await readFile(original);
  const preferenceBytes = await readFile(preferenceFile);
  const preference = JSON.parse(preferenceBytes.toString());
  assert.equal(preference.schema, "mycellios-local-renderer/1");
  assert.match(preference.directory, /^local-web\/[a-f0-9]{64}$/);
  let main = extract(original, "dist/main.js").toString();
  let preload = extract(original, "dist/preload.cjs").toString();
  assert(
    !main.includes("apps-studio-ipc.mjs"),
    "Apps is already installed; do not layer a second installation.",
  );
  const matches = [...main.matchAll(/\b(ipcMain\d*)\.handle\("desktop\.runtime\.status"/g)];
  assert.equal(matches.length, 1, "Unknown installed Desktop entry point.");
  for (const name of [
    "mainWindow",
    "fromMainWindow",
    "hostComputer",
    "isCloudComputerRequest",
    "getCloudComputer",
    "nativeProjectSpace",
    "cloudComputerOwner",
    "projectServer",
    "userDataDir",
  ])
    assert(main.includes(name), `Missing existing authority ${name}`);
  const source = await readFile("apps/desktop/src/main.ts", "utf8");
  const start = source.indexOf("  installAppsStudio({ userData:");
  const end = source.indexOf('  ipcMain.handle("desktop.runtime.status"', start);
  assert(start > 0 && end > start);
  let hook = source
    .slice(start, end)
    .replace("installAppsStudio(", '(await import("./apps-studio-ipc.mjs")).installAppsStudio(');
  // The committed hook deliberately contains no TypeScript-only syntax.
  main = main.replace(matches[0][0], hook + matches[0][0]);
  const bridge =
    '  appsStudio: { request: input => ipcRenderer.invoke("desktop.apps.studio", input) },\n';
  assert.equal(preload.split('contextBridge.exposeInMainWorld("rakazoDesktop", {').length, 2);
  preload = preload.replace(
    'contextBridge.exposeInMainWorld("rakazoDesktop", {',
    'contextBridge.exposeInMainWorld("rakazoDesktop", {\n' + bridge,
  );
  const changes = new Map([
    ["dist/main.js", Buffer.from(main)],
    ["dist/preload.cjs", Buffer.from(preload)],
    ["dist/apps-studio-ipc.mjs", await readFile(path.join(output, "apps-studio-ipc.mjs"))],
  ]);
  const entries = [];
  const oldFiles = [];
  function walk(files, prefix = "") {
    for (const [name, entry] of Object.entries(files)) {
      const file = prefix + name;
      if (entry.files) {
        entries.push({ path: file, type: "directory", unpacked: Boolean(entry.unpacked) });
        walk(entry.files, file + "/");
      } else {
        assert(!entry.link, "A linked package needs separate preservation review.");
        oldFiles.push(file);
        const bytes = changes.get(file) ?? extract(original, file);
        entries.push({
          path: file,
          type: "file",
          unpacked: Boolean(entry.unpacked),
          stat: { size: bytes.length, mode: entry.executable ? 0o755 : 0o644 },
          streamGenerator: () => Readable.from(bytes),
        });
      }
    }
  }
  walk(asar.getRawHeader(original).header.files);
  for (const [file, bytes] of changes)
    if (!oldFiles.includes(file))
      entries.push({
        path: file,
        type: "file",
        unpacked: false,
        stat: { size: bytes.length, mode: 0o644 },
        streamGenerator: () => Readable.from(bytes),
      });
  await mkdir(output, { recursive: true });
  const candidate = path.join(output, "app.asar");
  await finished(await asar.createPackageFromStreams(candidate, entries));
  for (const file of oldFiles)
    assert.equal(
      hash(extract(candidate, file)),
      hash(changes.get(file) ?? extract(original, file)),
      `Package preservation: ${file}`,
    );
  const base = path.join(profile, preference.directory);
  const rendererStage = `renderer-install-${Date.now()}`;
  const renderer = path.join(output, rendererStage);
  await cp(base, renderer, { recursive: true, errorOnExist: true, force: false });
  await cp(path.join(output, "renderer"), path.join(renderer, "apps-preview"), { recursive: true });
  const index = await readFile(path.join(renderer, "index.html"), "utf8");
  assert(!index.includes("apps-preview/apps-preview.js"));
  await writeFile(
    path.join(renderer, "index.html"),
    index.replace(
      "</head>",
      '<link rel="stylesheet" href="/agent/apps-preview/apps-preview.css"><script type="module" src="/agent/apps-preview/apps-preview.js"></script></head>',
    ),
  );
  const rendererHash = hash(
    (await readFile(path.join(renderer, "index.html"))) +
      hash(await readFile(path.join(output, "renderer", "apps-preview.js"))),
  );
  await writeFile(
    receiptFile,
    JSON.stringify(
      {
        schema: "mycellios-apps-local-install/1",
        originalAsar: hash(originalBytes),
        candidateAsar: hash(await readFile(candidate)),
        originalPreference: hash(preferenceBytes),
        preference,
      rendererHash,
      rendererStage,
      baseIndexHash: hash(Buffer.from(index)),
        preservedPackageFiles: oldFiles.length - 2,
        production: false,
      },
      null,
      2,
    ),
  );
  console.log(
    `Prepared local install; preserved ${oldFiles.length - 2} other packaged files and the existing renderer. Not applied.`,
  );
}
