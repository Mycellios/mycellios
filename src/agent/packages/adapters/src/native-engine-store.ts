import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { mkdir, mkdtemp, open, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream } from "node:stream/web";
import { createGunzip } from "node:zlib";
import type { NativeEngineInstallable, NativeEngineInstallProgress, NativeInstallEngine } from "@mycellios/contracts";
import { z } from "zod";
import type { NativeCommand } from "./native-agent-process.js";
import { nativeEnvironment } from "./native-agent-process.js";
import bundledBlocklistFile from "./native-engines.blocklist.json" with { type: "json" };
import lockFile from "./native-engines.lock.json" with { type: "json" };

/**
 * The per-user store of managed CLIs (specs/native-engines/spec.md phase 3):
 * `provider-runtimes/<engine>/<version>`. A download comes only from npm's own tarball of a version
 * the repository's lock file pins or the engine's npm channel names, is bounded and checked against
 * the vendor's published hash before anything is unpacked, and is unpacked into a staging folder
 * that becomes the version folder only after every file was recorded and the program reported its
 * version. Turns run the newest copy that the blocklist does not withdraw. No administrator rights,
 * no global package manager and never the CLI's own updater.
 */

export const NATIVE_ENGINE_TARGETS = ["win32-x64", "win32-arm64", "darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64"] as const;
export type NativeEngineTarget = (typeof NATIVE_ENGINE_TARGETS)[number];
const NAMES: Record<NativeInstallEngine, string> = { codex: "Codex", claude: "Claude Code", opencode: "OpenCode" };
/** Arguments an engine's executable runs with; the version check leaves them out. */
const ENGINE_ARGS: Record<NativeInstallEngine, string[]> = { codex: [], claude: [], opencode: ["acp"] };
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const RECORD = "mycellios-install.json";
/** The first start after an install may wait for the system to scan a large new program. */
const INSTALL_CHECK_MS = 60_000;
const START_CHECK_MS = 20_000;
/** A download that receives nothing for this long is stopped; the whole download has its own cap. */
const STALL_MS = 60_000;
const DOWNLOAD_MS = 60 * 60_000;
/** A failed check is repeated after this long instead of on every read. */
const FAILED_CHECK_MS = 5 * 60_000;
const FAILURE_SHOWN_MS = 15 * 60_000;
/** Copies installed before the store kept records, adopted when their file has the hash Mycellios pinned. */
const LEGACY_COPIES: Partial<Record<NativeInstallEngine, { target: NativeEngineTarget; version: string; file: string; sha256: string }>> = {
  opencode: { target: "win32-x64", version: "1.19.5", file: "opencode.exe",
    sha256: "6f15c8f241f3df22375f174753193a71c488f6c0a6bbbae3f9fa34d112673b7b" },
};

