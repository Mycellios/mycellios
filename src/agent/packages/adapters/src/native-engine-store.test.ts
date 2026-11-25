import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NativeEngineLock, NativeEngineTarget } from "./native-engine-store.js";
import {
  compareVersions, installNativeEngine, managedNativeEngine, nativeCliVersion, nativeEngineInstalls, nativeEngineLock,
  NativeEngineLockSchema, nativeEngineRelease, NATIVE_ENGINE_TARGETS, parseCliVersion, resetNativeEngineStore,
} from "./native-engine-store.js";
import { resetNativeEngineVersions, resolveNativeEngine } from "./native-engine-resolve.js";
import { loginShellPath, resetLoginShellPath } from "./native-login-path.js";

type Entry = { path: string; content?: string; type?: string; mode?: number };

function header(path: string, size: number, type = "0", mode = 0o644) {
  const block = Buffer.alloc(512);
  block.write(path, 0, 100, "utf8");
  block.write(`${mode.toString(8).padStart(7, "0")}\0`, 100, "latin1");
  block.write("0000000\0", 108, "latin1");
  block.write("0000000\0", 116, "latin1");
  block.write(`${size.toString(8).padStart(11, "0")}\0`, 124, "latin1");
  block.write("00000000000\0", 136, "latin1");
  block.write("        ", 148, "latin1");
  block.write(type, 156, "latin1");
  block.write("ustar\u000000", 257, "latin1");
  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, "latin1");
  return block;
}

