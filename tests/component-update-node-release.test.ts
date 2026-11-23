import { execFileSync } from "node:child_process";
import { generateKeyPairSync, type KeyObject } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

import { verifyComponentUpdateManifest, type ComponentUpdateManifest } from "../src/contracts/component-update-manifest.js";
import type { NodeConfiguration } from "../src/contracts/node-configuration.js";
import { createCoordinator, type CoordinatorRuntime } from "../src/coordinator/server.js";
import { NODE_MANAGED_COMPONENT_IDS, NodeComponentLifecycle } from "../src/node/component-lifecycle.js";
import { readComponentInstallState } from "../src/update/component-update-manager.js";
import {
  releaseChildEnvironment,
  resolveStableReleaseSigning,
} from "../src/update/component-release-signing.js";
import {
  COMPONENT_UPDATE_PUBLIC_KEY_SCHEMA,
  NODE_RUNTIME_RELEASE_COMPONENTS,
  PREPARED_COMPONENT_RELEASE_SCHEMA,
  PREPARED_MULTI_COMPONENT_RELEASE_SCHEMA,
  prepareComponentRelease,
  publishComponentRelease,
  type ComponentSigningIdentity,
  type ComponentUpdateTarget,
} from "../src/update/component-update-publisher.js";
import { buildNativeSourceProvenance } from "../scripts/native-build-provenance.mjs";
import { prepareNativePythonProductSource } from "../scripts/native-python-product-policy.mjs";
import { stageNodeApp } from "../scripts/stage-node-installer.mjs";

const cleanup: string[] = [];
const servers: Server[] = [];
const coordinators: CoordinatorRuntime[] = [];
afterEach(async () => {
  await Promise.all(coordinators.splice(0).map((runtime) => runtime.close()));
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((done) => server.close(() => done()))));
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

const repositoryProvenance = buildNativeSourceProvenance(resolve("."));
const DEV_TARGET = { channel: "dev", platform: "win32", arch: "x64" } as const satisfies ComponentUpdateTarget;

