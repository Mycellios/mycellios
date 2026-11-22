import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, statfs, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  MEMORY_EMBEDDING_DIGEST, MEMORY_EMBEDDING_FILE_BYTES, MEMORY_EMBEDDING_FILES, MEMORY_EMBEDDING_SOURCE_BASE_URL,
} from "../contracts/memory-embedding.js";

/**
 * Hash-pinned files of the operator memory embedding model on a paired node
 * (specs/memory-embedding-qwen06/spec.md, "Automatic node replicas").
 *
 * - Only the pinned files are fetched, from the pinned revision, over HTTPS.
 * - A file is installed only after its exact size and sha256 match; partial
 *   downloads resume and are discarded on any mismatch.
 * - The files live under the node cache, so the owner's disk limit measures
 *   them. Nothing is downloaded unless the cache plus the missing bytes stays
 *   below that limit with a margin, and the disk keeps free space; on
 *   2026-11-21 model files placed under the cache without such a check
 *   tripped a node's disk limit.
 * - Other artifact identities in the same folder are evicted.
 * - The runtime re-hashes every file before it serves (`verify_artifact`).
 */
export const MEMORY_EMBEDDING_ARTIFACT_BYTES = Object.values(MEMORY_EMBEDDING_FILE_BYTES).reduce((sum, bytes) => sum + bytes, 0);
const DISK_LIMIT_MARGIN_BYTES = 256 * 1024 * 1024;
const FREE_SPACE_RESERVE_BYTES = 1024 * 1024 * 1024;
const MARKER = "verified.json";

export interface ArtifactBudget {
  /** The owner's current disk limit for the node cache, in bytes. */
  maxCacheBytes(): Promise<number>;
  /** Current measured size of the whole node cache. */
  cacheBytes(): Promise<number>;
}

export class MemoryEmbeddingArtifactError extends Error {}

export interface PinnedFile { bytes: number; sha256: string }
export const MEMORY_EMBEDDING_PINNED_FILES: Readonly<Record<string, PinnedFile>> = Object.freeze(Object.fromEntries(
  Object.keys(MEMORY_EMBEDDING_FILES).map((name) => [name, { bytes: MEMORY_EMBEDDING_FILE_BYTES[name]!, sha256: MEMORY_EMBEDDING_FILES[name]! }])));

export class MemoryEmbeddingArtifactStore {
  readonly directory: string;
  readonly modelPath: string;
  private readonly files: Readonly<Record<string, PinnedFile>>;
  private readonly fetchImpl: typeof fetch;
  private readonly freeBytes: (path: string) => Promise<number>;
  constructor(private readonly root: string, options: {
    fetch?: typeof fetch; freeBytes?: (path: string) => Promise<number>;
    /** Tests only: the production store always uses the pinned files. */
    files?: Readonly<Record<string, PinnedFile>>;
  } = {}) {
    this.files = options.files ?? MEMORY_EMBEDDING_PINNED_FILES;
    this.fetchImpl = options.fetch ?? fetch;
    this.freeBytes = options.freeBytes ?? (async (path) => {
      const fs = await statfs(path);
      return Number(fs.bavail) * Number(fs.bsize);
    });
    this.directory = join(root, MEMORY_EMBEDDING_DIGEST.slice("sha256:".length));
    this.modelPath = join(this.directory, "model");
  }

  /** True when the marker and every file size match; the runtime still re-hashes before it serves. */
  async installed(): Promise<boolean> {
    try {
      const marker = JSON.parse(await readFile(join(this.directory, MARKER), "utf8")) as { digest?: string };
      if (marker.digest !== MEMORY_EMBEDDING_DIGEST) return false;
      for (const [name, file] of Object.entries(this.files)) {
        if ((await stat(join(this.modelPath, name))).size !== file.bytes) return false;
      }
      return true;
    } catch { return false; }
  }

  /** Bytes still to download, counting resumable partial files. */
  async missingBytes(): Promise<number> {
    let missing = 0;
    for (const [name, { bytes }] of Object.entries(this.files)) {
      const done = await stat(join(this.modelPath, name)).then((s) => s.size === bytes).catch(() => false);
      if (done) continue;
      const partial = await stat(join(this.modelPath, `${name}.part`)).then((s) => s.size).catch(() => 0);
      missing += Math.max(0, bytes - Math.min(partial, bytes));
    }
    return missing;
  }

