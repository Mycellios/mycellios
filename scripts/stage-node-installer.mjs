import { createHash, createPublicKey } from "node:crypto";
import { chmod, cp, lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { buildNativeSourceProvenance, verifyNativeBuildProvenanceDocument } from "./native-build-provenance.mjs";
import { verifyNativePythonProductSource } from "./native-python-product-policy.mjs";

export const NODE_INSTALLER_LAYOUT_SCHEMA = "mycellios-node-installer-layout/2";
export const NODE_APP_COMPONENT_SCHEMA = "mycellios-node-app-component/1";
const PRODUCTION_DEPENDENCIES = ["ws", "zod"];
/** Read by app/contracts/model-adapter-registry.js from <root>/python. */
const NODE_APP_PYTHON_FILES = ["distributed_runtime/model_adapter_registry.json"];
/**
 * Windows service host: WinSW 2.12.0 x64 (github.com/winsw/winsw, release
 * v2.12.0, WinSW-x64.exe). service-registration.ts copies bin/MycelliosNode.exe
 * next to the service definition; without it sc.exe has nothing to register.
 */
export const WINDOWS_SERVICE_WRAPPER = Object.freeze({
  file: "MycelliosNode.exe",
  url: "https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe",
  bytes: 18_243_033,
  sha256: "05b82d46ad331cc16bdc00de5c6332c1ef818df8ceefcd49c726553209b3a0da",
});
/** Built from sidecars/windows-job-broker; node.json's isolation.brokerExecutable. */
export const WINDOWS_JOB_BROKER_FILE = "mycellios-job-broker.exe";

export async function stageNodeInstaller(input) {
  const output = resolve(input.output);
  const dist = resolve(input.dist);
  const runtime = resolve(input.runtime);
  const nodeExecutable = resolve(input.nodeExecutable);
  const modules = resolve(input.nodeModules);
  const python = resolve(input.pythonSource);
  if (!/^[a-f0-9]{40}$/.test(input.sourceRevision)) throw new Error("node_installer_source_revision_is_invalid");
  const provenance = verifyNativeBuildProvenanceDocument(input.sourceProvenance);
  if (output === dist || output === runtime || output === modules || output === python || output === dirname(output)) {
    throw new Error("node_installer_output_is_unsafe");
  }
  await assertDirectory(dist, "node_installer_dist_is_missing");
  await assertDirectory(runtime, "node_installer_runtime_is_missing");
  await assertRegularFile(nodeExecutable, "node_installer_node_executable_is_missing");
  await assertRegularFile(join(dist, "node", "main.js"), "node_installer_main_is_missing");
  await assertRegularFile(join(dist, "node", "install-main.js"), "node_installer_bootstrap_is_missing");
  await assertRegularFile(join(dist, "node", "uninstall-main.js"), "node_installer_uninstall_helper_is_missing");
  const runtimeManifest = JSON.parse(await readFile(join(runtime, "runtime-manifest.json"), "utf8"));
  const [platform, arch] = parseTarget(input.target);
  if (runtimeManifest.platform !== platform || runtimeManifest.arch !== arch) {
    throw new Error("node_installer_runtime_target_mismatch");
  }
  await assertSymlinksStayInside(runtime);
  // node.json points runtime.pythonPath at <installRoot>/python (installation-bootstrap.ts).
  verifyNativePythonProductSource(python);
  const windowsBinaries = platform === "win32" ? await windowsServiceBinaries(input) : [];
  await rm(output, { recursive: true, force: true });
  await mkdir(join(output, "bin"), { recursive: true });
  const [{ provenanceBytes }] = await Promise.all([
    writeNodeAppTree({ output, dist, modules, python, pythonFiles: "all", sourceRevision: input.sourceRevision, provenance }),
    copyTree(runtime, join(output, "runtime"), { materializeInternalSymlinks: true }),
    cp(nodeExecutable, join(output, "bin", platform === "win32" ? "node.exe" : "node")),
    ...windowsBinaries.map(({ source, file }) => cp(source, join(output, "bin", file))),
  ]);
  if (input.componentTrust !== undefined) {
    // Signed component-update trust anchor (specs/node-runtime-auto-update).
    await writeFile(join(output, "app", NODE_COMPONENT_TRUST_FILE), serializeComponentTrust(input.componentTrust), { flag: "wx" });
  }
  if (platform !== "win32") await (await import("node:fs/promises")).chmod(join(output, "bin", "node"), 0o755);
  const launcher = await writeInstallerLauncher(output, platform);
  const files = await inventoryNodeInstaller(output);
  const manifest = {
    schema: NODE_INSTALLER_LAYOUT_SCHEMA,
    target: input.target,
    sourceRevision: input.sourceRevision,
    source: { revision: input.sourceRevision, sourceId: provenance.sourceId, provenanceSha256: sha256(provenanceBytes), version: provenance.version },
    toolchain: { nodeVersion: process.version, pythonVersion: runtimeManifest.pythonVersion ?? "unknown",
      pythonAbi: runtimeManifest.pythonAbi ?? "unknown", backend: runtimeManifest.backend ?? "unknown" },
    entrypoints: {
      service: "app/node/main.js",
      install: "app/node/install-main.js",
      uninstall: "app/node/uninstall-main.js",
      launcher,
    },
    runtimeManifestSha256: sha256(await readFile(join(output, "runtime", "runtime-manifest.json"))),
    files,
  };
  await writeFile(join(output, "layout-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  return manifest;
}

/**
 * Stages the signed `node-app` component (specs/node-runtime-auto-update): the
 * same package.json, app/ and production node_modules as the installer layout,
 * plus the adapter registry its JavaScript reads from <root>/python. It has no
 * bin/, runtime/, launchers, Python product (that is python-product) or trust
 * anchor: a component cannot replace the anchor its bootstrap pins.
 */
export async function stageNodeApp(input) {
  const output = resolve(input.output);
  const dist = resolve(input.dist);
  const modules = resolve(input.nodeModules);
  const python = resolve(input.pythonSource);
  if (!/^[a-f0-9]{40}$/.test(input.sourceRevision)) throw new Error("node_installer_source_revision_is_invalid");
  const provenance = verifyNativeBuildProvenanceDocument(input.sourceProvenance);
  if (output === dist || output === modules || output === python || output === dirname(output)) {
    throw new Error("node_installer_output_is_unsafe");
  }
  verifyNativePythonProductSource(python);
  await assertDirectory(dist, "node_installer_dist_is_missing");
  await assertRegularFile(join(dist, "node", "main.js"), "node_installer_main_is_missing");
  await assertRegularFile(join(dist, "node", "component-canary.js"), "node_app_component_canary_is_missing");
  await assertAbsent(join(dist, NODE_COMPONENT_TRUST_FILE), "node_app_component_contains_trust_anchor");
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  const { provenanceBytes } = await writeNodeAppTree({
    output, dist, modules, python, pythonFiles: NODE_APP_PYTHON_FILES, sourceRevision: input.sourceRevision, provenance,
  });
  return {
    schema: NODE_APP_COMPONENT_SCHEMA,
    sourceRevision: input.sourceRevision,
    source: { revision: input.sourceRevision, sourceId: provenance.sourceId, provenanceSha256: sha256(provenanceBytes), version: provenance.version },
    files: await inventoryNodeInstaller(output),
  };
}

/** One node app layout for both the installer and the `node-app` component. */
async function writeNodeAppTree({ output, dist, modules, python, pythonFiles, sourceRevision, provenance }) {
  await Promise.all([
    copyTree(dist, join(output, "app")),
    ...(pythonFiles === "all"
      ? [copyTree(python, join(output, "python"))]
      : pythonFiles.map(async (portable) => {
        const destination = join(output, "python", ...portable.split("/"));
        await mkdir(dirname(destination), { recursive: true });
        await cp(join(python, ...portable.split("/")), destination, { errorOnExist: true, force: false });
      })),
    ...PRODUCTION_DEPENDENCIES.map(async (dependency) => {
      const source = join(modules, dependency);
      await assertDirectory(source, `node_installer_dependency_is_missing:${dependency}`);
      await copyTree(source, join(output, "node_modules", dependency));
    }),
  ]);
  // app/node/main.js and the component canary read <root>/package.json.
  await writeFile(join(output, "package.json"), `${JSON.stringify({
    name: "mycellios-node", version: provenance.version, private: true, type: "module",
  }, null, 2)}\n`, { flag: "wx" });
  const provenanceBytes = Buffer.from(`${JSON.stringify(provenance, null, 2)}\n`);
  await writeFile(join(output, "app", "mycellios-native-build-provenance.json"), provenanceBytes, { flag: "wx" });
  await writeFile(join(output, "app", "manifest.json"), `${JSON.stringify({
    schema: "mycellios-node-runtime-identity/1", version: provenance.version, sourceRevision,
    sourceId: provenance.sourceId, provenanceSha256: sha256(provenanceBytes),
  }, null, 2)}\n`, { flag: "wx" });
  return { provenanceBytes };
}

async function assertAbsent(path, error) {
  if (await lstat(path).catch(() => null)) throw new Error(error);
}

async function writeInstallerLauncher(root, platform) {
  if (platform === "win32") {
    const path = join(root, "install.ps1");
    await writeFile(path, [
      "param([Parameter(Mandatory=$true)][string]$Enrollment)",
      "$ErrorActionPreference='Stop'",
      "$principal=New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())",
      "if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){",
      '  $arguments="-NoProfile -ExecutionPolicy Bypass -File `"$($MyInvocation.MyCommand.Path)`" -Enrollment `"$Enrollment`""',
      "  $process=Start-Process powershell.exe -Verb RunAs -ArgumentList $arguments -Wait -PassThru",
      "  exit $process.ExitCode",
      "}",
      "$root=Split-Path -Parent $MyInvocation.MyCommand.Path",
      "& (Join-Path $root 'bin\\node.exe') (Join-Path $root 'app\\node\\install-main.js') --install-root $root --enrollment $Enrollment",
      "if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}",
      "",
    ].join("\r\n"), { flag: "wx" });
    return "install.ps1";
  }
  const path = join(root, "install");
  await writeFile(path, [
    "#!/bin/sh", "set -eu", "if [ \"$(id -u)\" -ne 0 ]; then echo 'Root privileges are required' >&2; exit 1; fi",
    "if [ \"$#\" -ne 1 ]; then echo 'usage: install <pairing.mycellios-enrollment>' >&2; exit 2; fi",
    "root=$(CDPATH= cd -- \"$(dirname -- \"$0\")\" && pwd -P)",
    "exec \"$root/bin/node\" \"$root/app/node/install-main.js\" --install-root \"$root\" --enrollment \"$1\"", "",
  ].join("\n"), { flag: "wx", mode: 0o755 });
  await chmod(path, 0o755);
  return "install";
}

export async function inventoryNodeInstaller(root, excluded = new Set()) {
  const files = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absolute = join(directory, entry.name);
      const portablePath = relative(root, absolute).replaceAll("\\", "/");
      if (excluded.has(portablePath)) continue;
      if (entry.isSymbolicLink()) throw new Error(`node_installer_symlink_is_forbidden:${relative(root, absolute)}`);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) {
        const bytes = await readFile(absolute);
        files.push({ path: portablePath, bytes: bytes.byteLength, sha256: sha256(bytes) });
      } else throw new Error(`node_installer_special_file_is_forbidden:${relative(root, absolute)}`);
    }
  }
  await visit(root);
  return files;
}