/** A gzipped ustar archive, like the tarballs npm publishes. */
function tarball(entries: Entry[]) {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const body = Buffer.from(entry.content ?? "");
    blocks.push(header(entry.path, body.length, entry.type, entry.mode), body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

/** A pax extended header naming the next entry, as npm writes for long paths. */
function paxPath(path: string): Entry {
  const record = (length: number) => `${length} path=${path}\n`;
  let length = record(0).length;
  while (Buffer.byteLength(record(length)) !== length) length = Buffer.byteLength(record(length));
  return { path: "PaxHeader/long", type: "x", content: record(length) };
}

const TARGET: NativeEngineTarget = "linux-x64";
const URL_PREFIX = "https://registry.npmjs.org/@openai/codex/-/";
const PACKAGE: Entry[] = [
  { path: "package/package.json", content: "{\"name\":\"@openai/codex\"}" },
  { path: "package/vendor/bin/codex", content: "native program", mode: 0o755 },
  { path: "package/vendor/resources/rg", content: "helper", mode: 0o755 },
];

/** A lock whose Codex entry pins `archive`, the way scripts/native-engine-lock.mjs records it. */
function lockFor(archive: Buffer, entries = PACKAGE, overrides: Record<string, unknown> = {}): NativeEngineLock {
  const files = entries.filter(entry => !entry.type || entry.type === "0");
  const release = {
    package: "@openai/codex",
    url: `${URL_PREFIX}codex-9.9.9-linux-x64.tgz`,
    integrity: `sha512-${createHash("sha512").update(archive).digest("base64")}`,
    bytes: archive.length,
    unpackedBytes: files.reduce((total, entry) => total + Buffer.byteLength(entry.content ?? ""), 0),
    files: files.length,
    executable: "package/vendor/bin/codex",
    ...overrides,
  };
  const none = { version: "1.0.0", source: "npm" as const, targets: {} };
  return { schemaVersion: 1, engines: { codex: { version: "9.9.9", source: "npm", targets: { [TARGET]: release } }, claude: none, opencode: none } };
}

const servers: Server[] = [];
const roots: string[] = [];
let requests = 0;

/** A local stand-in for the npm registry: tests never reach the network. */
async function registry(answer: (response: import("node:http").ServerResponse) => void) {
  const server = createServer((_request, response) => { requests++; answer(response); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return ((url: string | URL | Request, init?: RequestInit) =>
    fetch(String(url).replace("https://registry.npmjs.org", origin), init)) as typeof fetch;
}
const serve = (archive: Buffer) => registry(response => {
  response.writeHead(200, { "content-type": "application/octet-stream", "content-length": archive.length });
  response.end(archive);
});

async function store() {
  const root = await mkdtemp(join(tmpdir(), "mycellios-engine-store-"));
  roots.push(root);
  return root;
}

const version = vi.fn(async (_command: { command: string }) => "9.9.9" as string | undefined);

beforeEach(async () => {
  requests = 0;
  version.mockReset().mockResolvedValue("9.9.9");
  resetNativeEngineStore();
  resetNativeEngineVersions();
  // Tests search only the folders they name, never a login shell's.
  resetLoginShellPath();
  await loginShellPath({ platform: "linux", run: async () => "" });
});
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe("the native engine lock", () => {
  it("pins every engine for every Desktop target from its npm package with a sha512 integrity", () => {
    for (const [engine, locked] of Object.entries(nativeEngineLock.engines)) {
      expect(Object.keys(locked.targets).sort(), engine).toEqual([...NATIVE_ENGINE_TARGETS].sort());
      for (const [target, release] of Object.entries(locked.targets)) {
        expect(release.url.startsWith(`https://registry.npmjs.org/${release.package}/-/`), `${engine} ${target}`).toBe(true);
        expect(release.url.endsWith(".tgz") && release.url.includes(locked.version)).toBe(true);
        expect(release.bytes).toBeLessThanOrEqual(release.unpackedBytes);
        expect(release.executable.endsWith(".exe")).toBe(target.startsWith("win32"));
      }
    }
    // The first managed OpenCode stays on the version servers already installed.
    expect(nativeEngineLock.engines.opencode.version).toBe("1.19.5");
    expect(nativeEngineLock.engines.opencode.targets["win32-x64"]?.integrity).toBe(
      "sha512-yRHN+TsfLjfLmdQVAVWqTGfGP1yq8YtUFy9Jw33XhlPIp77slBdCJrj2PC4amuEl6BJtaIQDhDFbpJ8+a5z7Qw==");
  });

  it("rejects another channel, a weaker hash and an executable outside the package", () => {
    const release = nativeEngineLock.engines.codex.targets["linux-x64"]!;
    const withRelease = (change: Record<string, unknown>) => ({
      ...nativeEngineLock, engines: { ...nativeEngineLock.engines,
        codex: { ...nativeEngineLock.engines.codex, targets: { "linux-x64": { ...release, ...change } } } } });
    expect(NativeEngineLockSchema.safeParse(withRelease({})).success).toBe(true);
    expect(NativeEngineLockSchema.safeParse(withRelease({ url: "https://example.test/codex.tgz" })).success).toBe(false);
    expect(NativeEngineLockSchema.safeParse(withRelease({ integrity: "sha1-AAAA" })).success).toBe(false);
    expect(NativeEngineLockSchema.safeParse(withRelease({ executable: "package/../codex" })).success).toBe(false);
    expect(NativeEngineLockSchema.safeParse(withRelease({ executable: "/usr/bin/codex" })).success).toBe(false);
  });

  it("has no download for a target its vendor does not publish", () => {
    expect(nativeEngineRelease("codex", { target: "linux-x64" })?.target).toBe("linux-x64");
    expect(nativeEngineRelease("codex", { target: "freebsd-x64" as NativeEngineTarget })).toBeUndefined();
  });
});

describe("versions", () => {
  it("reads the version each CLI prints and orders releases above their prereleases", async () => {
    expect(parseCliVersion("codex-cli 0.172.0\n")).toBe("0.172.0");
    expect(parseCliVersion("2.1.326 (Claude Code)")).toBe("2.1.326");
    expect(parseCliVersion("v24.15.0")).toBe("24.15.0");
    expect(parseCliVersion("no version")).toBeUndefined();
    expect(compareVersions("2.1.326", "2.1.326")).toBe(0);
    expect(compareVersions("2.1.332", "2.1.326")).toBe(1);
    expect(compareVersions("0.172.0-alpha.5", "0.172.0")).toBe(-1);
    expect(compareVersions("0.174.0-alpha.10", "0.174.0-alpha.9")).toBe(1);
    expect(compareVersions("10.0.0", "9.9.9")).toBe(1);
    expect(await nativeCliVersion({ command: process.execPath })).toBe(process.versions.node);
  });
});

describe("installing", () => {
  it("installs a verified package, records the SHA-256 of every file and starts it only after that", async () => {
    const archive = tarball([{ path: "package/", type: "5" }, ...PACKAGE]);
    const root = await store();
    const options = { lock: lockFor(archive), target: TARGET, fetch: await serve(archive), version };
    const managed = await installNativeEngine(root, "codex", options);
    const directory = join(root, "codex", "9.9.9");
    expect(managed).toEqual({ command: { command: join(directory, "package", "vendor", "bin", "codex"), args: [] }, version: "9.9.9", ready: true });
    // The version check ran on the staged copy, before it reached its final path.
    expect(version).toHaveBeenCalledOnce();
    expect(version.mock.calls[0]![0].command).toContain(".install-");
    const record = JSON.parse(await readFile(join(directory, "mycellios-install.json"), "utf8"));
    expect(record).toMatchObject({ engine: "codex", version: "9.9.9", target: TARGET, executable: "package/vendor/bin/codex" });
    for (const entry of PACKAGE)
      expect(record.files[entry.path]).toEqual({ bytes: Buffer.byteLength(entry.content!), sha256: createHash("sha256").update(entry.content!).digest("hex") });
    expect(await readdir(join(root, "codex"))).toEqual(["9.9.9"]);
    expect(await readFile(join(directory, "package", "vendor", "resources", "rg"), "utf8")).toBe("helper");
    // Concurrent and later requests reuse the verified copy without downloading again.
    await expect(installNativeEngine(root, "codex", options)).resolves.toEqual(managed);
    expect(requests).toBe(1);
  });

  it("unpacks long paths that npm writes as pax headers", async () => {
    const long = `package/${"deep/".repeat(30)}file.txt`;
    const entries = [...PACKAGE, paxPath(long), { path: "package/truncated-name", content: "long" }];
    const archive = tarball(entries);
    const root = await store();
    const lock = lockFor(archive, [...PACKAGE, { path: long, content: "long" }]);
    await installNativeEngine(root, "codex", { lock, target: TARGET, fetch: await serve(archive), version });
    expect(await readFile(join(root, "codex", "9.9.9", ...long.split("/")), "utf8")).toBe("long");
  });

  it("rejects a download that does not match its published hash and keeps nothing", async () => {
    const archive = tarball(PACKAGE);
    const other = tarball([...PACKAGE, { path: "package/extra", content: "x" }]);
    const root = await store();
    const fetcher = await serve(other);
    const lock = lockFor(archive, PACKAGE, { bytes: other.length });
    await expect(installNativeEngine(root, "codex", { lock, target: TARGET, fetch: fetcher, version }))
      .rejects.toThrow("The Codex download did not match its published hash.");
    expect(await readdir(join(root, "codex"))).toEqual([]);
    expect(version).not.toHaveBeenCalled();
    expect(nativeEngineInstalls(root)).toEqual([{ engine: "codex", state: "failed", error: "The Codex download did not match its published hash." }]);
  });

  it("stops a download larger than published and refuses a different declared size", async () => {
    const archive = tarball(PACKAGE);
    const root = await store();
    const larger = await registry(response => {
      response.writeHead(200, { "content-type": "application/octet-stream" });
      response.end(Buffer.concat([archive, Buffer.alloc(64 * 1024)]));
    });
    await expect(installNativeEngine(root, "codex", { lock: lockFor(archive), target: TARGET, fetch: larger, version }))
      .rejects.toThrow("The Codex download is larger than published.");
    const declared = await registry(response => {
      response.writeHead(200, { "content-length": archive.length + 1 });
      response.end(Buffer.concat([archive, Buffer.alloc(1)]));
    });
    await expect(installNativeEngine(root, "codex", { lock: lockFor(archive), target: TARGET, fetch: declared, version }))
      .rejects.toThrow("The Codex download does not have its published size.");
    expect(await readdir(join(root, "codex"))).toEqual([]);
  });

  it("never keeps a partial download, a dropped connection or a redirect", async () => {
    const archive = tarball(PACKAGE);
    const root = await store();
    const options = (fetcher: typeof fetch) => ({ lock: lockFor(archive), target: TARGET, fetch: fetcher, version });
    const short = await registry(response => {
      response.writeHead(200);
      response.end(archive.subarray(0, archive.length - 10));
    });
    await expect(installNativeEngine(root, "codex", options(short))).rejects.toThrow("The Codex download was incomplete.");
    const dropped = await registry(response => {
      response.writeHead(200, { "content-length": archive.length });
      response.write(archive.subarray(0, 100), () => response.socket?.destroy());
    });
    await expect(installNativeEngine(root, "codex", options(dropped))).rejects.toThrow("Could not download Codex.");
    const redirect = await registry(response => {
      response.writeHead(302, { location: "https://registry.npmjs.org/elsewhere.tgz" });
      response.end();
    });
    await expect(installNativeEngine(root, "codex", options(redirect))).rejects.toThrow("Could not download Codex.");
    expect(await readdir(join(root, "codex"))).toEqual([]);
    expect(version).not.toHaveBeenCalled();
  });

  it.each([
    ["a link", [...PACKAGE, { path: "package/link", type: "2" }]],
    ["a path outside package/", [...PACKAGE, { path: "other/file", content: "x" }]],
    ["a parent folder", [...PACKAGE, { path: "package/../escape", content: "x" }]],
    ["a reserved device name", [...PACKAGE, { path: "package/aux.txt", content: "x" }]],
    ["no program", PACKAGE.filter(entry => !entry.path.endsWith("codex"))],
  ] as const)("refuses a verified archive with %s", async (_case, entries) => {
    const archive = tarball([...entries]);
    const root = await store();
    await expect(installNativeEngine(root, "codex", { lock: lockFor(archive, [...entries]), target: TARGET, fetch: await serve(archive), version }))
      .rejects.toThrow(/unexpected layout|no program/);
    expect(await readdir(join(root, "codex"))).toEqual([]);
    expect(version).not.toHaveBeenCalled();
  });

  it("refuses more files or bytes than npm published for the package", async () => {
    const archive = tarball(PACKAGE);
    const root = await store();
    const fetcher = await serve(archive);
    await expect(installNativeEngine(root, "codex", { lock: lockFor(archive, PACKAGE, { files: 2 }), target: TARGET, fetch: fetcher, version }))
      .rejects.toThrow("unexpected layout");
    await expect(installNativeEngine(root, "codex", { lock: lockFor(archive, PACKAGE, { unpackedBytes: 10 }), target: TARGET, fetch: fetcher, version }))
      .rejects.toThrow("unexpected layout");
  });

  it("removes a copy that does not report the pinned version", async () => {
    const archive = tarball(PACKAGE);
    const root = await store();
    version.mockResolvedValue("9.9.8");
    await expect(installNativeEngine(root, "codex", { lock: lockFor(archive), target: TARGET, fetch: await serve(archive), version }))
      .rejects.toThrow("Codex did not start on this computer.");
    expect(await readdir(join(root, "codex"))).toEqual([]);
  });

  it("reports progress while it downloads", async () => {
    const archive = tarball(PACKAGE);
    const root = await store();
    let release!: () => void;
    const fetcher = await registry(response => {
      response.writeHead(200, { "content-length": archive.length });
      response.write(archive.subarray(0, 50));
      release = () => response.end(archive.subarray(50));
    });
    const installing = installNativeEngine(root, "codex", { lock: lockFor(archive), target: TARGET, fetch: fetcher, version });
    await vi.waitFor(() => expect(nativeEngineInstalls(root)[0]?.receivedBytes).toBe(50));
    expect(nativeEngineInstalls(root)).toEqual([{ engine: "codex", state: "downloading", receivedBytes: 50, totalBytes: archive.length }]);
    release();
    await installing;
    expect(nativeEngineInstalls(root)).toEqual([]);
  });
});

describe("starting a managed copy", () => {
  async function installed() {
    const archive = tarball(PACKAGE);
    const root = await store();
    const options = { lock: lockFor(archive), target: TARGET, fetch: await serve(archive), version };
    await installNativeEngine(root, "codex", options);
    return { root, options, directory: join(root, "codex", "9.9.9") };
  }

  it("hashes every recorded file and asks the version before the first start of a session", async () => {
    const { root, options } = await installed();
    resetNativeEngineStore();
    version.mockClear();
    expect((await managedNativeEngine(root, "codex", options))?.ready).toBe(true);
    expect(version).toHaveBeenCalledOnce();
    // Later starts reuse that check while every file keeps its size and date.
    await managedNativeEngine(root, "codex", options);
    expect(version).toHaveBeenCalledOnce();
    resetNativeEngineStore();
    version.mockResolvedValue("9.9.8");
    expect(await managedNativeEngine(root, "codex", options)).toBeNull();
  });

  it("refuses a copy whose file changed or whose record is missing", async () => {
    const { root, options, directory } = await installed();
    await writeFile(join(directory, "package", "vendor", "resources", "rg"), "HELPER");
    expect(await managedNativeEngine(root, "codex", options)).toBeNull();
    await writeFile(join(directory, "package", "vendor", "resources", "rg"), "changed size");
    expect(await managedNativeEngine(root, "codex", options)).toBeNull();
    await rm(join(directory, "mycellios-install.json"));
    expect(await managedNativeEngine(root, "codex", options)).toBeNull();
    // Install replaces the damaged copy with a verified one.
    await installNativeEngine(root, "codex", options);
    expect((await managedNativeEngine(root, "codex", options))?.ready).toBe(true);
  });
});

describe("resolution", () => {
  /** A folder on PATH with a CLI the version prober answers for. */
  async function onPath() {
    const folder = await store();
    const file = join(folder, process.platform === "win32" ? "codex.exe" : "codex");
    await writeFile(file, "");
    if (process.platform !== "win32") await chmod(file, 0o755);
    return { folder, file };
  }

  it("prefers a configured command, then the newer of the managed copy and PATH, the person's on a tie", async () => {
    const archive = tarball(PACKAGE);
    const root = await store();
    const base = { lock: lockFor(archive), target: TARGET, fetch: await serve(archive), version, storeRoot: root };
    const path = await onPath();
    const env = { PATH: path.folder };
    const pathVersion = (value: string | undefined) => version.mockImplementation(async command =>
      command.command === path.file ? value : "9.9.9");

    expect(await resolveNativeEngine("codex", { ...base, env })).toMatchObject({ source: "path", command: { command: path.file } });
    await installNativeEngine(root, "codex", base);
    const managed = join(root, "codex", "9.9.9", "package", "vendor", "bin", "codex");
    expect(await resolveNativeEngine("codex", { ...base, env: { PATH: "" } })).toMatchObject({ source: "managed", version: "9.9.9" });
    for (const [reported, source] of [["10.0.0", "path"], ["9.9.9", "path"], ["9.9.0", "managed"], [undefined, "managed"]] as const) {
      resetNativeEngineVersions();
      pathVersion(reported);
      const resolved = await resolveNativeEngine("codex", { ...base, env });
      expect(resolved?.source, String(reported)).toBe(source);
      expect(resolved?.command.command).toBe(source === "path" ? path.file : managed);
    }
    const configured = { command: process.execPath, args: ["configured"] };
    expect(await resolveNativeEngine("codex", { ...base, env, configured })).toEqual({ command: configured, source: "configured", ready: true });
    expect(await resolveNativeEngine("codex", { env: { PATH: "" } })).toBeNull();
  });

  it("lets discovery go on while a managed copy is still being checked", async () => {
    const archive = tarball(PACKAGE);
    const root = await store();
    const options = { lock: lockFor(archive), target: TARGET, fetch: await serve(archive), version };
    await installNativeEngine(root, "codex", options);
    resetNativeEngineStore();
    let answer!: (value: string) => void;
    version.mockImplementation(() => new Promise(resolve => { answer = resolve; }));
    expect(await resolveNativeEngine("codex", { ...options, storeRoot: root, env: { PATH: "" }, waitMs: 10 }))
      .toMatchObject({ source: "managed", ready: false });
    answer("9.9.9");
    expect(await resolveNativeEngine("codex", { ...options, storeRoot: root, env: { PATH: "" } }))
      .toMatchObject({ source: "managed", ready: true });
  });
});

describe("pre-store copies", () => {
  it("adopts an OpenCode copy from before the store only when its file has the pinned hash", async () => {
    const root = await store();
    const directory = join(root, "opencode", "1.19.5");
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "opencode.exe"), "not the pinned program");
    expect(await managedNativeEngine(root, "opencode", { target: "win32-x64", version })).toBeNull();
    await expect(readFile(join(directory, "mycellios-install.json"))).rejects.toThrow();
  });
});