describe("node runtime component release", () => {
  it("signs python-product and node-app from the same revision into one manifest and publishes both", async () => {
    const fixture = await releaseWorkspace();
    const identity = signingIdentity("dev");
    const server = await feedServer();
    const feedUrl = `http://127.0.0.1:${server.port}`;
    const prepared = await prepareComponentRelease({
      ...fixture.prepareOptions,
      feedUrl,
      target: DEV_TARGET,
      identity: identity.identity,
      components: NODE_RUNTIME_RELEASE_COMPONENTS,
      nodeAppRoot: fixture.nodeAppRoot,
      expectedNodeAppSourceId: repositoryProvenance.sourceId,
      revision: fixture.revision,
    });

    const manifest = JSON.parse(await readFile(join(prepared.releaseDirectory, "manifest.json"), "utf8")) as ComponentUpdateManifest;
    verifyComponentUpdateManifest(manifest, { pinnedKey: identity.pinned, expectedChannel: "dev" });
    expect(manifest.revision).toBe(fixture.revision);
    expect(manifest.provenance).toMatchObject({ baseRevision: fixture.revision, sourceTreeDirty: false });
    expect(manifest.components.map((component) => [component.id, component.restartScope, component.platform, component.arch]).sort())
      .toEqual([["node-app", "agent", "win32", "x64"], ["python-product", "runtime", "win32", "x64"]]);
    expect(new Set(manifest.components.map((component) => component.version)).size).toBe(1);
    expect(manifest.components[0]!.version).toMatch(new RegExp(`\\.${fixture.revision.slice(0, 10)}$`));
    expect(prepared.components.map((component) => component.componentId)).toEqual(["python-product", "node-app"]);

    const release = JSON.parse(await readFile(join(prepared.releaseDirectory, "release.json"), "utf8"));
    expect(release).toMatchObject({
      schema: PREPARED_MULTI_COMPONENT_RELEASE_SCHEMA,
      artifacts: [{ componentId: "python-product", file: "python-product.blob" }, { componentId: "node-app", file: "node-app.blob" }],
      provenance: { baseRevision: fixture.revision, nodeApp: { sourceId: repositoryProvenance.sourceId } },
    });

    const published = await publishComponentRelease({ releaseDirectory: prepared.releaseDirectory, coordinatorUrl: feedUrl, target: DEV_TARGET });
    expect(published).toMatchObject({ commitPhase: "readback-verified", reconciliation: { artifactReadbackVerified: true } });
    expect(published.reconciliation.artifacts?.map((artifact) => [artifact.componentId, artifact.status, artifact.readbackVerified]))
      .toEqual([["python-product", 201], ["node-app", 201]].map(([id, status]) => [id, status, true]));
    expect([...server.artifacts.keys()].sort()).toEqual(manifest.components.map((component) => component.artifact.sha256.slice(7)).sort());
  });

  it("refuses a node-app built from another revision", async () => {
    const fixture = await releaseWorkspace({ nodeAppRevision: "f".repeat(40) });
    await expect(prepareComponentRelease({
      ...fixture.prepareOptions, target: DEV_TARGET, identity: signingIdentity("dev").identity,
      components: NODE_RUNTIME_RELEASE_COMPONENTS, nodeAppRoot: fixture.nodeAppRoot,
    })).rejects.toThrow("different source revision");
  });

  it("refuses a node-app whose provenance is not the release source tree", async () => {
    const fixture = await releaseWorkspace();
    await expect(prepareComponentRelease({
      ...fixture.prepareOptions, target: DEV_TARGET, identity: signingIdentity("dev").identity,
      components: NODE_RUNTIME_RELEASE_COMPONENTS, nodeAppRoot: fixture.nodeAppRoot,
      expectedNodeAppSourceId: `sha256:${"0".repeat(64)}`,
    })).rejects.toThrow("provenance does not match");
  });

  it("rejects a tampered node-app artifact before contacting the coordinator", async () => {
    const fixture = await releaseWorkspace();
    const prepared = await prepareComponentRelease({
      ...fixture.prepareOptions, target: DEV_TARGET, identity: signingIdentity("dev").identity,
      components: NODE_RUNTIME_RELEASE_COMPONENTS, nodeAppRoot: fixture.nodeAppRoot,
    });
    const blob = join(prepared.releaseDirectory, "node-app.blob");
    const bytes = await readFile(blob);
    const middle = Math.floor(bytes.length / 2);
    bytes[middle] = bytes[middle]! ^ 0xff;
    await writeFile(blob, bytes);
    const server = await feedServer();
    await expect(publishComponentRelease({
      releaseDirectory: prepared.releaseDirectory, coordinatorUrl: `http://127.0.0.1:${server.port}`, target: DEV_TARGET,
    })).rejects.toThrow("Prepared node-app artifact failed digest verification.");
    expect(server.requests).toBe(0);
  });

  it("only accepts python-product alone or with node-app, on node-app targets", async () => {
    const fixture = await releaseWorkspace();
    const base = { ...fixture.prepareOptions, identity: signingIdentity("dev").identity, nodeAppRoot: fixture.nodeAppRoot };
    await expect(prepareComponentRelease({ ...base, target: DEV_TARGET, components: ["node-app"] })).rejects.toThrow("python-product");
    await expect(prepareComponentRelease({ ...base, target: { ...DEV_TARGET, arch: "arm64" }, components: NODE_RUNTIME_RELEASE_COMPONENTS }))
      .rejects.toThrow("node-app is not published for win32/arm64");
  });

  it("keeps the single python-product release unchanged", async () => {
    const fixture = await releaseWorkspace();
    const identity = signingIdentity("dev");
    const server = await feedServer();
    const feedUrl = `http://127.0.0.1:${server.port}`;
    const prepared = await prepareComponentRelease({ ...fixture.prepareOptions, feedUrl, target: DEV_TARGET, identity: identity.identity });
    const release = JSON.parse(await readFile(join(prepared.releaseDirectory, "release.json"), "utf8"));
    expect(Object.keys(release).sort()).toEqual(["artifactFile", "enrollmentFile", "manifestFile", "manifestId", "provenance", "schema", "sequence", "target"]);
    expect(release).toMatchObject({ schema: PREPARED_COMPONENT_RELEASE_SCHEMA, artifactFile: "artifact.blob" });
    const manifest = JSON.parse(await readFile(join(prepared.releaseDirectory, "manifest.json"), "utf8")) as ComponentUpdateManifest;
    expect(manifest.components.map((component) => [component.id, component.restartScope])).toEqual([["python-product", "runtime"]]);
    expect(manifest.provenance.sourceTreeDigest).toBe(manifest.components[0]!.artifact.filesManifestSha256);
    const published = await publishComponentRelease({ releaseDirectory: prepared.releaseDirectory, coordinatorUrl: feedUrl, target: DEV_TARGET });
    expect(published.reconciliation).not.toHaveProperty("artifacts");
    expect(published).toMatchObject({ artifactStatus: 201, commitPhase: "readback-verified" });
  });
});

