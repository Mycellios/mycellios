import { createHash } from "node:crypto";
import { open, stat } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import type { ManualRelease } from "./manual-update.js";
import { fetchDesktopArtifact } from "./published-desktop-release.js";

/**
 * Differential installer downloads, the way Electron apps commonly ship updates: the release
 * publishes a block map (content-defined chunks with their checksums) beside each installer.
 * Blocks the new installer shares with the installer already on disk are copied locally; only
 * the rest is fetched with HTTP ranges. The assembled file must still match the release's
 * size and SHA-256 exactly, so a wrong or tampered map can only cost a full download.
 */
const MAX_BLOCKMAP_BYTES = 8 * 1024 * 1024;
const MAX_BLOCKMAP_JSON_BYTES = 64 * 1024 * 1024;
const MAX_BLOCKS = 500_000;
/** Copy runs shorter than this between two downloads are fetched too, to save requests. */
const RANGE_GAP_BYTES = 256 * 1024;
const MAX_RANGES = 400;
/** Not worth it when most of the installer changed: a single full download is simpler. */
const MAX_DOWNLOAD_SHARE = 0.8;
const COPY_CHUNK_BYTES = 1024 * 1024;

export type Blockmap = { offset: number; checksums: string[]; sizes: number[]; total: number };
export type Piece = { kind: "copy" | "download"; from: number; size: number };

export function parseBlockmap(compressed: Buffer): Blockmap {
  if (compressed.byteLength > MAX_BLOCKMAP_BYTES) throw Error("Block map too large");
  const value = JSON.parse(gunzipSync(compressed, { maxOutputLength: MAX_BLOCKMAP_JSON_BYTES }).toString("utf8")) as {
    version?: unknown; files?: Array<{ offset?: unknown; checksums?: unknown; sizes?: unknown }>;
  };
  const file = Array.isArray(value?.files) && value.files.length === 1 ? value.files[0] : undefined;
  const { offset, checksums, sizes } = file ?? {};
  if (value?.version !== "2" || !Number.isSafeInteger(offset) || (offset as number) < 0 ||
      !Array.isArray(checksums) || !Array.isArray(sizes) || checksums.length !== sizes.length ||
      checksums.length === 0 || checksums.length > MAX_BLOCKS ||
      checksums.some(c => typeof c !== "string" || c.length === 0 || c.length > 128) ||
      sizes.some(s => !Number.isSafeInteger(s) || (s as number) <= 0))
    throw Error("Invalid block map");
  const total = (sizes as number[]).reduce((sum, size) => sum + size, offset as number);
  if (!Number.isSafeInteger(total)) throw Error("Invalid block map");
  return { offset: offset as number, checksums: checksums as string[], sizes: sizes as number[], total };
}

/** Copy every block the old installer already has; download the rest, in file order. */
export function differentialPlan(previous: Blockmap, next: Blockmap): Piece[] {
  const known = new Map<string, number>();
  let at = previous.offset;
  previous.checksums.forEach((checksum, i) => {
    const key = `${checksum}:${previous.sizes[i]}`;
    if (!known.has(key)) known.set(key, at);
    at += previous.sizes[i]!;
  });
  const pieces: Piece[] = [];
  const push = (piece: Piece) => {
    const last = pieces.at(-1);
    if (last && last.kind === piece.kind && (piece.kind === "download" || last.from + last.size === piece.from)) last.size += piece.size;
    else pieces.push(piece);
  };
  if (next.offset > 0) push({ kind: "download", from: 0, size: next.offset });
  at = next.offset;
  next.checksums.forEach((checksum, i) => {
    const size = next.sizes[i]!;
    const from = known.get(`${checksum}:${size}`);
    push(from === undefined ? { kind: "download", from: at, size } : { kind: "copy", from, size });
    at += size;
  });
  // Fold short copies between two downloads into one range request. `from` of a download is
  // its offset in the new file, which is contiguous across the folded pieces.
  const folded: Piece[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i]!;
    const last = folded.at(-1), following = pieces[i + 1];
    if (piece.kind === "copy" && piece.size < RANGE_GAP_BYTES && last?.kind === "download" && following?.kind === "download") {
      last.size += piece.size + following.size;
      i++;
    } else if (piece.kind === "download" && last?.kind === "download") last.size += piece.size;
    else folded.push({ ...piece });
  }
  return folded;
}

