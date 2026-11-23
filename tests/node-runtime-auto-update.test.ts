import { generateKeyPairSync, type KeyObject } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildComponentUpdateManifest, signComponentUpdateManifest } from "../src/contracts/component-update-manifest.js";
import type { NodeConfiguration } from "../src/contracts/node-configuration.js";
import { buildComponentFilesPackage } from "../src/update/component-files.js";
import { NODE_MANAGED_COMPONENT_IDS, NodeComponentLifecycle } from "../src/node/component-lifecycle.js";
import { planNodeAppLaunch, rollbackUnhealthyNodeApp } from "../src/node/node-app-launch.js";
import { effectiveComponentUpdates, readBundledComponentTrust } from "../src/node/update-trust.js";
import { serializeComponentTrust } from "../scripts/stage-node-installer.mjs";

const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true }))));
const REVISION = "2".padStart(40, "0");

describe("verified node runtime updates", () => {
  it("verifies, canaries and launches a signed node-app, then restores the bundled app after failed boot health", async () => {
    const fixture = await setup();
    const nodeAppCanary = vi.fn(async () => undefined);
    const lifecycle = fixture.lifecycle({ nodeAppCanary });
    await expect(lifecycle.update("stable", fixture.manifest.manifestId as `sha256:${string}`))
      .resolves.toMatchObject({ state: "applied", changedComponents: ["node-app"] });
    expect(nodeAppCanary).toHaveBeenCalledWith(expect.stringContaining("node-app"), REVISION);

    const launch = await planNodeAppLaunch({ supervisorDirectory: fixture.supervisorDirectory, configPath: fixture.configPath });
    expect(launch).toMatchObject({ source: "component", pendingActivation: true });
    expect(launch.entrypoint).toMatch(/app[\\/]node[\\/]main\.js$/);

    // The candidate exited before it marked itself healthy: the supervisor restores the bundled app.
    await expect(rollbackUnhealthyNodeApp(fixture.configPath, fixture.bootstrapRoot)).resolves.toBe(true);
    await expect(planNodeAppLaunch({ supervisorDirectory: fixture.supervisorDirectory, configPath: fixture.configPath }))
      .resolves.toMatchObject({ source: "bundled", pendingActivation: false });
    await expect(rollbackUnhealthyNodeApp(fixture.configPath, fixture.bootstrapRoot)).resolves.toBe(false);
  });

  it("keeps a healthy activation and never judges it again", async () => {
    const fixture = await setup();
    const lifecycle = fixture.lifecycle();
    await lifecycle.update("stable", fixture.manifest.manifestId as `sha256:${string}`);
    await lifecycle.markActivationHealthy();
    await expect(planNodeAppLaunch({ supervisorDirectory: fixture.supervisorDirectory, configPath: fixture.configPath }))
      .resolves.toMatchObject({ source: "component", pendingActivation: false });
    await expect(rollbackUnhealthyNodeApp(fixture.configPath, fixture.bootstrapRoot)).resolves.toBe(false);
  });

  it("rejects an artifact whose bytes do not match the signed SHA-256 and keeps the bundled app", async () => {
    const fixture = await setup();
    const tampered = (async (input: string | URL | Request) => String(input).endsWith("/manifest.json")
      ? Response.json(fixture.manifest)
      : new Response(flipMiddleByte(fixture.packageBytes), {
        headers: { "content-length": String(fixture.packageBytes.length) },
      })) as typeof fetch;
    const nodeAppCanary = vi.fn(async () => undefined);
    await expect(fixture.lifecycle({ fetch: tampered, nodeAppCanary }).update("stable", fixture.manifest.manifestId as `sha256:${string}`))
      .rejects.toThrow(/sha256|digest|mismatch/i);
    expect(nodeAppCanary).not.toHaveBeenCalled();
    await expect(planNodeAppLaunch({ supervisorDirectory: fixture.supervisorDirectory, configPath: fixture.configPath }))
      .resolves.toMatchObject({ source: "bundled" });
  });

  it("rejects a manifest signed by a key the bootstrap does not pin", async () => {
    const fixture = await setup();
    const { privateKey } = generateKeyPairSync("ed25519");
    const forged = fixture.sign(privateKey, fixture.pinnedKey.keyId);
    const forgedFetch = (async (input: string | URL | Request) => String(input).endsWith("/manifest.json")
      ? Response.json(forged)
      : new Response(new Uint8Array(fixture.packageBytes))) as typeof fetch;
    await expect(fixture.lifecycle({ fetch: forgedFetch }).update("stable")).rejects.toThrow();
    await expect(planNodeAppLaunch({ supervisorDirectory: fixture.supervisorDirectory, configPath: fixture.configPath }))
      .resolves.toMatchObject({ source: "bundled" });
  });

  it("refuses a node-app on a runtime without the supervising bootstrap", async () => {
    const fixture = await setup();
    await expect(fixture.lifecycle({ managed: ["python-product"] }).update("stable"))
      .rejects.toThrow("component_update_component_not_managed:node-app");
  });

  it("does not trust a node-app when the canary fails", async () => {
    const fixture = await setup();
    const nodeAppCanary = vi.fn(async () => { throw new Error("node_app_canary_failed"); });
    await expect(fixture.lifecycle({ nodeAppCanary }).update("stable")).rejects.toThrow("component_update_pre_activation_canary_failed");
    await expect(planNodeAppLaunch({ supervisorDirectory: fixture.supervisorDirectory, configPath: fixture.configPath }))
      .resolves.toMatchObject({ source: "bundled" });
  });
});