describe("stable node runtime release through a coordinator", () => {
  const target = { channel: "stable", platform: process.platform, arch: process.arch } as ComponentUpdateTarget;
  const supported = ["win32/x64", "linux/x64", "darwin/arm64"].includes(`${process.platform}/${process.arch}`);

  it.skipIf(!supported)("publishes one stable manifest that a supervised node verifies and activates as a unit", async () => {
    const fixture = await releaseWorkspace();
    const stable = signingIdentity("stable");
    const adminToken = "node-release-admin-token";
    const runtime = await createCoordinator({
      host: "127.0.0.1", port: 0, databasePath: join(fixture.root, "coordinator.db"), requestTimeoutMs: 120_000,
      componentUpdatesPath: join(fixture.root, "component-updates"), modelAdminToken: adminToken,
      componentUpdatePinnedKeys: { stable: [stable.pinned] },
    });
    coordinators.push(runtime);
    await runtime.app.listen({ host: "127.0.0.1", port: 0 });
    const coordinator = `http://127.0.0.1:${(runtime.app.server.address() as AddressInfo).port}`;
    const signing = resolveStableReleaseSigning({
      MYCELLIOS_COMPONENT_STABLE_SIGNING_KEY: stable.pem,
      MYCELLIOS_NODE_COMPONENT_TRUST: JSON.stringify({ feedUrl: "https://updates.example.test/", pinnedKeys: { dev: [], stable: [stable.pinned] } }),
    });
    const prepared = await prepareComponentRelease({
      ...fixture.prepareOptions, feedUrl: coordinator, target, identity: signing.identity, pinnedStableKeys: signing.pinnedStableKeys,
      components: NODE_RUNTIME_RELEASE_COMPONENTS, nodeAppRoot: fixture.nodeAppRoot, revision: fixture.revision,
    });
    await expect(publishComponentRelease({
      releaseDirectory: prepared.releaseDirectory, coordinatorUrl: coordinator, target, pinnedStableKeys: signing.pinnedStableKeys, adminToken,
    })).resolves.toMatchObject({ commitPhase: "readback-verified", manifestStatus: 201 });

    const cachePath = join(fixture.root, "node-cache");
    const config: NodeConfiguration = {
      schema: "mycellios-node-configuration/1", revision: 1, nodeId: "node-1",
      coordinator: { url: coordinator, identityPath: join(fixture.root, "identity") },
      worker: { configPath: join(fixture.root, "worker.json") },
      runtime: { pythonExecutable: process.execPath, pythonPath: join(fixture.root, "python"), cachePath, stagePort: 9_850 },
      limits: { maxConcurrency: 1, maxCpuPercent: 90, maxRamMiB: 8_192, maxVramMiB: 0, maxDiskMiB: 32_768, maxTemperatureC: 85 },
      isolation: { mode: "linux-cgroup-v2" },
      updateChannel: "stable",
      componentUpdates: { feedUrl: coordinator, pinnedKeys: { dev: [], stable: [stable.pinned] } },
    };
    const pythonCanary = vi.fn(async () => undefined);
    const nodeAppCanary = vi.fn(async () => undefined);
    const lifecycle = new NodeComponentLifecycle(config, "0.2.80", async () => true, async () => async () => undefined,
      fetch, pythonCanary, nodeAppCanary, NODE_MANAGED_COMPONENT_IDS);
    const applied = await lifecycle.update("stable", prepared.manifestId as `sha256:${string}`);
    expect(applied).toMatchObject({ state: "applied" });
    expect([...(applied as { changedComponents: string[] }).changedComponents].sort()).toEqual(["node-app", "python-product"]);
    // The node-app canary is bound to the signed revision both components came from.
    expect(nodeAppCanary).toHaveBeenCalledWith(expect.any(String), fixture.revision);
    expect(pythonCanary).toHaveBeenCalledTimes(1);
    const state = await readComponentInstallState(join(cachePath, "component-updates"));
    expect(state.active["node-app"]?.manifestId).toBe(prepared.manifestId);
    expect(state.active["python-product"]?.manifestId).toBe(prepared.manifestId);
  });
});