async function copyTree(source, destination, options = {}) {
  await cp(source, destination, {
    recursive: true,
    dereference: options.materializeInternalSymlinks === true,
    errorOnExist: true,
    force: false,
  });
}

async function assertSymlinksStayInside(root) {
  const canonicalRoot = await realpath(root);
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        const target = await realpath(absolute).catch(() => null);
        if (!target || (target !== canonicalRoot && !target.startsWith(`${canonicalRoot}${sep}`))) {
          throw new Error(`node_installer_runtime_symlink_escapes_root:${relative(root, absolute)}`);
        }
      } else if (entry.isDirectory()) await visit(absolute);
    }
  }
  await visit(root);
}

async function assertDirectory(path, error) {
  const stats = await lstat(path).catch(() => null);
  if (!stats?.isDirectory() || stats.isSymbolicLink()) throw new Error(error);
}

async function assertRegularFile(path, error) {
  const stats = await lstat(path).catch(() => null);
  if (!stats?.isFile() || stats.isSymbolicLink()) throw new Error(error);
}

/**
 * A Windows node cannot register its service or contain its executors without
 * these two files, so a Windows layout is refused rather than staged without them.
 */
async function windowsServiceBinaries(input) {
  if (!input.windowsServiceWrapper) throw new Error("node_installer_windows_service_wrapper_is_missing");
  if (!input.windowsJobBroker) throw new Error("node_installer_windows_job_broker_is_missing");
  const wrapper = resolve(input.windowsServiceWrapper);
  const broker = resolve(input.windowsJobBroker);
  await assertRegularFile(wrapper, "node_installer_windows_service_wrapper_is_missing");
  await assertRegularFile(broker, "node_installer_windows_job_broker_is_missing");
  const expected = input.trustedServiceWrapperSha256 ?? WINDOWS_SERVICE_WRAPPER.sha256;
  if (sha256(await readFile(wrapper)) !== expected) throw new Error("node_installer_windows_service_wrapper_digest_mismatch");
  if ((await readFile(broker)).subarray(0, 2).toString("latin1") !== "MZ") {
    throw new Error("node_installer_windows_job_broker_is_not_executable");
  }
  return [{ source: wrapper, file: WINDOWS_SERVICE_WRAPPER.file }, { source: broker, file: WINDOWS_JOB_BROKER_FILE }];
}