describe("bundled component trust", () => {
  it("reads the installer trust anchor and lets node.json override it", async () => {
    const fixture = await setup({ trustInConfig: false });
    expect(await readBundledComponentTrust(fixture.bootstrapRoot)).toMatchObject({ feedUrl: "https://updates.example.test" });
    expect(await effectiveComponentUpdates(fixture.config, fixture.bootstrapRoot)).toMatchObject({ pinnedKeys: { stable: [fixture.pinnedKey] } });
    const override = { feedUrl: "https://other.example.test", pinnedKeys: { dev: [], stable: [fixture.pinnedKey] } };
    expect(await effectiveComponentUpdates({ ...fixture.config, componentUpdates: override }, fixture.bootstrapRoot)).toEqual(override);
  });

  it("fails closed on a malformed trust file and accepts none without one", async () => {
    const fixture = await setup({ trustInConfig: false });
    await writeFile(join(fixture.bootstrapRoot, "app", "component-update-trust.json"), "{\"schema\":\"mycellios-node-component-trust/1\"}");
    await expect(readBundledComponentTrust(fixture.bootstrapRoot)).rejects.toThrow("node_component_trust_invalid");
    await expect(planNodeAppLaunch({ supervisorDirectory: fixture.supervisorDirectory, configPath: fixture.configPath }))
      .resolves.toMatchObject({ source: "bundled" });
    await rm(join(fixture.bootstrapRoot, "app", "component-update-trust.json"));
    await expect(readBundledComponentTrust(fixture.bootstrapRoot)).resolves.toBeUndefined();
  });

  it("rejects installer trust anchors that are not HTTPS Ed25519 keys", () => {
    const { publicKey } = generateKeyPairSync("ed25519");
    const spki = publicKey.export({ format: "der", type: "spki" }).toString("base64url");
    expect(() => serializeComponentTrust({ feedUrl: "http://updates.example.test", pinnedKeys: { dev: [], stable: [{ keyId: "k", spki }] } })).toThrow();
    expect(() => serializeComponentTrust({ feedUrl: "https://updates.example.test", pinnedKeys: { dev: [], stable: [] } })).toThrow();
    const rsa = generateKeyPairSync("rsa", { modulusLength: 1024 }).publicKey.export({ format: "der", type: "spki" }).toString("base64url");
    expect(() => serializeComponentTrust({ feedUrl: "https://updates.example.test", pinnedKeys: { dev: [], stable: [{ keyId: "k", spki: rsa }] } })).toThrow();
  });
});

