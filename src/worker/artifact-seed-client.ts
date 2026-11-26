import { createHash, randomUUID } from "node:crypto";
import { open, link, lstat, mkdir, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { Duplex } from "node:stream";
import {
  ARTIFACT_SEED_REQUEST_SCHEMA,
  artifactSeedGrantSchema,
  artifactSeedResponseSchema,
} from "../contracts/artifact-seed.js";
import { artifactSeedBlobPath } from "./artifact-seed-store.js";
import { encodeSeedHeader, readSeedHeader, toBuffer, writeWithBackpressure } from "./artifact-seed-wire.js";

export interface ArtifactSeedFetchOptions {
  /** Grant delivered to this requester over its authenticated coordinator session. */
  grant: unknown;
  requesterNodeId: string;
  /** This node's native stage store, `<cachePath>/stage-cas`. */
  casRoot: string;
  now?: () => number;
  headerTimeoutMs?: number;
}

export interface ArtifactSeedFetchResult {
  path: string;
  sizeBytes: number;
  /** False when an identical verified blob was already published locally. */
  published: boolean;
}

/**
 * Fetch one planned blob from a seed and publish it into the local stage
 * store only after an exact size and SHA-256 match. Nothing from the seed is
 * trusted: a short, long or altered stream is discarded.
 */
export async function fetchArtifactSeedBlob(stream: Duplex, options: ArtifactSeedFetchOptions): Promise<ArtifactSeedFetchResult> {
  let grant;
  try {
    grant = artifactSeedGrantSchema.parse(options.grant);
    if (grant.requesterNodeId !== options.requesterNodeId) throw new Error("artifact_seed_grant_wrong_requester");
    if (grant.expiresAtMs <= (options.now ?? Date.now)()) throw new Error("artifact_seed_grant_expired");
  } catch (error) {
    stream.destroy();
    throw error;
  }
  const casRoot = resolve(options.casRoot);
  const final = artifactSeedBlobPath(casRoot, grant.blobSha256);
  // Kept apart from the Python cache's resumable `.part` files and their state.
  const temporary = join(casRoot, "partials", "artifact-seed", `${grant.blobSha256}.${randomUUID()}.tmp`);
  try {
    await writeWithBackpressure(stream, encodeSeedHeader({
      schema: ARTIFACT_SEED_REQUEST_SCHEMA, transferId: grant.transferId, requesterNodeId: grant.requesterNodeId,
      blobSha256: grant.blobSha256, token: grant.token,
    }));
    const response = await readSeedHeader(stream, options.headerTimeoutMs ?? 30_000);
    const parsed = artifactSeedResponseSchema.safeParse(response.header);
    if (!parsed.success) throw new Error("artifact_seed_response_invalid");
    if (!parsed.data.ok) throw new Error(parsed.data.code);
    if (parsed.data.blobSha256 !== grant.blobSha256 || parsed.data.sizeBytes !== grant.sizeBytes) {
      throw new Error("artifact_seed_response_mismatch");
    }
    await mkdir(dirname(temporary), { recursive: true });
    const digest = createHash("sha256");
    let received = 0;
    const handle = await open(temporary, "wx");
    try {
      const accept = async (chunk: Buffer) => {
        if (chunk.byteLength === 0) return;
        received += chunk.byteLength;
        if (received > grant.sizeBytes) throw new Error("artifact_seed_oversize");
        digest.update(chunk);
        await handle.write(chunk);
      };
      await accept(response.leftover);
      // Read exactly the granted size; the requester, not the seed, closes.
      while (received < grant.sizeBytes) {
        const next = await response.chunks.next();
        if (next.done) break;
        await accept(toBuffer(next.value));
      }
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (received !== grant.sizeBytes) throw new Error("artifact_seed_truncated");
    if (digest.digest("hex") !== grant.blobSha256) throw new Error("artifact_seed_digest_mismatch");
    stream.end();
    await mkdir(dirname(final), { recursive: true });
    // A hard link publishes atomically and never replaces an existing blob.
    const published = await link(temporary, final).then(() => true, async (error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") {
        // Volumes without hard links: publish by rename unless a blob appeared.
        if (!["EPERM", "ENOTSUP", "ENOSYS", "EXDEV"].includes(error.code ?? "")) throw error;
        if (!await lstat(final).then(() => true, () => false)) {
          await rename(temporary, final);
          return true;
        }
      }
      const existing = await lstat(final);
      if (!existing.isFile() || existing.size !== grant.sizeBytes) throw new Error("artifact_seed_existing_blob_invalid");
      return false;
    });
    return { path: final, sizeBytes: grant.sizeBytes, published };
  } catch (error) {
    stream.destroy();
    throw error;
  } finally {
    await rm(temporary, { force: true });
  }
}
