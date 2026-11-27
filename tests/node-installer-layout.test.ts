import { createHash } from "node:crypto";
import { access, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stageNodeInstaller } from "../scripts/stage-node-installer.mjs";
import { verifyNodeInstaller } from "../scripts/verify-node-installer.mjs";
import { buildNativeSourceProvenance } from "../scripts/native-build-provenance.mjs";
import { prepareNativePythonProductSource } from "../scripts/native-python-product-policy.mjs";

const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

describe("native node installer layout", () => {
  it("stages every compiled sibling, exact production dependencies and both runtimes", async () => {
    const fixture = await createFixture();
    const manifest = await stageNodeInstaller(fixture);
    expect(manifest).toMatchObject({ schema: "mycellios-node-installer-layout/2", target: `${process.platform}-${process.arch}`,
      source: { revision: "a".repeat(40), sourceId: expect.stringMatching(/^sha256:/) },
      entrypoints: { service: "app/node/main.js", install: "app/node/install-main.js", uninstall: "app/node/uninstall-main.js", launcher: process.platform === "win32" ? "install.ps1" : "install" } });
    const paths = manifest.files.map((file) => file.path);
    expect(paths).toEqual(expect.arrayContaining(["app/node/main.js", "app/contracts/node-control.js", process.platform === "win32" ? "bin/node.exe" : "bin/node",
      "node_modules/ws/package.json", "node_modules/zod/package.json", "runtime/runtime-manifest.json",
      // main.js reads <root>/package.json; node.json's pythonPath is <root>/python.
      "package.json", "python/distributed_runtime/model_adapter_registry.json", "python/mycellios-native-python-manifest.json"]));
    expect(paths).toContain(process.platform === "win32" ? "install.ps1" : "install");
    expect(paths.some((path) => path.includes("vitest"))).toBe(false);
    expect(JSON.parse(await readFile(join(fixture.output, "layout-manifest.json"), "utf8")).files).toEqual(manifest.files);
    await expect(verifyNodeInstaller(fixture.output, fixture)).resolves.toMatchObject({ target: `${process.platform}-${process.arch}` });
  });

  it("detects any byte changed after staging", async () => {
    const fixture = await createFixture();
    await stageNodeInstaller(fixture);
    await writeFile(join(fixture.output, "app", "node", "main.js"), "tampered\n");
    await expect(verifyNodeInstaller(fixture.output)).rejects.toThrow("node_installer_layout_digest_mismatch");
  });

  it("rejects a runtime built for another target and symlinks in sealed inputs", async () => {
    const mismatch = await createFixture();
    await writeFile(join(mismatch.runtime, "runtime-manifest.json"), JSON.stringify({ platform: "foreign", arch: process.arch }));
    await expect(stageNodeInstaller(mismatch)).rejects.toThrow("node_installer_runtime_target_mismatch");
    const linked = await createFixture();
    await symlink(join(linked.dist, "contracts", "node-control.js"), join(linked.dist, "node", "linked.js"));
    await expect(stageNodeInstaller(linked)).rejects.toThrow("node_installer_symlink_is_forbidden");
  });

  it("materializes portable-runtime aliases but rejects links escaping the runtime", async () => {
    const internal = await createFixture();
    await symlink("python", join(internal.runtime, "python-alias"));
    const manifest = await stageNodeInstaller(internal);
    expect(manifest.files.map((file) => file.path)).toContain("runtime/python-alias");

    const escaping = await createFixture();
    await symlink(join(escaping.dist, "node", "main.js"), join(escaping.runtime, "escape"));
    await expect(stageNodeInstaller(escaping)).rejects.toThrow("node_installer_runtime_symlink_escapes_root");
    await expect(access(escaping.output)).rejects.toThrow();
  });

  it("puts the service host and job broker in a Windows layout and refuses one without them", async () => {
    const fixture = await createFixture("win32-x64");
    const manifest = await stageNodeInstaller(fixture);
    expect(manifest.files.map((file) => file.path)).toEqual(expect.arrayContaining(["bin/node.exe", "bin/MycelliosNode.exe", "bin/mycellios-job-broker.exe"]));
    await expect(verifyNodeInstaller(fixture.output, fixture)).resolves.toMatchObject({ target: "win32-x64" });
    // Without the test override the stand-in is not the pinned WinSW 2.12.0 build.
    await expect(verifyNodeInstaller(fixture.output)).rejects.toThrow("node_installer_windows_service_wrapper_digest_mismatch");

    const { windowsServiceWrapper: _wrapper, ...noWrapper } = await createFixture("win32-x64");
    await expect(stageNodeInstaller(noWrapper)).rejects.toThrow("node_installer_windows_service_wrapper_is_missing");
    const { windowsJobBroker: _broker, ...noBroker } = await createFixture("win32-x64");
    await expect(stageNodeInstaller(noBroker)).rejects.toThrow("node_installer_windows_job_broker_is_missing");
    const { trustedServiceWrapperSha256: _trusted, ...untrusted } = await createFixture("win32-x64");
    await expect(stageNodeInstaller(untrusted)).rejects.toThrow("node_installer_windows_service_wrapper_digest_mismatch");
  });
});

async function createFixture(target = `${process.platform}-${process.arch}`) {
  const root = await mkdtemp(join(tmpdir(), "mycellios-installer-layout-")); cleanup.push(root);
  const dist = join(root, "dist"), runtime = join(root, "runtime"), nodeModules = join(root, "node_modules"), output = join(root, "output");
  await Promise.all([mkdir(join(dist, "node"), { recursive: true }), mkdir(join(dist, "contracts"), { recursive: true }), mkdir(runtime),
    mkdir(join(nodeModules, "ws"), { recursive: true }), mkdir(join(nodeModules, "zod"), { recursive: true }), mkdir(join(root, "host"))]);
  await Promise.all(["main.js", "install-main.js", "uninstall-main.js"].map((name) => writeFile(join(dist, "node", name), "export {};\n")));
  await writeFile(join(dist, "contracts", "node-control.js"), "export {};\n");
  const [platform, arch] = target.split("-");
  await writeFile(join(runtime, "runtime-manifest.json"), JSON.stringify({ platform, arch }));
  await writeFile(join(runtime, "python"), "runtime");
  await writeFile(join(nodeModules, "ws", "package.json"), "{}"); await writeFile(join(nodeModules, "zod", "package.json"), "{}");
  const nodeExecutable = join(root, "host", "node"); await writeFile(nodeExecutable, "node");
  const pythonSource = join(root, "python"); prepareNativePythonProductSource(resolve("python"), pythonSource);
  // Stand-ins for WinSW and the broker; the real WinSW digest is pinned in the stager.
  const windowsServiceWrapper = join(root, "host", "WinSW-x64.exe"); await writeFile(windowsServiceWrapper, "MZ fixture service wrapper");
  const windowsJobBroker = join(root, "host", "mycellios-job-broker.exe"); await writeFile(windowsJobBroker, "MZ fixture job broker");
  const windows = platform === "win32"
    ? { windowsServiceWrapper, windowsJobBroker, trustedServiceWrapperSha256: createHash("sha256").update("MZ fixture service wrapper").digest("hex") }
    : {};
  return { output, dist, runtime, nodeExecutable, nodeModules, pythonSource, target, sourceRevision: "a".repeat(40), sourceProvenance: buildNativeSourceProvenance(resolve(".")), ...windows };
}