  async ensure(budget: ArtifactBudget, signal: AbortSignal): Promise<string> {
    await this.evictOtherIdentities();
    if (await this.installed()) return this.modelPath;
    await mkdir(this.modelPath, { recursive: true });
    const missing = await this.missingBytes();
    const cacheBytes = await budget.cacheBytes();
    if (cacheBytes + missing > (await budget.maxCacheBytes()) - DISK_LIMIT_MARGIN_BYTES) {
      throw new MemoryEmbeddingArtifactError("memory_embedding_artifact_exceeds_disk_limit");
    }
    if ((await this.freeBytes(this.root)) < missing + FREE_SPACE_RESERVE_BYTES) {
      throw new MemoryEmbeddingArtifactError("memory_embedding_artifact_insufficient_free_space");
    }
    for (const name of Object.keys(this.files).sort()) {
      signal.throwIfAborted();
      await this.ensureFile(name, signal);
    }
    await writeFile(join(this.directory, MARKER), JSON.stringify({ digest: MEMORY_EMBEDDING_DIGEST, files: this.files }));
    return this.modelPath;
  }

  /** Removes everything, for example after the owner disables the replica for good. */
  async remove(): Promise<void> {
    await rm(this.directory, { recursive: true, force: true });
  }

  private async evictOtherIdentities(): Promise<void> {
    const entries = await readdir(this.root, { withFileTypes: true }).catch(() => []);
    const own = MEMORY_EMBEDDING_DIGEST.slice("sha256:".length);
    for (const entry of entries) {
      if (entry.isDirectory() && /^[a-f0-9]{64}$/.test(entry.name) && entry.name !== own) {
        await rm(join(this.root, entry.name), { recursive: true, force: true });
      }
    }
  }

  private async ensureFile(name: string, signal: AbortSignal): Promise<void> {
    const expectedBytes = this.files[name]!.bytes;
    const expectedSha = this.files[name]!.sha256;
    const target = join(this.modelPath, name);
    if (await stat(target).then((s) => s.size === expectedBytes).catch(() => false)) {
      if (await sha256File(target) === expectedSha) return;
      await rm(target, { force: true });
    }
    const partial = `${target}.part`;
    let offset = await stat(partial).then((s) => s.size).catch(() => 0);
    if (offset > expectedBytes) { await rm(partial, { force: true }); offset = 0; }
    if (offset < expectedBytes) {
      const url = `${MEMORY_EMBEDDING_SOURCE_BASE_URL}/${name}`;
      const response = await this.fetchImpl(url, {
        headers: { "user-agent": "Mycellios-Node-MemoryEmbedding/1", ...(offset > 0 ? { range: `bytes=${offset}-` } : {}) },
        redirect: "follow", signal,
      });
      // Redirects (the Hugging Face CDN) must stay on HTTPS.
      if (response.url && !response.url.startsWith("https://")) throw new MemoryEmbeddingArtifactError("memory_embedding_artifact_insecure_redirect");
      if (offset > 0 && response.status === 200) { await rm(partial, { force: true }); offset = 0; }
      else if (!(response.status === 200 || (offset > 0 && response.status === 206))) {
        await response.body?.cancel();
        throw new MemoryEmbeddingArtifactError(`memory_embedding_artifact_http_${response.status}`);
      }
      if (!response.body) throw new MemoryEmbeddingArtifactError("memory_embedding_artifact_empty_body");
      let written = offset;
      const bounded = Readable.fromWeb(response.body as never).map((chunk: Buffer) => {
        written += chunk.length;
        if (written > expectedBytes) throw new MemoryEmbeddingArtifactError("memory_embedding_artifact_too_large");
        return chunk;
      });
      await pipeline(bounded, createWriteStream(partial, { flags: offset > 0 ? "a" : "w" }), { signal });
    }
    const size = (await stat(partial)).size;
    const sha = await sha256File(partial);
    if (size !== expectedBytes || sha !== expectedSha) {
      await rm(partial, { force: true });
      throw new MemoryEmbeddingArtifactError(`memory_embedding_artifact_mismatch:${name}`);
    }
    await rename(partial, target);
  }
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path, { highWaterMark: 1 << 20 })) hash.update(chunk as Buffer);
  return hash.digest("hex");
}
