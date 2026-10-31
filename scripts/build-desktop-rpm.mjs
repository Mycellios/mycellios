import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { closeSync, createReadStream, createWriteStream, openSync } from "node:fs";
import { chmod, copyFile, lstat, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const FEDORA_REQUIRES = Object.freeze([
  "gtk3", "libnotify", "nss", "libXScrnSaver", "libXtst", "xdg-utils",
  "at-spi2-core", "libuuid", "alsa-lib", "mesa-libgbm", "libsecret", "libgomp", "cups-libs",
  "libXcomposite", "libXdamage", "libXrandr", "libXfixes", "libxcb", "libxkbcommon", "libdrm",
  "systemd", "polkit", "shared-mime-info", "binutils", "tar", "gzip", "xz", "zstd", "util-linux", "gawk",
]);
const productPath = "opt/Mycellios Desktop";

export async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

export async function verifyPinnedFile(file, expected) {
  if (!/^[a-f0-9]{64}$/.test(expected)) throw new Error("desktop_rpm_invalid_sha256");
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("desktop_rpm_requires_regular_file");
  if (await sha256(file) !== expected) throw new Error("desktop_rpm_input_hash_mismatch");
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", shell: false, maxBuffer: 8 * 1024 * 1024, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command}_failed:${result.stderr ?? ""}`);
  return result.stdout ?? "";
}

function extractArMember(archive, member, output) {
  const fd = openSync(output, "w", 0o644);
  try { run("ar", ["p", archive, member], { stdio: ["ignore", fd, "pipe"] }); }
  finally { closeSync(fd); }
}

export function validateRelease(release) {
  if (!/^\d+\.\d+\.\d+$/.test(release.version) || !/^\d+\.\d+\.\d+$/.test(release.runtimeVersion)
    || !/^[a-f0-9]{40}$/.test(release.baseline)) throw new Error("desktop_rpm_invalid_release");
  for (const artifact of [release.desktop, release.source]) {
    const url = new URL(artifact.url);
    if (url.origin !== "https://www.mycellios.com" || url.search || url.hash
      || !url.pathname.startsWith(`/downloads/desktop/releases/${release.version}/`)
      || !/^[a-f0-9]{64}$/.test(artifact.sha256)) throw new Error("desktop_rpm_invalid_release_artifact");
  }
}

async function ensureDownload(artifact, directory) {
  const file = join(directory, basename(new URL(artifact.url).pathname));
  try { await lstat(file); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    const temporary = `${file}.download`;
    try {
      const response = await fetch(artifact.url, { headers: { "User-Agent": "Mozilla/5.0 Mycellios-Fedora-Builder" } });
      if (!response.ok || !response.body) throw new Error(`desktop_rpm_download_failed:${response.status}`);
      await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary, { flags: "wx" }));
      await verifyPinnedFile(temporary, artifact.sha256);
      await copyFile(temporary, file);
    } finally { await rm(temporary, { force: true }); }
  }
  await verifyPinnedFile(file, artifact.sha256);
  return file;
}