async function boundedBody(response: Response): Promise<Buffer> {
  if (!response.ok || !response.body) throw Error("Block map unavailable");
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_BLOCKMAP_BYTES) throw Error("Block map too large");
      chunks.push(chunk.value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  return Buffer.concat(chunks);
}

/**
 * Assemble `release` into `temporary` from `previousFile` plus HTTP ranges of `release.url`.
 * Throws (leaving cleanup to the caller) whenever the result cannot be proven identical.
 */
export async function downloadDifferential(options: {
  fetch: typeof fetch; release: ManualRelease; previousFile: string; previousBlockmapUrl: string;
  temporary: string; signal: AbortSignal; progress(written: number): void;
}): Promise<void> {
  const { release, signal } = options;
  const [previous, next] = await Promise.all([options.previousBlockmapUrl, release.url + ".blockmap"].map(async url =>
    parseBlockmap(await boundedBody(await fetchDesktopArtifact(options.fetch, url, signal)))));
  if (next!.total !== release.bytes) throw Error("Block map does not describe this release");
  if ((await stat(options.previousFile)).size !== previous!.total) throw Error("Local installer does not match its block map");
  const plan = differentialPlan(previous!, next!);
  const downloads = plan.filter(piece => piece.kind === "download");
  const downloadBytes = downloads.reduce((sum, piece) => sum + piece.size, 0);
  if (downloads.length > MAX_RANGES || downloadBytes > release.bytes * MAX_DOWNLOAD_SHARE) throw Error("Differential download not worthwhile");

  const hash = createHash("sha256");
  const source = await open(options.previousFile, "r");
  const output = await open(options.temporary, "wx", 0o600);
  let written = 0, position = 0;
  const write = async (chunk: Uint8Array) => {
    if (written + chunk.byteLength > release.bytes) throw Error("Installer exceeds catalog size");
    await output.write(chunk);
    hash.update(chunk);
    written += chunk.byteLength;
    options.progress(written);
  };
  try {
    for (const piece of plan) {
      signal.throwIfAborted();
      if (piece.kind === "copy") {
        for (let done = 0; done < piece.size;) {
          const length = Math.min(COPY_CHUNK_BYTES, piece.size - done);
          const { bytesRead, buffer } = await source.read(Buffer.alloc(length), 0, length, piece.from + done);
          if (bytesRead !== length) throw Error("Local installer changed during the update");
          await write(buffer);
          done += length;
        }
      } else {
        const end = piece.from + piece.size - 1;
        if (piece.from !== position) throw Error("Invalid differential plan");
        const response = await fetchDesktopArtifact(options.fetch, release.url, signal, undefined, `bytes=${piece.from}-${end}`);
        if (response.status !== 206 || response.headers.get("content-range") !== `bytes ${piece.from}-${end}/${release.bytes}` || !response.body)
          throw Error("Range download unavailable");
        let received = 0;
        const reader = response.body.getReader();
        try {
          for (;;) {
            const chunk = await reader.read();
            if (chunk.done) break;
            received += chunk.value.byteLength;
            if (received > piece.size) throw Error("Range download too long");
            await write(chunk.value);
          }
        } finally { await reader.cancel().catch(() => undefined); }
        if (received !== piece.size) throw Error("Range download incomplete");
      }
      position += piece.size;
    }
  } finally {
    await source.close();
    await output.close();
  }
  if (written !== release.bytes || hash.digest("hex") !== release.sha256) throw Error("Installer differs from catalog");
}