/** A relative path with `/` separators, no traversal and no name or character a filesystem reads specially. */
function storePath(value: string) {
  return value.length <= 400 && !/[\\:*?"<>|\0-\x1f]/.test(value) &&
    value.split("/").every(part => part !== "" && part !== "." && part !== ".." && !/[. ]$/.test(part) &&
      !/^(?:con|prn|aux|nul|com\d|lpt\d)(?:\.|$)/i.test(part));
}
const packagePath = (value: string) => value.startsWith("package/") && storePath(value);

const REGISTRY = "https://registry.npmjs.org";
const NPM_PACKAGE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
/** npm's own tarball address for a package version, the only download the store accepts. */
const npmTarball = (name: string, version: string) => `${REGISTRY}/${name}/-/${name.split("/").pop()}-${version}.tgz`;
/** A registry document's address: a scope's slash is encoded. */
const registryPath = (name: string) => name.replace("/", "%2F");
/** Update checks read small registry documents, each within this size and time. */
const METADATA_BYTES = 256 * 1024;
const METADATA_MS = 15_000;

const ReleaseSchema = z.object({
  package: z.string().max(214).regex(NPM_PACKAGE),
  url: z.string().max(500).refine(url => url.startsWith(`${REGISTRY}/`) && !url.includes("..")),
  integrity: z.string().regex(/^sha512-[A-Za-z0-9+/]{86}==$/),
  bytes: z.number().int().positive().max(1024 ** 3),
  unpackedBytes: z.number().int().positive().max(4 * 1024 ** 3),
  files: z.number().int().positive().max(10_000),
  executable: z.string().refine(packagePath),
  /** What this target's package version adds to the engine version (Codex publishes `<version>-<target>`). */
  versionSuffix: z.string().max(40).regex(/^-[a-z0-9-]+$/).optional(),
});
const LockedEngineSchema = z.object({
  version: z.string().max(64).regex(VERSION),
  source: z.literal("npm"),
  /** The dist-tag of the engine's main npm package that Desktop follows for newer versions. */
  channel: z.object({ package: z.string().max(214).regex(NPM_PACKAGE), tag: z.string().max(64).regex(/^[a-z][a-z0-9.-]*$/) }),
  targets: z.partialRecord(z.enum(NATIVE_ENGINE_TARGETS), ReleaseSchema),
}).refine(engine => Object.values(engine.targets).every(release => !release ||
  release.url === npmTarball(release.package, `${engine.version}${release.versionSuffix ?? ""}`)),
"Each target downloads npm's own tarball of its package version");
export const NativeEngineLockSchema = z.object({
  schemaVersion: z.literal(1),
  engines: z.object({ codex: LockedEngineSchema, claude: LockedEngineSchema, opencode: LockedEngineSchema }),
});
export type NativeEngineLock = z.infer<typeof NativeEngineLockSchema>;
/** Each engine's first-install version per target, as its vendor published it (scripts/native-engine-lock.mjs). */
export const nativeEngineLock: NativeEngineLock = NativeEngineLockSchema.parse(lockFile);

export type NativeEngineRelease = z.infer<typeof ReleaseSchema> & {
  engine: NativeInstallEngine;
  version: string;
  target: NativeEngineTarget;
};
export type NativeEngineStoreOptions = {
  lock?: NativeEngineLock;
  target?: NativeEngineTarget;
  fetch?: typeof fetch;
  /** Reads the version an executable reports; tests replace it. */
  version?: (command: NativeCommand, timeoutMs: number) => Promise<string | undefined>;
};
export type ManagedNativeEngine = {
  command: NativeCommand;
  version: string;
  /** False while discovery stopped waiting for the start check; nothing may start the copy yet. */
  ready: boolean;
};
export type NativeEngineInstallOptions = NativeEngineStoreOptions & {
  /** A release to install instead of the lock's: a newer version that the engine's channel names. */
  release?: NativeEngineRelease;
  /** Runs once the download matched its published hash, before it is unpacked, checked and started. */
  onChecking?: () => void;
};

const RecordSchema = z.object({
  schemaVersion: z.literal(1),
  engine: z.enum(["codex", "claude", "opencode"]),
  version: z.string().max(64),
  target: z.enum(NATIVE_ENGINE_TARGETS),
  executable: z.string().max(512),
  files: z.record(z.string().max(512), z.object({
    bytes: z.number().int().min(0),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })),
});
type InstallRecord = z.infer<typeof RecordSchema>;

export class NativeEngineInstallError extends Error {}

export function nativeEngineTarget(platformName: string = process.platform, arch: string = process.arch) {
  return NATIVE_ENGINE_TARGETS.find(target => target === `${platformName}-${arch}`);
}

/** The pinned download of an engine for this computer, or undefined when its vendor publishes none. */
export function nativeEngineRelease(engine: NativeInstallEngine, options: NativeEngineStoreOptions = {}):
  NativeEngineRelease | undefined {
  const target = options.target ?? nativeEngineTarget();
  const locked = (options.lock ?? nativeEngineLock).engines[engine];
  const release = target ? locked.targets[target] : undefined;
  return target && release ? { ...release, engine, version: locked.version, target } : undefined;
}

/** What the person sees before installing: version, vendor package and download size. */
export function nativeEngineInstallable(engine: NativeInstallEngine, options: NativeEngineStoreOptions = {}):
  NativeEngineInstallable | undefined {
  const release = nativeEngineRelease(engine, options);
  return release && { engine, version: release.version, source: "npm", package: release.package, bytes: release.bytes };
}

/** A host's store: provider-runtimes in its data folder (Desktop: its per-user profile). */
export const nativeEngineStoreRoot = (dataDir: string) => join(dataDir, "provider-runtimes");

/** The first version an executable prints for `--version` (bounded), or undefined. */
export function parseCliVersion(output: string) {
  return /(?<![\d.])(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/.exec(output.slice(0, 4096))?.[1];
}

export function nativeCliVersion(command: NativeCommand, timeoutMs = START_CHECK_MS): Promise<string | undefined> {
  return new Promise(resolve => {
    execFile(command.command, [...(command.args ?? []), "--version"], {
      cwd: homedir(), env: { ...nativeEnvironment(), ELECTRON_RUN_AS_NODE: "1" }, timeout: timeoutMs,
      windowsHide: true, maxBuffer: 64 * 1024,
    }, (error, stdout) => resolve(error ? undefined : parseCliVersion(String(stdout))));
  });
}

/** Semantic version order: numbers first, and a release above its prereleases. */
export function compareVersions(left: string, right: string) {
  const parse = (value: string) => /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(value);
  const a = parse(left), b = parse(right);
  if (!a || !b) return 0;
  for (const index of [1, 2, 3]) {
    const difference = Number(a[index]) - Number(b[index]);
    if (difference) return Math.sign(difference);
  }
  if (!a[4] || !b[4]) return a[4] ? -1 : b[4] ? 1 : 0;
  const x = a[4].split("."), y = b[4].split(".");
  for (let index = 0; index < Math.max(x.length, y.length); index++) {
    const p = x[index], q = y[index];
    if (p === undefined || q === undefined) return p === undefined ? -1 : 1;
    const numeric = /^\d+$/.test(p), otherNumeric = /^\d+$/.test(q);
    if (numeric && otherNumeric && Number(p) !== Number(q)) return Math.sign(Number(p) - Number(q));
    if (numeric !== otherNumeric) return numeric ? -1 : 1;
    if (p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

async function settledWithin<T>(promise: Promise<T>, waitMs: number | undefined): Promise<T | undefined> {
  if (waitMs === undefined) return promise;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<undefined>(resolve => { timer = setTimeout(resolve, waitMs, undefined); });
  try { return await Promise.race([promise, late]); }
  finally { clearTimeout(timer); }
}

async function readRecord(directory: string): Promise<InstallRecord | null> {
  try {
    const raw = await readFile(join(directory, RECORD), "utf8");
    if (raw.length > 2 * 1024 * 1024) return null;
    const record = RecordSchema.parse(JSON.parse(raw));
    const names = Object.keys(record.files);
    return names.length <= 10_000 && names.every(storePath) && record.files[record.executable] ? record : null;
  } catch {
    return null;
  }
}

async function sha256(file: string) {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(file) as AsyncIterable<Buffer>) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  return { bytes, sha256: hash.digest("hex") };
}

/** Writes a record for a pre-store copy whose single file has the hash Mycellios pinned for it. */
async function adoptLegacyCopy(directory: string, engine: NativeInstallEngine, version: string,
  target: NativeEngineTarget): Promise<InstallRecord | null> {
  const legacy = LEGACY_COPIES[engine];
  if (!legacy || legacy.target !== target || legacy.version !== version) return null;
  try {
    const file = await sha256(join(directory, legacy.file));
    if (file.sha256 !== legacy.sha256) return null;
    const record: InstallRecord = { schemaVersion: 1, engine, version, target, executable: legacy.file,
      files: { [legacy.file]: file } };
    await writeFile(join(directory, RECORD), JSON.stringify(record), { flag: "wx", mode: 0o600 });
    return record;
  } catch {
    return null;
  }
}

type InstalledCopy = { version: string; directory: string; record: InstallRecord };

/** The recorded copy of one engine version for this computer, or null. */
async function installedCopy(root: string, engine: NativeInstallEngine, version: string,
  target: NativeEngineTarget): Promise<InstalledCopy | null> {
  const directory = join(root, engine, version);
  const record = await readRecord(directory) ?? await adoptLegacyCopy(directory, engine, version, target);
  return record && record.engine === engine && record.version === version && record.target === target
    ? { version, directory, record } : null;
}

/** Every recorded copy of an engine for this computer, newest first. Nothing is hashed or started. */
async function installedCopies(root: string, engine: NativeInstallEngine, target: NativeEngineTarget) {
  const names = await readdir(join(root, engine)).catch(() => [] as string[]);
  const copies = await Promise.all(names.filter(name => name.length <= 64 && VERSION.test(name))
    .map(name => installedCopy(root, engine, name, target)));
  return copies.filter((copy): copy is InstalledCopy => copy !== null)
    .sort((left, right) => compareVersions(right.version, left.version));
}

/** The versions of an engine this store holds for this computer, newest first (records only). */
export async function nativeEngineVersions(root: string, engine: NativeInstallEngine,
  options: NativeEngineStoreOptions = {}): Promise<string[]> {
  const target = options.target ?? nativeEngineTarget();
  return target && isAbsolute(root) ? (await installedCopies(root, engine, target)).map(copy => copy.version) : [];
}

/** Sizes and modification times of every recorded file; null when one is missing or changed size. */
async function recordSignature(directory: string, record: InstallRecord) {
  const parts = await Promise.all(Object.entries(record.files).map(async ([name, file]) => {
    const info = await stat(join(directory, ...name.split("/"))).catch(() => null);
    return info?.isFile() && info.size === file.bytes ? `${name}:${info.size}:${info.mtimeMs}` : null;
  }));
  return parts.includes(null) ? null : parts.join("\n");
}

const checks = new Map<string, { signature: string; result: Promise<boolean> }>();

async function checkCopy(directory: string, record: InstallRecord, executable: string, version: string,
  options: NativeEngineStoreOptions) {
  try {
    for (const [name, file] of Object.entries(record.files)) {
      const actual = await sha256(join(directory, ...name.split("/")));
      if (actual.bytes !== file.bytes || actual.sha256 !== file.sha256) return false;
    }
    return await (options.version ?? nativeCliVersion)({ command: executable }, START_CHECK_MS) === version;
  } catch {
    return false;
  }
}

const managedCopy = (copy: InstalledCopy, ready = true): ManagedNativeEngine => ({
  command: { command: join(copy.directory, ...copy.record.executable.split("/")), args: ENGINE_ARGS[copy.record.engine] },
  version: copy.version, ready,
});

/**
 * Whether a copy passed its start check: every recorded file hashed again and the program reporting
 * its version, once per session and again only when a file's size or modification time changed.
 * Undefined while the check is still running after `waitMs`.
 */
async function startCheck(copy: InstalledCopy, options: NativeEngineStoreOptions, waitMs?: number) {
  const signature = await recordSignature(copy.directory, copy.record);
  if (!signature) return false;
  const { directory } = copy;
  let check = checks.get(directory);
  if (check?.signature !== signature) {
    const executable = managedCopy(copy).command.command;
    const current = { signature, result: checkCopy(directory, copy.record, executable, copy.version, options) };
    checks.set(directory, current);
    void current.result.then(ok => {
      if (!ok) setTimeout(() => { if (checks.get(directory) === current) checks.delete(directory); }, FAILED_CHECK_MS).unref?.();
    });
    check = current;
  }
  return settledWithin(check.result, waitMs);
}

/**
 * The managed copy of an engine that turns start, or null: the newest copy the blocklist does not
 * withdraw and that passes its start check (a copy that fails it leaves the previous one in use).
 * `waitMs` bounds how long discovery waits for a check: a copy still being checked comes back with
 * `ready: false`.
 */
export async function managedNativeEngine(root: string, engine: NativeInstallEngine,
  options: NativeEngineStoreOptions & { waitMs?: number } = {}): Promise<ManagedNativeEngine | null> {
  const target = options.target ?? nativeEngineTarget();
  if (!target || !isAbsolute(root)) return null;
  for (const copy of await installedCopies(root, engine, target)) {
    if (nativeEngineBlocked(root, engine, copy.version, target)) continue;
    const ready = await startCheck(copy, options, options.waitMs);
    if (ready !== false) return managedCopy(copy, ready === true);
  }
  return null;
}

/**
 * Removes one version of an engine from the store. It is renamed aside first, so a copy whose program
 * is still running (Windows keeps it busy) stays whole and is tried again later; leftovers of earlier
 * removals go too. Only the store's own folders are ever removed.
 */
export async function removeNativeEngineCopy(root: string, engine: NativeInstallEngine, version: string) {
  if (!isAbsolute(root) || version.length > 64 || !VERSION.test(version)) return false;
  const parent = join(root, engine);
  const directory = join(parent, version);
  let removed = false;
  try {
    await rename(directory, join(parent, `.remove-${randomUUID()}`));
    checks.delete(directory);
    removed = true;
  } catch { /* in use or already gone: the next check tries again */ }
  const names = await readdir(parent).catch(() => [] as string[]);
  for (const name of names.filter(entry => entry.startsWith(".remove-")))
    await rm(join(parent, name), { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }).catch(() => undefined);
  return removed;
}

async function download(release: NativeEngineRelease, archive: string, progress: NativeEngineInstallProgress,
  fetcher: typeof fetch) {
  const name = NAMES[release.engine];
  const unreachable = () => new NativeEngineInstallError(`Could not download ${name}. Check the connection and try again.`);
  const stalled = new AbortController();
  const signal = AbortSignal.any([stalled.signal, AbortSignal.timeout(DOWNLOAD_MS)]);
  let timer = setTimeout(() => stalled.abort(), STALL_MS);
  const response = await fetcher(release.url, { redirect: "error", signal }).catch(() => null);
  try {
    if (!response?.ok || !response.body) {
      await response?.body?.cancel().catch(() => undefined);
      throw unreachable();
    }
    const declared = response.headers.get("content-length");
    if (declared !== null && Number(declared) !== release.bytes) {
      await response.body.cancel().catch(() => undefined);
      throw new NativeEngineInstallError(`The ${name} download does not have its published size.`);
    }
    const hash = createHash("sha512");
    let received = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length;
        // Stop as soon as the download is larger than published; nothing past the bound is kept.
        if (received > release.bytes)
          return callback(new NativeEngineInstallError(`The ${name} download is larger than published.`));
        clearTimeout(timer);
        timer = setTimeout(() => stalled.abort(), STALL_MS);
        hash.update(chunk);
        progress.receivedBytes = received;
        callback(null, chunk);
      },
      flush(callback) {
        if (received !== release.bytes)
          return callback(new NativeEngineInstallError(`The ${name} download was incomplete. Try again.`));
        const expected = Buffer.from(release.integrity.slice("sha512-".length), "base64");
        callback(hash.digest().equals(expected) ? undefined
          : new NativeEngineInstallError(`The ${name} download did not match its published hash.`));
      },
    });
    await pipeline(Readable.fromWeb(response.body as ReadableStream<Uint8Array>), meter,
      createWriteStream(archive, { flags: "wx", mode: 0o600 }), { signal });
  } catch (error) {
    if (error instanceof NativeEngineInstallError) throw error;
    throw unreachable();
  } finally {
    clearTimeout(timer);
  }
}

type Extracted = Record<string, { bytes: number; sha256: string }>;
type TarHeader = { path: string; mode: number; size: number; type: string };

function tarHeader(block: Buffer, invalid: () => Error): TarHeader {
  const text = (start: number, length: number) => {
    const raw = block.subarray(start, start + length);
    const end = raw.indexOf(0);
    return raw.subarray(0, end < 0 ? length : end).toString("utf8");
  };
  const octal = (start: number, length: number) => {
    const value = text(start, length).trim();
    if (!/^[0-7]*$/.test(value)) throw invalid();
    return value ? Number.parseInt(value, 8) : 0;
  };
  let sum = 0;
  for (let index = 0; index < 512; index++) sum += index >= 148 && index < 156 ? 32 : block[index]!;
  if (sum !== octal(148, 8)) throw invalid();
  // POSIX ustar keeps long paths in a prefix field; other formats use that space differently.
  const prefix = block.subarray(257, 263).toString("latin1") === "ustar\0" ? text(345, 155) : "";
  const name = text(0, 100);
  return { path: prefix ? `${prefix}/${name}` : name, mode: octal(100, 8), size: octal(124, 12),
    type: String.fromCharCode(block[156]!) };
}

/** The `path` record of a pax extended header, if it has one. */
function paxPath(data: Buffer, invalid: () => Error) {
  let path: string | undefined;
  for (let offset = 0; offset < data.length;) {
    const space = data.indexOf(0x20, offset);
    const length = space < 0 ? NaN : Number(data.subarray(offset, space).toString("latin1"));
    if (!Number.isSafeInteger(length) || length <= 0 || offset + length > data.length) throw invalid();
    const record = data.subarray(space + 1, offset + length - 1).toString("utf8");
    const equals = record.indexOf("=");
    const key = record.slice(0, equals);
    // A size override exists only for files over 8 GiB, which no lock entry allows.
    if (key === "size") throw invalid();
    if (key === "path") path = record.slice(equals + 1);
    offset += length;
  }
  return path;
}

/**
 * Unpacks a verified npm tarball into `directory`: regular files and folders under `package/`
 * only, within the file count and unpacked size npm published, each new file created exclusively.
 * Links, devices and anything outside `package/` fail the install.
 */
async function extractPackage(archive: string, directory: string, release: NativeEngineRelease): Promise<Extracted> {
  const invalid = () => new NativeEngineInstallError(`The ${NAMES[release.engine]} package has an unexpected layout.`);
  const files: Extracted = {};
  let total = 0;
  type Entry = { remaining: number; padding: number; write: (piece: Buffer) => Promise<void>;
    close: () => Promise<void>; handle?: FileHandle };
  let pending: Buffer = Buffer.alloc(0);
  let ended = false;
  let longPath: string | undefined;
  let entry: Entry | undefined;

  async function begin(block: Buffer): Promise<Entry> {
    const header = tarHeader(block, invalid);
    const padding = (512 - (header.size % 512)) % 512;
    if (header.type === "x" || header.type === "g" || header.type === "L") {
      if (header.size > 64 * 1024) throw invalid();
      const parts: Buffer[] = [];
      return { remaining: header.size, padding, write: async (piece: Buffer) => { parts.push(piece); },
        close: async () => {
          const data = Buffer.concat(parts);
          if (header.type === "x") longPath = paxPath(data, invalid) ?? longPath;
          if (header.type === "L") longPath = data.toString("utf8").replace(/\0+$/, "");
        } };
    }
    const path = longPath ?? header.path;
    longPath = undefined;
    if (header.type === "5") {
      const folder = path.replace(/\/$/, "");
      if (header.size !== 0 || (folder !== "package" && !packagePath(folder))) throw invalid();
      await mkdir(join(directory, ...folder.split("/")), { recursive: true, mode: 0o700 });
      return { remaining: 0, padding: 0, write: async () => undefined, close: async () => undefined };
    }
    if (!["0", "\0", "7"].includes(header.type) || !packagePath(path) || files[path]) throw invalid();
    total += header.size;
    if (Object.keys(files).length >= release.files || total > release.unpackedBytes) throw invalid();
    const target = join(directory, ...path.split("/"));
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    const executable = path === release.executable || (header.mode & 0o111) !== 0;
    const handle = await open(target, "wx", executable ? 0o700 : 0o600);
    const hash = createHash("sha256");
    const opened: Entry = {
      remaining: header.size, padding, handle,
      write: async (piece: Buffer) => {
        hash.update(piece);
        for (let written = 0; written < piece.length;) written += (await handle.write(piece, written)).bytesWritten;
      },
      close: async () => {
        opened.handle = undefined;
        await handle.close();
        files[path] = { bytes: header.size, sha256: hash.digest("hex") };
      },
    };
    return opened;
  }

  const input = createReadStream(archive);
  const unpacked = input.pipe(createGunzip());
  input.once("error", error => unpacked.destroy(error));
  try {
    for await (const chunk of unpacked as AsyncIterable<Buffer>) {
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      // Whatever follows the archive's end marker is never unpacked.
      if (ended) break;
      for (;;) {
        if (ended) break;
        if (!entry) {
          if (pending.length < 512) break;
          const block = pending.subarray(0, 512);
          pending = pending.subarray(512);
          if (block.every(byte => byte === 0)) ended = true;
          else entry = await begin(block);
          continue;
        }
        if (entry.remaining > 0) {
          if (!pending.length) break;
          const piece = pending.subarray(0, Math.min(pending.length, entry.remaining));
          pending = pending.subarray(piece.length);
          entry.remaining -= piece.length;
          await entry.write(piece);
          continue;
        }
        if (entry.padding > 0) {
          if (!pending.length) break;
          const skipped = Math.min(pending.length, entry.padding);
          pending = pending.subarray(skipped);
          entry.padding -= skipped;
          continue;
        }
        await entry.close();
        entry = undefined;
      }
    }
    if (entry || !ended) throw invalid();
    return files;
  } catch (error) {
    throw error instanceof NativeEngineInstallError ? error : invalid();
  } finally {
    // Nothing stays open in the staging folder, which is removed after a failure.
    input.destroy();
    await entry?.handle?.close().catch(() => undefined);
  }
}

async function renameWhenFree(from: string, to: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await rename(from, to);
    } catch (error) {
      // Windows can keep a program that just ran busy for a moment (indexing, antivirus scans).
      const code = (error as NodeJS.ErrnoException).code ?? "";
      if (attempt >= 20 || !["EPERM", "EBUSY", "EACCES"].includes(code)) throw error;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
}

async function install(root: string, release: NativeEngineRelease, progress: NativeEngineInstallProgress,
  options: NativeEngineInstallOptions): Promise<ManagedNativeEngine> {
  const existing = await installedCopy(root, release.engine, release.version, release.target);
  if (existing && await startCheck(existing, options)) return managedCopy(existing);
  const name = NAMES[release.engine];
  const parent = join(root, release.engine);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const staging = await mkdtemp(join(parent, ".install-"));
  try {
    const archive = join(staging, "download.tgz");
    await download(release, archive, progress, options.fetch ?? fetch);
    progress.state = "checking";
    options.onChecking?.();
    const files = await extractPackage(archive, staging, release);
    await rm(archive, { force: true });
    if (!files[release.executable]) throw new NativeEngineInstallError(`The ${name} package has no program for this computer.`);
    if (nativeEngineBlocked(root, release.engine, release.version, release.target))
      throw new NativeEngineInstallError(`${name} ${release.version} was withdrawn. Try again later.`);
    // Only now, with every byte verified and recorded, is the program started, to read its version.
    const staged = join(staging, ...release.executable.split("/"));
    if (await (options.version ?? nativeCliVersion)({ command: staged }, INSTALL_CHECK_MS) !== release.version)
      throw new NativeEngineInstallError(`${name} did not start on this computer.`);
    const record: InstallRecord = { schemaVersion: 1, engine: release.engine, version: release.version,
      target: release.target, executable: release.executable, files };
    await writeFile(join(staging, RECORD), JSON.stringify(record), { flag: "wx", mode: 0o600 });
    const directory = join(parent, release.version);
    // A folder already there has no valid record (incomplete or damaged), so the checked copy replaces it.
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    await renameWhenFree(staging, directory);
    const signature = await recordSignature(directory, record);
    if (signature) checks.set(directory, { signature, result: Promise.resolve(true) });
    return { command: { command: join(directory, ...release.executable.split("/")), args: ENGINE_ARGS[release.engine] },
      version: release.version, ready: true };
  } finally {
    await rm(staging, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => undefined);
  }
}

type InstallState = { root: string; progress: NativeEngineInstallProgress; at: number; promise?: Promise<ManagedNativeEngine> };
const installs = new Map<string, InstallState>();

/**
 * Installs the pinned copy of an engine, or the given newer release, into the store; one install
 * or update of an engine runs at a time and concurrent requests share it.
 */
export function installNativeEngine(root: string, engine: NativeInstallEngine,
  options: NativeEngineInstallOptions = {}): Promise<ManagedNativeEngine> {
  const key = JSON.stringify([root, engine]);
  const running = installs.get(key)?.promise;
  if (running) return running;
  const release = options.release ?? nativeEngineRelease(engine, options);
  if (!release || release.engine !== engine || !isAbsolute(root))
    return Promise.reject(new NativeEngineInstallError(`${NAMES[engine]} is not available for this computer.`));
  if (nativeEngineBlocked(root, engine, release.version, release.target))
    return Promise.reject(new NativeEngineInstallError(`${NAMES[engine]} ${release.version} was withdrawn. Try again later.`));
  const progress: NativeEngineInstallProgress = { engine, state: "downloading", receivedBytes: 0, totalBytes: release.bytes };
  const state: InstallState = { root, progress, at: Date.now() };
  state.promise = install(root, release, progress, options).then(managed => {
    installs.delete(key);
    return managed;
  }, (error: unknown) => {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    const message = error instanceof NativeEngineInstallError ? error.message
      : code === "ENOSPC" ? `There is not enough free space to install ${NAMES[engine]}.`
        : `Could not install ${NAMES[engine]}. Try again.`;
    installs.set(key, { root, progress: { engine, state: "failed", error: message }, at: Date.now() });
    throw new NativeEngineInstallError(message);
  });
  installs.set(key, state);
  return state.promise;
}

/** Installs running in this store, and failures of the last minutes, for the person to see. */
export function nativeEngineInstalls(root: string, now = Date.now()): NativeEngineInstallProgress[] {
  return [...installs.values()]
    .filter(state => state.root === root && (state.promise || now - state.at < FAILURE_SHOWN_MS))
    .map(state => ({ ...state.progress }));
}

/** Whether an install or update of an engine is running in this store. */
export function nativeEngineInstalling(root: string, engine: NativeInstallEngine) {
  return Boolean(installs.get(JSON.stringify([root, engine]))?.promise);
}

class RegistryAnswer extends Error {
  constructor(readonly status: number) { super(`The registry answered ${status}`); }
}

/** A small JSON document: no redirect, no account data, within a deadline and a size bound. */
async function boundedJson(fetcher: typeof fetch, url: string, maxBytes: number): Promise<unknown> {
  const response = await fetcher(url, { headers: { accept: "application/json" }, redirect: "error",
    signal: AbortSignal.timeout(METADATA_MS) });
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => undefined);
    throw new RegistryAnswer(response.status);
  }
  if (Number(response.headers.get("content-length") ?? 0) > maxBytes) {
    await response.body.cancel().catch(() => undefined);
    throw new Error("The document is larger than expected");
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of Readable.fromWeb(response.body as ReadableStream<Uint8Array>) as AsyncIterable<Buffer>) {
    total += chunk.length;
    if (total > maxBytes) throw new Error("The document is larger than expected");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const fields = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** The exact size of a tarball, from a one-byte range request (or the length a full answer declares). */
async function tarballBytes(fetcher: typeof fetch, url: string) {
  const response = await fetcher(url, { headers: { range: "bytes=0-0" }, redirect: "error",
    signal: AbortSignal.timeout(METADATA_MS) });
  await response.body?.cancel().catch(() => undefined);
  const total = response.status === 206 ? Number(/^bytes 0-0\/(\d+)$/.exec(response.headers.get("content-range") ?? "")?.[1])
    : response.status === 200 ? Number(response.headers.get("content-length")) : NaN;
  if (!Number.isSafeInteger(total) || total <= 0) throw new Error("The registry did not give the download size");
  return total;
}

/**
 * The newest release of an engine's vendor channel for this computer: the version its npm dist-tag
 * names, that version's package for this target (npm's own tarball, dist.integrity, unpacked size and
 * file count) and the exact download size. Undefined when the vendor publishes no package of that
 * version for this target; throws when the registry cannot be read. Its requests carry no account
 * data, and an install of it is verified exactly like a first install.
 */
export async function nativeEngineChannelRelease(engine: NativeInstallEngine, options: NativeEngineStoreOptions = {}):
  Promise<NativeEngineRelease | undefined> {
  const target = options.target ?? nativeEngineTarget();
  const locked = (options.lock ?? nativeEngineLock).engines[engine];
  const pinned = target ? locked.targets[target] : undefined;
  if (!target || !pinned) return undefined;
  const fetcher = options.fetch ?? fetch;
  const tagged = fields(await boundedJson(fetcher,
    `${REGISTRY}/${registryPath(locked.channel.package)}/${locked.channel.tag}`, METADATA_BYTES));
  const version = tagged.name === locked.channel.package && typeof tagged.version === "string" &&
    tagged.version.length <= 64 && VERSION.test(tagged.version) ? tagged.version : undefined;
  if (!version) throw new Error(`The ${NAMES[engine]} channel names no version`);
  const packageVersion = `${version}${pinned.versionSuffix ?? ""}`;
  let manifest: Record<string, unknown>;
  try {
    manifest = fields(await boundedJson(fetcher, `${REGISTRY}/${registryPath(pinned.package)}/${packageVersion}`, METADATA_BYTES));
  } catch (error) {
    if (error instanceof RegistryAnswer && error.status === 404) return undefined;
    throw error;
  }
  const dist = fields(manifest.dist);
  const url = npmTarball(pinned.package, packageVersion);
  if (manifest.name !== pinned.package || manifest.version !== packageVersion || dist.tarball !== url)
    throw new Error(`The registry described another ${NAMES[engine]} package`);
  const release = ReleaseSchema.safeParse({
    package: pinned.package, url, integrity: dist.integrity, bytes: await tarballBytes(fetcher, url),
    unpackedBytes: dist.unpackedSize, files: dist.fileCount, executable: pinned.executable,
    ...(pinned.versionSuffix ? { versionSuffix: pinned.versionSuffix } : {}),
  });
  if (!release.success) throw new Error(`The registry gave ${NAMES[engine]} ${version} no integrity or bounds`);
  return { ...release.data, engine, version, target };
}

const BlockedVersionSchema = z.object({
  engine: z.string().max(32),
  version: z.string().max(64).regex(VERSION),
  /** Only these targets; every target when omitted. Names a PC does not know never match it. */
  targets: z.array(z.string().max(32)).max(16).optional(),
  /** Why it was withdrawn, for the pull request that adds it; never shown in the app. */
  reason: z.string().min(1).max(300),
});
/** Versions withdrawn because they break on a target (src/agent/packages/adapters/src/native-engines.blocklist.json). */
export const NativeEngineBlocklistSchema = z.object({
  schemaVersion: z.literal(1),
  blocked: z.array(BlockedVersionSchema).max(500),
});
export type NativeEngineBlocklist = z.infer<typeof NativeEngineBlocklistSchema>;
const bundledBlocklist = NativeEngineBlocklistSchema.parse(bundledBlocklistFile);
/** The blocklist as main publishes it; a pull request to main is the only way to change it. */
export const NATIVE_ENGINE_BLOCKLIST_URL =
  "https://raw.githubusercontent.com/Mycellios/mycellios/main/src/agent/packages/adapters/src/native-engines.blocklist.json";
const BLOCKLIST_BYTES = 64 * 1024;

/** The published blocklist, or null when it cannot be read or fails its schema: such a list blocks nothing. */
export async function readNativeEngineBlocklist(fetcher: typeof fetch = fetch, url = NATIVE_ENGINE_BLOCKLIST_URL) {
  try {
    const parsed = NativeEngineBlocklistSchema.safeParse(await boundedJson(fetcher, url, BLOCKLIST_BYTES));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Whether a list withdraws a version of an engine on a target. */
export function blocklistWithdraws(list: NativeEngineBlocklist, engine: NativeInstallEngine, version: string,
  target: NativeEngineTarget) {
  return list.blocked.some(entry => entry.engine === engine && entry.version === version &&
    (!entry.targets || entry.targets.includes(target)));
}

const blocklists = new Map<string, NativeEngineBlocklist>();

/** The blocklist a store follows from now on, in addition to its bundled entries. */
export function useNativeEngineBlocklist(root: string, list: NativeEngineBlocklist) {
  blocklists.set(root, list);
}

/** Whether the store's blocklist withdraws a version: no turn starts it and no install brings it. */
export function nativeEngineBlocked(root: string, engine: NativeInstallEngine, version: string, target: NativeEngineTarget) {
  const list = blocklists.get(root);
  return blocklistWithdraws(bundledBlocklist, engine, version, target) ||
    Boolean(list && blocklistWithdraws(list, engine, version, target));
}

/** Tests only. */
export function resetNativeEngineStore() {
  installs.clear();
  checks.clear();
  blocklists.clear();
}