describe("stable node component signing", () => {
  it("fails closed when the stable key or its pinned trust anchor is missing", () => {
    const stable = signingIdentity("stable");
    const trust = trustAnchor([stable.pinned]);
    expect(() => resolveStableReleaseSigning({ MYCELLIOS_NODE_COMPONENT_TRUST: trust })).toThrow("component_release_stable_signing_key_missing");
    expect(() => resolveStableReleaseSigning({ MYCELLIOS_NODE_COMPONENT_TRUST: trust, MYCELLIOS_COMPONENT_STABLE_SIGNING_KEY: "  " }))
      .toThrow("component_release_stable_signing_key_missing");
    expect(() => resolveStableReleaseSigning({ MYCELLIOS_COMPONENT_STABLE_SIGNING_KEY: stable.pem })).toThrow("component_release_stable_trust_missing");
    expect(() => resolveStableReleaseSigning({ MYCELLIOS_COMPONENT_STABLE_SIGNING_KEY: stable.pem, MYCELLIOS_NODE_COMPONENT_TRUST: trustAnchor([]) }))
      .toThrow("component_release_stable_trust_missing");
    const other = signingIdentity("stable");
    expect(() => resolveStableReleaseSigning({ MYCELLIOS_COMPONENT_STABLE_SIGNING_KEY: other.pem, MYCELLIOS_NODE_COMPONENT_TRUST: trust }))
      .toThrow("component_release_stable_signing_key_not_pinned");
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2_048 }).privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    expect(() => resolveStableReleaseSigning({ MYCELLIOS_COMPONENT_STABLE_SIGNING_KEY: rsa, MYCELLIOS_NODE_COMPONENT_TRUST: trust }))
      .toThrow("component_release_stable_signing_key_invalid");
    try {
      resolveStableReleaseSigning({ MYCELLIOS_COMPONENT_STABLE_SIGNING_KEY: "-----BEGIN PRIVATE KEY-----\nnot-a-key\n", MYCELLIOS_NODE_COMPONENT_TRUST: trust });
    } catch (error) {
      expect((error as Error).message).toBe("component_release_stable_signing_key_invalid");
      expect((error as Error).cause).toBeUndefined();
    }
  });

  it("signs a stable release only with a key the installer trust anchor pins", async () => {
    const fixture = await releaseWorkspace();
    const stable = signingIdentity("stable");
    const signing = resolveStableReleaseSigning({
      MYCELLIOS_COMPONENT_STABLE_SIGNING_KEY: stable.pem,
      MYCELLIOS_NODE_COMPONENT_TRUST: trustAnchor([stable.pinned]),
    });
    expect(signing.identity.enrollment).toEqual(stable.identity.enrollment);
    const target = { ...DEV_TARGET, channel: "stable" } as const;
    const options = { ...fixture.prepareOptions, target, components: NODE_RUNTIME_RELEASE_COMPONENTS, nodeAppRoot: fixture.nodeAppRoot };
    // The built-in desktop stable list is empty: without the node pins, stable stays disabled.
    await expect(prepareComponentRelease({ ...options, identity: signing.identity })).rejects.toThrow("Stable component publication is disabled");
    const prepared = await prepareComponentRelease({ ...options, identity: signing.identity, pinnedStableKeys: signing.pinnedStableKeys });
    const manifest = JSON.parse(await readFile(join(prepared.releaseDirectory, "manifest.json"), "utf8")) as ComponentUpdateManifest;
    expect(verifyComponentUpdateManifest(manifest, { pinnedKey: stable.pinned, expectedChannel: "stable" }).revision).toBe(fixture.revision);
    await expect(publishComponentRelease({ releaseDirectory: prepared.releaseDirectory, coordinatorUrl: "http://127.0.0.1:9", target }))
      .rejects.toThrow("Stable component publication is disabled");
  });

  it("keeps release secrets out of child process environments", () => {
    const child = releaseChildEnvironment({ PATH: "/bin", MYCELLIOS_COMPONENT_STABLE_SIGNING_KEY: "x", MYCELLIOS_MODEL_ADMIN_TOKEN: "y" });
    expect(child).toEqual({ PATH: "/bin" });
  });
});

function signingIdentity(channel: "dev" | "stable"): {
  identity: ComponentSigningIdentity;
  pinned: { keyId: string; spki: string };
  pem: string;
  privateKey: KeyObject;
} {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const pinned = { keyId: `mycellios-${channel}-release-test`, spki: publicKey.export({ format: "der", type: "spki" }).toString("base64url") };
  return {
    identity: { privateKey, enrollment: { schema: COMPONENT_UPDATE_PUBLIC_KEY_SCHEMA, channel, ...pinned } },
    pinned,
    pem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    privateKey,
  };
}

function trustAnchor(stable: Array<{ keyId: string; spki: string }>): string {
  return JSON.stringify({ feedUrl: "https://updates.example.test/", pinnedKeys: { dev: [], stable } });
}