function quoteSpecPath(path) {
  if (/[\n\r%"\\]/.test(path)) throw new Error("desktop_rpm_unsafe_path");
  return `"${path}"`;
}

async function rpmFileList(root) {
  const lines = [];
  async function visit(relative) {
    for (const item of (await readdir(join(root, relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = relative ? `${relative}/${item.name}` : item.name;
      if (item.isDirectory()) {
        if (path === productPath || path.startsWith(`${productPath}/`) || path === "usr/share/doc/mycellios-desktop") {
          lines.push(`%dir ${quoteSpecPath(`/${path}`)}`);
        }
        await visit(path);
      } else if (item.isFile() || item.isSymbolicLink()) lines.push(quoteSpecPath(`/${path}`));
      else throw new Error(`desktop_rpm_special_file:${path}`);
    }
  }
  await visit("");
  return `${lines.join("\n")}\n`;
}

export function renderRpmSpec({ version, root, fileList }) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("desktop_rpm_invalid_version");
  const stage = quoteSpecPath(root);
  return [
    "%global debug_package %{nil}", "%global __os_install_post %{nil}", "%global _build_id_links none",
    "Name: mycellios-desktop", `Version: ${version}`, "Release: 1", "Summary: Mycellios Desktop with the contribution runtime",
    "License: GPL-3.0-only AND Apache-2.0 AND MIT AND BSD-3-Clause", "URL: https://www.mycellios.com",
    "BuildArch: x86_64", "AutoReqProv: no", `Requires: ${FEDORA_REQUIRES.join(", ")}`,
    "", "%description", "Mycellios agents and projects with an optional account-enrolled contribution runtime.",
    "", "%install", 'mkdir -p "%{buildroot}"', `cp -a ${stage}/. "%{buildroot}/"`,
    "", "%post", "update-desktop-database /usr/share/applications >/dev/null 2>&1 || :",
    "", "%postun", "update-desktop-database /usr/share/applications >/dev/null 2>&1 || :",
    "", `%files -f ${quoteSpecPath(fileList)}`, "%defattr(-,root,root)", "",
  ].join("\n");
}

export async function buildDesktopRpm({ release, deb, source, outputDirectory, installer }) {
  validateRelease(release);
  if (process.platform !== "linux" || process.arch !== "x64") throw new Error("desktop_rpm_requires_linux_x64");
  await verifyPinnedFile(deb, release.desktop.sha256);
  await verifyPinnedFile(source, release.source.sha256);
  const output = resolve(outputDirectory);
  const work = join(output, "work");
  await rm(work, { recursive: true, force: true });
  const root = join(work, "root");
  await mkdir(root, { recursive: true });
  const data = join(work, "data.tar.gz");
  const members = run("ar", ["t", resolve(deb)]).trim().split(/\r?\n/);
  if (members.join(",") !== "debian-binary,control.tar.gz,data.tar.gz") throw new Error("desktop_rpm_unexpected_deb_layout");
  extractArMember(resolve(deb), "control.tar.gz", join(work, "control.tar.gz"));
  const control = run("tar", ["-xOf", join(work, "control.tar.gz"), "./control"]);
  for (const field of ["Package: mycellios-desktop", `Version: ${release.version}`, "Architecture: amd64"]) {
    if (!control.split(/\r?\n/).includes(field)) throw new Error(`desktop_rpm_control_mismatch:${field}`);
  }
  extractArMember(resolve(deb), "data.tar.gz", data);
  run("tar", ["-xzf", data, "-C", root, "--no-same-owner"]);
  await rm(data);
  const resources = join(root, productPath, "resources");
  const runtime = JSON.parse(await readFile(join(resources, "contribution/runtime.json"), "utf8"));
  if (runtime.schema !== "mycellios-desktop-runtime/1" || runtime.file !== "mycellios-runtime.deb") {
    throw new Error("desktop_rpm_runtime_manifest_mismatch");
  }
  await verifyPinnedFile(join(resources, "contribution", runtime.file), runtime.sha256);
  const applicationSha256 = await sha256(join(resources, "app.asar"));
  await copyFile(installer, join(resources, "contribution/install-runtime.sh"));
  await chmod(join(resources, "contribution/install-runtime.sh"), 0o755);
  // Fedora supports Chromium's user-namespace sandbox; keep the upstream helper unprivileged.
  await chmod(join(root, productPath, "chrome-sandbox"), 0o755);
  await mkdir(join(root, "usr/bin"), { recursive: true });
  await symlink(`/${productPath}/mycellios-desktop`, join(root, "usr/bin/mycellios-desktop"));
  const provenance = {
    schema: "mycellios-desktop-fedora/1", version: release.version, runtimeVersion: release.runtimeVersion,
    baseline: release.baseline, desktop: release.desktop, source: release.source,
    applicationSha256, runtimeSha256: runtime.sha256, installerSha256: await sha256(installer),
    adaptation: "Fedora RPM integration and hash-verified runtime extraction without dpkg; application and runtime bytes retained",
  };
  const doc = join(root, "usr/share/doc/mycellios-desktop");
  await mkdir(doc, { recursive: true });
  await writeFile(join(doc, "fedora-build.json"), `${JSON.stringify(provenance, null, 2)}\n`);
  const fileList = join(work, "files.list");
  await writeFile(fileList, await rpmFileList(root));
  const spec = join(work, "mycellios-desktop.spec");
  await writeFile(spec, renderRpmSpec({ version: release.version, root, fileList }));
  for (const directory of ["BUILD", "BUILDROOT", "RPMS", "SOURCES", "SPECS", "SRPMS"]) await mkdir(join(work, directory), { recursive: true });
  console.log("Building Fedora x86_64 RPM from verified Desktop and runtime payloads…");
  run("rpmbuild", ["-bb", spec, "--define", `_topdir ${work}`, "--define", "_binary_payload w3.zstdio",
    "--define", "_rpmformat 4", "--define", "_buildhost mycellios-fedora-builder"]);
  const rpm = join(output, `Mycellios-Desktop-${release.version}-fedora-x86_64.rpm`);
  await copyFile(join(work, "RPMS/x86_64", `mycellios-desktop-${release.version}-1.x86_64.rpm`), rpm);
  const metadata = run("rpm", ["-qp", "--qf", "%{NAME}|%{VERSION}|%{ARCH}", rpm]);
  if (metadata !== `mycellios-desktop|${release.version}|x86_64`) throw new Error("desktop_rpm_output_metadata_mismatch");
  await writeFile(`${rpm}.sha256`, `${await sha256(rpm)}  ${basename(rpm)}\n`);
  await writeFile(`${rpm}.provenance.json`, `${JSON.stringify(provenance, null, 2)}\n`);
  console.log(`RPM: ${rpm}`);
  return { rpm, root, provenance };
}

async function main() {
  const release = JSON.parse(await readFile(join(repository, "config/desktop-fedora-release.json"), "utf8"));
  validateRelease(release);
  const outputDirectory = join(repository, "build/desktop-rpm");
  await mkdir(outputDirectory, { recursive: true });
  const deb = await ensureDownload(release.desktop, outputDirectory);
  const source = await ensureDownload(release.source, outputDirectory);
  await buildDesktopRpm({ release, deb, source, outputDirectory, installer: join(repository, "deploy/linux/install-desktop-runtime.sh") });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
