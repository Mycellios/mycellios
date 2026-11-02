import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";

const SHA = /^[a-f0-9]{64}$/;
const SOURCE = /^sha256:[a-f0-9]{64}$/;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const REVISION = /^[a-f0-9]{40}$/;
const MAX_PKG_BYTES = 1_500_000_000;

export interface MacSupplementParent {
  releaseId: string;
  sourceId: string;
  revision: string;
  version: string;
  assets: readonly { channel: string; fileName: string; fileSha256: string }[];
}

interface Manifest {
  schema: "mycellios-macos-supplement/1";
  parent: { releaseId: string; sourceId: string; revision: string; version: string; windowsFileName: string; windowsSha256: string };
  target: "macos-arm64";
  artifact: { fileName: string; bytes: number; sha256: string };
  build: {
    sourceId: string; baseSourceId: string; baseArchiveSha256: string; patchSha256: string;
    recipeGitRevision: string; workflowRunId: string; workflowRunAttempt: number;
    sourceEvidenceSha256: string; releaseEvidenceSha256: string; validationReceiptSha256: string;
    signature: "unsigned";
  };
}

interface CachedObject { manifest: Manifest; artifactPath: string; identity: string }

/** This authority is operator configuration, never request data or an upload. */
export interface MacSupplementAuthority { root: string; manifestSha256s: readonly string[] }

export class MacReleaseSupplement {
  readonly #root: string;
  readonly #pins: ReadonlySet<string>;
  readonly #readOnlyAuthority: (root: string) => Promise<void>;
  readonly #ownerUid: number;
  readonly #objects = new Map<string, Promise<CachedObject>>();

  constructor(authority: MacSupplementAuthority, dependencies: {
    /** Trusted embedding/testing dependency; environment creation always uses the real mount verifier. */
    readOnlyAuthority?: (root: string) => Promise<void>; ownerUid?: number;
  } = {}) {
    requireValue(isAbsolute(authority.root) && resolve(authority.root) === authority.root, "root");
    requireValue(authority.manifestSha256s.length > 0 && authority.manifestSha256s.length <= 4, "pins");
    requireValue(authority.manifestSha256s.every((pin) => SHA.test(pin)), "pins");
    requireValue(new Set(authority.manifestSha256s).size === authority.manifestSha256s.length, "pins");
    this.#root = authority.root;
    this.#pins = new Set(authority.manifestSha256s);
    this.#readOnlyAuthority = dependencies.readOnlyAuthority ?? requireReadOnlyMacSupplementMount;
    this.#ownerUid = dependencies.ownerUid ?? 0;
  }