function parseTarget(target) {
  const match = /^(linux|macos|windows|darwin|win32)-(x64|arm64)$/.exec(target);
  if (!match) throw new Error("node_installer_target_is_invalid");
  const platform = match[1] === "windows" ? "win32" : match[1] === "macos" ? "darwin" : match[1];
  return [platform, match[2]];
}

export const NODE_COMPONENT_TRUST_FILE = "component-update-trust.json";

/** Mirrors src/node/update-trust.ts; the node re-validates it strictly. */
export function serializeComponentTrust(value) {
  const keys = ["feedUrl", "pinnedKeys"];
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join() !== keys.join()) {
    throw new Error("node_installer_component_trust_shape_is_invalid");
  }
  const url = new URL(value.feedUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("node_installer_component_trust_feed_is_invalid");
  }
  const pinned = value.pinnedKeys;
  if (!pinned || typeof pinned !== "object" || Object.keys(pinned).sort().join() !== "dev,stable") {
    throw new Error("node_installer_component_trust_keys_are_invalid");
  }
  for (const channel of ["dev", "stable"]) {
    const list = pinned[channel];
    if (!Array.isArray(list) || list.length > 8) throw new Error("node_installer_component_trust_keys_are_invalid");
    const seen = new Set();
    for (const key of list) {
      if (!key || Object.keys(key).sort().join() !== "keyId,spki" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(key.keyId)
        || seen.has(key.keyId) || !isEd25519Spki(key.spki)) throw new Error("node_installer_component_trust_keys_are_invalid");
      seen.add(key.keyId);
    }
  }
  if (pinned.stable.length === 0 && pinned.dev.length === 0) throw new Error("node_installer_component_trust_keys_are_empty");
  return `${JSON.stringify({ schema: "mycellios-node-component-trust/1", componentUpdates: { feedUrl: value.feedUrl, pinnedKeys: pinned } }, null, 2)}
`;
}

