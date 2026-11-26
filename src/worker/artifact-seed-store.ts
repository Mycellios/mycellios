import { createHash, randomUUID } from "node:crypto";
import { createReadStream, type ReadStream } from "node:fs";
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { setImmediate as yieldToEventLoop, setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import {
  ARTIFACT_SEED_MAX_BLOBS,
  ARTIFACT_SEED_OBSERVATION_SCHEMA,
  artifactSeedInventoryRevision,
  artifactSeedObservationSchema,
  type ArtifactSeedObservation,
} from "../contracts/artifact-seed.js";

const DIGEST = /^[a-f0-9]{64}$/;
const PREFIX = /^[a-f0-9]{2}$/;
const READ_CHUNK_BYTES = 256 * 1024;
/** Digests ride on heartbeats; keep a full observation small (about 17 KB). */
export const ARTIFACT_SEED_MAX_ADVERTISED_BLOBS = 256;
const INDEX_SCHEMA = "mycellios-artifact-seed-index/1";
const indexSchema = z.object({
  schema: z.literal(INDEX_SCHEMA),
  entries: z.array(z.object({
    digest: z.string().regex(DIGEST),
    sizeBytes: z.number().int().positive().safe(),
    mtimeMs: z.number().finite(),
    ino: z.number().nonnegative().finite(),
  }).strict()).max(ARTIFACT_SEED_MAX_BLOBS),
}).strict();

export interface ArtifactSeedStoreOptions {
  /** The native stage content-addressed store, `<cachePath>/stage-cas`. */
  casRoot: string;
  quotaBytes: number;
  maxTransferSlots: number;
  /** Background verification ceiling; keeps hashing low priority on weak CPUs. */
  verifyBytesPerSecond?: number;
  /**
   * Optional persisted verification index (digests and file identities only).
   * A restart reuses an entry only while the file identity is unchanged.
   */
  indexPath?: string;
  /** Resend the full digest list at least this often; deltas otherwise. */
  fullObservationEveryMs?: number;
  now?: () => number;
}

interface VerifiedBlob {
  digest: string;
  path: string;
  sizeBytes: number;
  mtimeMs: number;
  ino: number;
}

export interface OpenedSeedBlob {
  stream: ReadStream;
  sizeBytes: number;
}

/** Location of a published object in the native stage store (stage_artifact_cache.py). */
export function artifactSeedBlobPath(casRoot: string, digest: string): string {
  if (!DIGEST.test(digest)) throw new Error("artifact_seed_digest_invalid");
  return join(resolve(casRoot), "objects", "sha256", digest.slice(0, 2), digest);
}

/** Observation for a node that can request blobs but offers none. */
export function emptyArtifactSeedObservation(now: number, servicePort?: number): ArtifactSeedObservation {
  return artifactSeedObservationSchema.parse({
    schema: ARTIFACT_SEED_OBSERVATION_SCHEMA, ready: false, inventoryRevision: artifactSeedInventoryRevision([]),
    verifiedBlobSha256s: [], freeTransferSlots: 0, quotaBytes: 0, heldBytes: 0, observedAt: now / 1_000,
    ...(servicePort === undefined ? {} : { servicePort }),
  });
}

/**
 * Node-only view of verified blobs this owner agreed to offer. It never
 * deletes, rewrites or loads anything; Python and models are not involved.
 */
export class ArtifactSeedStore {
  private readonly casRoot: string;
  private readonly now: () => number;
  private readonly verifyRate: number;
  private verified = new Map<string, VerifiedBlob>();
  private offered: VerifiedBlob[] = [];
  private activeTransfers = 0;
  private scanned = false;
  private refreshing: Promise<void> | null = null;
  private indexLoaded = false;
  private lastFull: { revision: string; at: number } | null = null;
  private servicePort: number | undefined;

  constructor(private readonly options: ArtifactSeedStoreOptions) {
    if (!Number.isSafeInteger(options.quotaBytes) || options.quotaBytes < 0) throw new Error("artifact_seed_quota_invalid");
    if (!Number.isInteger(options.maxTransferSlots) || options.maxTransferSlots < 1 || options.maxTransferSlots > 64) {
      throw new Error("artifact_seed_slots_invalid");
    }
    this.casRoot = resolve(options.casRoot);
    this.now = options.now ?? Date.now;
    this.verifyRate = options.verifyBytesPerSecond ?? 64 * 1024 * 1024;
    if (!(this.verifyRate > 0)) throw new Error("artifact_seed_verify_rate_invalid");
  }

  get root(): string {
    return this.casRoot;
  }

  /** The loopback port of this node's seed server, once it listens. */
  setServicePort(port: number | undefined): void {
    this.servicePort = port;
  }

  /** Coalesced rescan; unchanged files keep their earlier verification. */
  refresh(signal?: AbortSignal): Promise<void> {
    this.refreshing ??= this.scan(signal).finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  /**
   * Heartbeat observation. The digest list is sent when it changed or when the
   * last full list is older than the refresh period; otherwise only the revision.
   */
  observe(enabled: boolean): ArtifactSeedObservation {
    const ready = enabled && this.scanned && this.servicePort !== undefined;
    const digests = ready ? this.offered.map(blob => blob.digest) : [];
    const revision = artifactSeedInventoryRevision(digests);
    const now = this.now();
    const full = !this.lastFull || this.lastFull.revision !== revision
      || now - this.lastFull.at >= (this.options.fullObservationEveryMs ?? 60_000) || now < this.lastFull.at;
    if (full) this.lastFull = { revision, at: now };
    return artifactSeedObservationSchema.parse({
      schema: ARTIFACT_SEED_OBSERVATION_SCHEMA,
      ready,
      inventoryRevision: revision,
      ...(full ? { verifiedBlobSha256s: digests } : {}),
      freeTransferSlots: ready ? Math.max(0, this.options.maxTransferSlots - this.activeTransfers) : 0,
      quotaBytes: this.options.quotaBytes,
      heldBytes: this.offered.reduce((total, blob) => total + blob.sizeBytes, 0),
      ...(this.servicePort === undefined ? {} : { servicePort: this.servicePort }),
      observedAt: now / 1_000,
    });
  }

  offers(digest: string): boolean {
    return this.offered.some(blob => blob.digest === digest);
  }

  /** Reserve a transfer slot; the returned release is idempotent. */
  acquireSlot(): (() => void) | null {
    if (this.activeTransfers >= this.options.maxTransferSlots) return null;
    this.activeTransfers += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.activeTransfers -= 1;
    };
  }

  /**
   * Open an offered blob only if its file identity is unchanged since it was
   * hashed. A changed file is withdrawn until the next verification.
   */
  async openVerified(digest: string): Promise<OpenedSeedBlob> {
    const blob = this.offered.find(value => value.digest === digest);
    if (!blob) throw new Error("artifact_seed_blob_unavailable");
    const current = await lstat(blob.path).catch(() => null);
    if (!current?.isFile() || current.size !== blob.sizeBytes || current.mtimeMs !== blob.mtimeMs || current.ino !== blob.ino) {
      this.withdraw(digest);
      throw new Error("artifact_seed_blob_changed");
    }
    return { stream: createReadStream(blob.path, { highWaterMark: READ_CHUNK_BYTES, start: 0, end: blob.sizeBytes - 1 }),
      sizeBytes: blob.sizeBytes };
  }

  private withdraw(digest: string): void {
    this.verified.delete(digest);
    this.offered = this.offered.filter(value => value.digest !== digest);
  }

  private async loadIndex(): Promise<void> {
    if (this.indexLoaded || !this.options.indexPath) return;
    this.indexLoaded = true;
    try {
      const parsed = indexSchema.parse(JSON.parse(await readFile(this.options.indexPath, "utf8")));
      for (const entry of parsed.entries) {
        this.verified.set(entry.digest, { ...entry, path: artifactSeedBlobPath(this.casRoot, entry.digest) });
      }
    } catch {
      // A missing or invalid index only costs one verification pass.
    }
  }

  private async saveIndex(): Promise<void> {
    if (!this.options.indexPath) return;
    const target = resolve(this.options.indexPath);
    const temporary = `${target}.${randomUUID()}.tmp`;
    const document = { schema: INDEX_SCHEMA, entries: [...this.verified.values()]
      .map(({ digest, sizeBytes, mtimeMs, ino }) => ({ digest, sizeBytes, mtimeMs, ino })) };
    try {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(temporary, JSON.stringify(document));
      await rename(temporary, target);
    } catch {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  private async scan(signal?: AbortSignal): Promise<void> {
    await this.loadIndex();
    const root = join(this.casRoot, "objects", "sha256");
    const next = new Map<string, VerifiedBlob>();
    let held = 0;
    const limit = Math.min(ARTIFACT_SEED_MAX_BLOBS, ARTIFACT_SEED_MAX_ADVERTISED_BLOBS);
    for (const prefix of (await readdir(root, { withFileTypes: true }).catch(() => [])).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!prefix.isDirectory() || !PREFIX.test(prefix.name)) continue;
      const entries = await readdir(join(root, prefix.name), { withFileTypes: true }).catch(() => []);
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        signal?.throwIfAborted();
        if (!entry.isFile() || !DIGEST.test(entry.name) || entry.name.slice(0, 2) !== prefix.name) continue;
        // Digest order is scan order: stop hashing once the owner quota or cap is full.
        if (next.size >= limit) break;
        const path = join(root, prefix.name, entry.name);
        const stats = await lstat(path).catch(() => null);
        if (!stats?.isFile() || stats.size < 1 || held + stats.size > this.options.quotaBytes) continue;
        const previous = this.verified.get(entry.name);
        if (previous && previous.sizeBytes === stats.size && previous.mtimeMs === stats.mtimeMs && previous.ino === stats.ino) {
          next.set(entry.name, { ...previous, path });
          held += previous.sizeBytes;
          continue;
        }
        if (await this.hash(path, stats.size, signal) !== entry.name) continue;
        next.set(entry.name, { digest: entry.name, path, sizeBytes: stats.size, mtimeMs: stats.mtimeMs, ino: stats.ino });
        held += stats.size;
      }
    }
    this.verified = next;
    this.offered = [...next.values()].sort((a, b) => a.digest.localeCompare(b.digest));
    this.scanned = true;
    await this.saveIndex();
  }

  private async hash(path: string, sizeBytes: number, signal?: AbortSignal): Promise<string | null> {
    const digest = createHash("sha256");
    const started = performance.now();
    let read = 0;
    try {
      for await (const chunk of createReadStream(path, { highWaterMark: READ_CHUNK_BYTES })) {
        signal?.throwIfAborted();
        const bytes = chunk as Buffer;
        read += bytes.byteLength;
        if (read > sizeBytes) return null;
        digest.update(bytes);
        const wait = started + read / this.verifyRate * 1_000 - performance.now();
        if (wait > 1) await delay(Math.min(wait, 1_000), undefined, signal ? { signal } : {});
        else await yieldToEventLoop();
      }
    } catch (error) {
      if (signal?.aborted) throw error;
      return null;
    }
    return read === sizeBytes ? digest.digest("hex") : null;
  }
}