/** A committed workspace with a python product script and a staged node-app. */
async function releaseWorkspace(options: { nodeAppRevision?: string } = {}) {
  const root = await mkdtemp(join(tmpdir(), "mycellios-node-release-"));
  cleanup.push(root);
  const workspace = join(root, "workspace");
  await mkdir(join(workspace, "scripts"), { recursive: true });
  await writeFile(join(workspace, "package.json"), `${JSON.stringify({ version: repositoryProvenance.version })}\n`);
  await writeFile(join(workspace, ".gitignore"), "build/\n");
  // Stands in for scripts/prepare-packaged-python-source.mjs with the real product.
  const pythonProduct = join(root, "python-product");
  prepareNativePythonProductSource(resolve("python"), pythonProduct);
  await writeFile(join(workspace, "scripts", "prepare-packaged-python-source.mjs"), [
    "import { cpSync, rmSync } from \"node:fs\";",
    "import { resolve } from \"node:path\";",
    "const target = resolve(import.meta.dirname, \"..\", \"build\", \"python\");",
    "rmSync(target, { recursive: true, force: true });",
    "cpSync(process.env.MYCELLIOS_TEST_PYTHON_PRODUCT, target, { recursive: true });",
    "",
  ].join("\n"));
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=Release Test", "-c", "user.email=release@example.test",
    "-c", "commit.gpgsign=false", "-c", "core.autocrlf=false", ...args], { cwd: workspace, encoding: "utf8" }).trim();
  git("init", "--quiet");
  git("add", "--all");
  git("commit", "--quiet", "-m", "fixture");
  const revision = git("rev-parse", "HEAD");

  const dist = join(root, "dist");
  const nodeModules = join(root, "node_modules");
  await mkdir(join(dist, "node"), { recursive: true });
  await Promise.all(["main.js", "component-canary.js"].map((name) => writeFile(join(dist, "node", name), "export {};\n")));
  for (const dependency of ["ws", "zod"]) {
    await mkdir(join(nodeModules, dependency), { recursive: true });
    await writeFile(join(nodeModules, dependency, "package.json"), "{}\n");
  }
  const nodeAppRoot = join(workspace, "build", "node-app");
  const staged = await stageNodeApp({
    output: nodeAppRoot, dist, nodeModules, pythonSource: pythonProduct, sourceRevision: options.nodeAppRevision ?? revision, sourceProvenance: repositoryProvenance,
  });
  expect(staged.files.map((file) => file.path)).toEqual(expect.arrayContaining([
    "package.json", "app/node/main.js", "app/manifest.json", "app/mycellios-native-build-provenance.json", "node_modules/zod/package.json",
    "python/distributed_runtime/model_adapter_registry.json",
  ]));
  // Only the registry its JavaScript reads: the Python product ships as python-product.
  expect(staged.files.filter((file) => file.path.startsWith("python/")).map((file) => file.path))
    .toEqual(["python/distributed_runtime/model_adapter_registry.json"]);
  expect(staged.files.some((file) => file.path.startsWith("bin/") || file.path.startsWith("runtime/") || file.path.endsWith("component-update-trust.json")))
    .toBe(false);
  return {
    root,
    revision,
    nodeAppRoot,
    prepareOptions: {
      workspace,
      localRoot: join(root, "local"),
      feedUrl: "https://updates.example.test",
      sequence: 7,
      processEnvironment: { ...process.env, MYCELLIOS_TEST_PYTHON_PRODUCT: pythonProduct },
    },
  };
}

/** A loopback coordinator feed that stores artifacts and the last manifest. */
async function feedServer(): Promise<{ port: number; artifacts: Map<string, Buffer>; readonly requests: number }> {
  const artifacts = new Map<string, Buffer>();
  let manifest: string | null = null;
  let requests = 0;
  const server = createServer(async (request, response) => {
    requests += 1;
    const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    const artifact = /^\/public\/v1\/admin\/component-updates\/artifacts\/([0-9a-f]{64})$/.exec(path);
    if (request.method === "PUT" && artifact) {
      artifacts.set(artifact[1]!, await body(request));
      response.writeHead(201).end();
    } else if (request.method === "PUT" && /\/manifest$/.test(path)) {
      manifest = (await body(request)).toString("utf8");
      response.writeHead(201).end();
    } else if (request.method === "GET" && path.endsWith("/manifest.json") && manifest) {
      response.writeHead(200, { "content-type": "application/json" }).end(manifest);
    } else if (request.method === "GET" && path.startsWith("/updates/v1/artifacts/")) {
      const stored = artifacts.get(path.slice("/updates/v1/artifacts/".length));
      if (!stored) response.writeHead(404).end();
      else response.writeHead(200, { "content-length": stored.length }).end(stored);
    } else {
      response.writeHead(404).end();
    }
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("feed server did not bind");
  return { port: address.port, artifacts, get requests() { return requests; } };
}

async function body(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}