  /** Fail closed for Mac only. Existing release assets keep their original resolver. */
  async assetPath(parent: MacSupplementParent, channel: string, fileName: string): Promise<string | null> {
    if (channel !== "downloads" || fileName !== `mycellios-node-${parent.version}-macos-arm64.pkg`) return null;
    if (parent.assets.some((asset) => asset.channel === channel && asset.fileName === fileName)) return null;
    try {
      await this.#readOnlyAuthority(this.#root);
      const pointer = record(parseStrictJson(await this.#small(join(this.#root, "pointer.json"), 4096)));
      exact(pointer, ["schema", "manifestSha256"]);
      requireValue(pointer.schema === "mycellios-macos-supplement-pointer/1" && typeof pointer.manifestSha256 === "string", "pointer");
      const pin = pointer.manifestSha256;
      requireValue(this.#pins.has(pin), "untrusted_pointer");
      let loading = this.#objects.get(pin);
      if (!loading) {
        loading = this.#load(pin);
        this.#objects.set(pin, loading);
        void loading.catch(() => { if (this.#objects.get(pin) === loading) this.#objects.delete(pin); });
      }
      const object = await loading;
      requireValue(matchesParent(object.manifest, parent), "parent");
      // Immutable objects on an operator-owned read-only mount may be shared by concurrent streams.
      // The operator must publish another object; never modify or replace a published object.
      const current = await this.#regular(object.artifactPath);
      requireValue(identity(current) === object.identity, "artifact_drift");
      return object.artifactPath;
    } catch { return null; }
  }

  async #load(pin: string): Promise<CachedObject> {
    const root = join(this.#root, "objects", pin);
    const bytes = await this.#small(join(root, "manifest.json"), 32768, pin);
    const manifest = parseMacSupplementManifest(parseStrictJson(bytes));
    const [source, release, validation] = await Promise.all([
      this.#small(join(root, "source.json"), 262144, manifest.build.sourceEvidenceSha256),
      this.#small(join(root, "release.json"), 65536, manifest.build.releaseEvidenceSha256),
      this.#small(join(root, "validation.json"), 65536, manifest.build.validationReceiptSha256),
    ]);
    verifyMacSupplementEvidence(manifest, parseStrictJson(source), parseStrictJson(release), parseStrictJson(validation));
    const artifactPath = join(root, "artifact.pkg");
    const before = await this.#regular(artifactPath);
    requireValue(before.size === BigInt(manifest.artifact.bytes), "artifact_size");
    const handle = await open(artifactPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      requireValue(identity(await handle.stat({ bigint: true })) === identity(before), "artifact_race");
      const hash = createHash("sha256");
      let count = 0;
      for await (const part of handle.createReadStream({ autoClose: false })) {
        count += (part as Buffer).length;
        requireValue(count <= manifest.artifact.bytes, "artifact_grew");
        hash.update(part);
      }
      requireValue(count === manifest.artifact.bytes && hash.digest("hex") === manifest.artifact.sha256, "artifact_hash");
      requireValue(identity(await handle.stat({ bigint: true })) === identity(before), "artifact_race");
      requireValue(identity(await this.#regular(artifactPath)) === identity(before), "artifact_replaced");
      return { manifest, artifactPath, identity: identity(before) };
    } finally { await handle.close(); }
  }

  async #small(path: string, maximum: number, sha256?: string): Promise<string> {
    const before = await this.#regular(path);
    requireValue(before.size > 0n && before.size <= BigInt(maximum), "metadata_size");
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      requireValue(identity(await handle.stat({ bigint: true })) === identity(before), "metadata_race");
      // A bounded read must stay bounded even if a trusted mount was misconfigured.
      const buffer = Buffer.alloc(maximum + 1);
      let count = 0;
      while (count < buffer.length) {
        const result = await handle.read(buffer, count, buffer.length - count, count);
        if (result.bytesRead === 0) break;
        count += result.bytesRead;
      }
      requireValue(count === Number(before.size) && count <= maximum, "metadata_grew");
      requireValue(identity(await handle.stat({ bigint: true })) === identity(before), "metadata_race");
      requireValue(identity(await this.#regular(path)) === identity(before), "metadata_replaced");
      const bytes = buffer.subarray(0, count);
      requireValue(!sha256 || digest(bytes) === sha256, "metadata_hash");
      return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    } finally { await handle.close(); }
  }

  async #regular(path: string): Promise<BigIntStats> {
    let current = resolve(path);
    let leaf: BigIntStats | undefined;
    while (true) {
      const stat = await lstat(current, { bigint: true });
      requireValue(!stat.isSymbolicLink(), "symlink");
      if (current === resolve(path)) {
        leaf = stat;
        requireValue(stat.isFile() && stat.nlink === 1n && stat.uid === BigInt(this.#ownerUid) && (stat.mode & 0o022n) === 0n, "artifact_authority");
      } else {
        requireValue(stat.isDirectory(), "ancestor");
        if (current === this.#root || current.startsWith(this.#root + sep)) {
          requireValue(stat.uid === BigInt(this.#ownerUid), "directory_owner");
          // The real mount authority rejects non-Linux platforms. Windows fixtures do not certify POSIX permissions.
          if (process.platform === "linux") requireValue((stat.mode & 0o022n) === 0n, "directory_mode");
        }
      }
      if (dirname(current) === current) break;
      current = dirname(current);
    }
    requireValue(leaf, "missing_leaf");
    return leaf;
  }
}

export function macSupplementFromEnvironment(environment: NodeJS.ProcessEnv = process.env): MacReleaseSupplement | null {
  const root = environment.MYCELLIOS_MACOS_SUPPLEMENT_ROOT;
  const pins = environment.MYCELLIOS_MACOS_SUPPLEMENT_MANIFEST_SHA256S;
  if (!root || !pins) return null;
  try {
    requireValue(pins.length <= 1024, "pins_size");
    const parsed: unknown = JSON.parse(pins);
    requireValue(Array.isArray(parsed) && parsed.every((value) => typeof value === "string"), "pins");
    return new MacReleaseSupplement({ root, manifestSha256s: parsed as string[] });
  } catch { return null; }
}

export async function requireReadOnlyMacSupplementMount(root: string): Promise<void> {
  requireValue(process.platform === "linux", "readonly_mount_platform");
  const handle = await open("/proc/self/mountinfo", constants.O_RDONLY);
  let mounts: string;
  try {
    const buffer = Buffer.alloc(1_048_577);
    let count = 0;
    while (count < buffer.length) {
      const result = await handle.read(buffer, count, buffer.length - count, null);
      if (result.bytesRead === 0) break;
      count += result.bytesRead;
    }
    requireValue(count <= 1_048_576, "readonly_mountinfo_size");
    mounts = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, count));
  } finally { await handle.close(); }
  const matching = mounts.split("\n").filter((line) => {
    const fields = line.split(" ");
    const mount = (fields[4] ?? "").replace(/\\([0-7]{3})/g, (_all, octal: string) => String.fromCharCode(parseInt(octal, 8)));
    return mount === root && (fields[5] ?? "").split(",").includes("ro");
  });
  requireValue(matching.length === 1, "readonly_mount_required");
}

export function parseMacSupplementManifest(value: unknown): Manifest {
  const candidate = record(value);
  exact(candidate, ["schema", "parent", "target", "artifact", "build"]);
  requireValue(candidate.schema === "mycellios-macos-supplement/1" && candidate.target === "macos-arm64", "schema");
  const p = record(candidate.parent), a = record(candidate.artifact), b = record(candidate.build);
  exact(p, ["releaseId", "sourceId", "revision", "version", "windowsFileName", "windowsSha256"]);
  exact(a, ["fileName", "bytes", "sha256"]);
  exact(b, ["sourceId", "baseSourceId", "baseArchiveSha256", "patchSha256", "recipeGitRevision", "workflowRunId", "workflowRunAttempt", "sourceEvidenceSha256", "releaseEvidenceSha256", "validationReceiptSha256", "signature"]);
  for (const key of ["releaseId", "sourceId", "revision", "version", "windowsSha256"]) requireValue(typeof p[key] === "string", "parent_type");
  requireValue(SOURCE.test(p.releaseId as string) && SOURCE.test(p.sourceId as string) && REVISION.test(p.revision as string) && VERSION.test(p.version as string), "parent_shape");
  requireValue(p.windowsFileName === `mycellios-node-${p.version}-windows-x64.msi` && SHA.test(String(p.windowsSha256)), "windows_binding");
  requireValue(a.fileName === `mycellios-node-${p.version}-macos-arm64.pkg` && Number.isSafeInteger(a.bytes) && Number(a.bytes) > 0 && Number(a.bytes) <= MAX_PKG_BYTES && typeof a.sha256 === "string" && SHA.test(a.sha256), "artifact_shape");
  requireValue(typeof b.sourceId === "string" && SOURCE.test(b.sourceId) && b.baseSourceId === p.sourceId && typeof b.recipeGitRevision === "string" && REVISION.test(b.recipeGitRevision), "source_binding");
  for (const key of ["baseArchiveSha256", "patchSha256", "sourceEvidenceSha256", "releaseEvidenceSha256", "validationReceiptSha256"]) requireValue(typeof b[key] === "string" && SHA.test(b[key]), "build_hash");
  requireValue(typeof b.workflowRunId === "string" && /^[1-9]\d{0,19}$/.test(b.workflowRunId) && Number.isSafeInteger(b.workflowRunAttempt) && Number(b.workflowRunAttempt) > 0 && b.signature === "unsigned", "build_shape");
  return candidate as unknown as Manifest;
}

function matchesParent(manifest: Manifest, parent: MacSupplementParent): boolean {
  const p = manifest.parent;
  return p.releaseId === parent.releaseId && p.sourceId === parent.sourceId && p.revision === parent.revision && p.version === parent.version
    && parent.assets.some((asset) => asset.channel === "downloads" && asset.fileName === p.windowsFileName && asset.fileSha256 === p.windowsSha256)
    && parent.assets.some((asset) => asset.channel === "downloads" && asset.fileName === `mycellios-node-${p.version}-source.zip` && asset.fileSha256 === manifest.build.baseArchiveSha256);
}

/** Pure evidence checks shared with the offline operator publisher; grants no public upload authority. */
export function verifyMacSupplementEvidence(manifest: Manifest, sourceValue: unknown, releaseValue: unknown, validationValue: unknown): void {
  const source = record(sourceValue), release = record(releaseValue), validation = record(validationValue);
  exact(source, ["schema", "version", "files", "sourceId"]);
  requireValue(source.schema === "mycellios-native-build-provenance/1" && source.sourceId === manifest.build.sourceId && source.version === manifest.parent.version && Array.isArray(source.files) && source.files.length > 0 && source.files.length <= 2000, "source_evidence");
  let previous = "";
  for (const entry of source.files) {
    const file = record(entry);
    exact(file, ["path", "bytes", "sha256"]);
    requireValue(typeof file.path === "string" && file.path.length <= 240 && file.path > previous && !file.path.includes("\\") && !file.path.startsWith("/") && !file.path.includes(":") && file.path.split("/").every((part) => part !== "" && part !== "." && part !== ".."), "source_path");
    requireValue(Number.isSafeInteger(file.bytes) && Number(file.bytes) >= 0 && typeof file.sha256 === "string" && SHA.test(file.sha256), "source_file");
    previous = file.path;
  }
  const document = { schema: source.schema, version: source.version, files: source.files };
  requireValue(`sha256:${digest(Buffer.from(canonical(document)))}` === source.sourceId, "source_identity");
  requireValue(release.schema === "mycellios-node-release-evidence/1", "release_evidence");
  const a = record(release.artifact), s = record(release.source), builder = record(release.builder);
  requireValue(a.name === manifest.artifact.fileName && a.format === "pkg" && a.target === "macos-arm64" && a.bytes === manifest.artifact.bytes && a.sha256 === manifest.artifact.sha256 && s.sourceId === manifest.build.sourceId && s.version === manifest.parent.version, "release_binding");
  requireValue(builder.runId === manifest.build.workflowRunId && String(builder.runAttempt) === String(manifest.build.workflowRunAttempt), "builder_binding");
  requireValue(validation.schema === "mycellios-macos-supplement-validation/1" && validation.sourceId === manifest.build.sourceId && validation.artifactSha256 === manifest.artifact.sha256 && validation.workflowRunId === manifest.build.workflowRunId && validation.recipeGitRevision === manifest.build.recipeGitRevision, "validation_binding");
  requireValue(validation.verified === true, "validation_incomplete");
}

/** Owned supplemental metadata uses one exact encoding; ambiguity is rejected, never normalized at read time. */
export function parseStrictJson(text: string): unknown {
  requireValue(Buffer.byteLength(text, "utf8") <= 262144, "json_size");
  const parsed: unknown = JSON.parse(text);
  requireValue(JSON.stringify(parsed, null, 2) + "\n" === text, "json_encoding");
  return parsed;
}

function requireValue(value: unknown, reason: string): asserts value { if (!value) throw new Error(`mac_supplement_${reason}`); }
function record(value: unknown): Record<string, unknown> { requireValue(typeof value === "object" && value !== null && !Array.isArray(value), "object"); return value as Record<string, unknown>; }
function exact(value: Record<string, unknown>, keys: string[]): void { requireValue(Object.keys(value).sort().join("\n") === keys.sort().join("\n"), "keys"); }
function digest(value: Buffer): string { return createHash("sha256").update(value).digest("hex"); }
function identity(value: BigIntStats): string { return [value.dev, value.ino, value.size, value.mtimeNs, value.ctimeNs, value.nlink, value.mode, value.uid].join(":"); }
function canonical(value: unknown): string { return Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value !== null && typeof value === "object" ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}` : JSON.stringify(value); }