function isEd25519Spki(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,256}$/.test(value)) return false;
  try {
    const bytes = Buffer.from(value, "base64url");
    const key = createPublicKey({ key: bytes, format: "der", type: "spki" });
    return key.asymmetricKeyType === "ed25519" && Buffer.from(key.export({ format: "der", type: "spki" })).equals(bytes);
  } catch { return false; }
}

function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }

async function main(argv) {
  const values = Object.fromEntries(argv.map((argument) => {
    const match = /^--([^=]+)=(.+)$/.exec(argument);
    if (!match) throw new Error(`node_installer_argument_is_invalid:${argument}`);
    return [match[1], match[2]];
  }));
  if (values.component !== undefined) {
    // --component=node-app stages only the signed node-app component root.
    if (values.component !== "node-app") throw new Error(`node_installer_component_is_invalid:${values.component}`);
    for (const key of ["output", "dist", "node-modules", "python-source", "source-revision", "source-root"]) {
      if (!values[key]) throw new Error(`node_installer_argument_is_missing:${key}`);
    }
    const staged = await stageNodeApp({ output: values.output, dist: values.dist, nodeModules: values["node-modules"], pythonSource: values["python-source"],
      sourceRevision: values["source-revision"], sourceProvenance: buildNativeSourceProvenance(values["source-root"]) });
    process.stdout.write(`node-app component staged: ${staged.files.length} files, ${staged.source.sourceId}\n`);
    return;
  }
  for (const key of ["output", "dist", "runtime", "node-executable", "node-modules", "python-source", "target", "source-revision", "source-root"]) {
    if (!values[key]) throw new Error(`node_installer_argument_is_missing:${key}`);
  }
  await stageNodeInstaller({ output: values.output, dist: values.dist, runtime: values.runtime,
    nodeExecutable: values["node-executable"], nodeModules: values["node-modules"], pythonSource: values["python-source"], target: values.target,
    sourceRevision: values["source-revision"], sourceProvenance: buildNativeSourceProvenance(values["source-root"]),
    ...(values["windows-service-wrapper"] ? { windowsServiceWrapper: values["windows-service-wrapper"] } : {}),
    ...(values["windows-job-broker"] ? { windowsJobBroker: values["windows-job-broker"] } : {}),
    ...(values["component-trust"] ? { componentTrust: JSON.parse(await readFile(values["component-trust"], "utf8")) } : {}) });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main(process.argv.slice(2));