async function setup(options: { trustInConfig?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), "mycellios-node-app-"));
  cleanup.push(root);
  const source = join(root, "source");
  await mkdir(join(source, "app", "node"), { recursive: true });
  await writeFile(join(source, "app", "node", "main.js"), "export {};\n");
  await writeFile(join(source, "package.json"), "{\"version\":\"0.2.90\"}\n");
  const built = buildComponentFilesPackage(source);
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const pinnedKey = { keyId: "stable-test-key", spki: publicKey.export({ format: "der", type: "spki" }).toString("base64url") };
  const sign = (key: KeyObject, keyId: string) => signComponentUpdateManifest(buildComponentUpdateManifest({
    channel: "stable",
    sequence: 1,
    revision: REVISION,
    provenance: { baseRevision: REVISION, sourceTreeDirty: false, sourceTreeDigest: built.filesManifestSha256 },
    sourceId: `sha256:${"2".padStart(64, "0")}`,
    compatibility: { workerProtocol: { min: 1, max: 1 }, runtimeAbi: "mycellios-distribution-runtime/4", minBootstrapVersion: "0.2.70" },
    components: [{
      id: "node-app", version: "0.2.90", platform: process.platform as "linux" | "darwin" | "win32", arch: process.arch as "x64" | "arm64", restartScope: "agent",
      artifact: { url: "https://updates.example.test/node-app", sha256: built.artifactSha256, bytes: built.packageBytes.length, format: "json-gzip-v1", filesManifestSha256: built.filesManifestSha256 },
      requirements: { backend: "any", driver: null, runtimeAbi: "mycellios-distribution-runtime/4", workerProtocol: { min: 1, max: 1 }, dependencies: [] },
    }],
  }), { keyId, privateKey: key });
  const manifest = sign(privateKey, pinnedKey.keyId);
  const bootstrapRoot = join(root, "install");
  const supervisorDirectory = join(bootstrapRoot, "app", "node");
  await mkdir(supervisorDirectory, { recursive: true });
  await writeFile(join(bootstrapRoot, "package.json"), "{\"version\":\"0.2.80\"}\n");
  const componentUpdates = { feedUrl: "https://updates.example.test", pinnedKeys: { dev: [], stable: [pinnedKey] } };
  await writeFile(join(bootstrapRoot, "app", "component-update-trust.json"), serializeComponentTrust(componentUpdates));
  const config: NodeConfiguration = {
    schema: "mycellios-node-configuration/1",
    revision: 1,
    nodeId: "node-1",
    coordinator: { url: "https://coordinator.example.test", identityPath: join(root, "identity") },
    worker: { configPath: join(root, "worker.json") },
    runtime: { pythonExecutable: "/usr/bin/python3", pythonPath: join(root, "fallback-python"), cachePath: join(root, "cache"), stagePort: 9_850 },
    limits: { maxConcurrency: 1, maxCpuPercent: 90, maxRamMiB: 8_192, maxVramMiB: 0, maxDiskMiB: 32_768, maxTemperatureC: 85 },
    isolation: { mode: "linux-cgroup-v2" },
    updateChannel: "stable",
    ...(options.trustInConfig === false ? {} : { componentUpdates }),
  };
  const configPath = join(root, "node.json");
  await writeFile(configPath, JSON.stringify(config));
  const fetchFixture = (async (input: string | URL | Request) => String(input).endsWith("/manifest.json")
    ? Response.json(manifest)
    : new Response(new Uint8Array(built.packageBytes), { headers: { "content-length": String(built.packageBytes.length) } })) as typeof fetch;
  const lifecycle = (overrides: { fetch?: typeof fetch; nodeAppCanary?: (root: string, revision: string | null) => Promise<void>; managed?: readonly string[] } = {}) =>
    new NodeComponentLifecycle(
      { ...config, componentUpdates }, "0.2.80", async () => true, async () => async () => undefined,
      overrides.fetch ?? fetchFixture, async () => undefined, overrides.nodeAppCanary ?? (async () => undefined),
      overrides.managed ?? NODE_MANAGED_COMPONENT_IDS,
    );
  return { root, config, configPath, manifest, sign, pinnedKey, packageBytes: built.packageBytes, bootstrapRoot, supervisorDirectory, lifecycle };
}

function flipMiddleByte(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  const index = Math.floor(copy.length / 2);
  copy[index] = copy[index]! ^ 0xff;
  return copy;
}
