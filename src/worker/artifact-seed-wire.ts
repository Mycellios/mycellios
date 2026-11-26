import { once } from "node:events";
import type { Duplex } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { ARTIFACT_SEED_MAX_HEADER_BYTES } from "../contracts/artifact-seed.js";

export interface SeedHeaderRead {
  header: unknown;
  /** Bytes received after the header line, in order. */
  leftover: Buffer;
  chunks: AsyncIterator<unknown>;
}

/** Read exactly one bounded JSON header line; never buffers a payload. */
export async function readSeedHeader(stream: Duplex, timeoutMs: number): Promise<SeedHeaderRead> {
  const chunks = (stream as AsyncIterable<unknown>)[Symbol.asyncIterator]();
  const timer = setTimeout(() => stream.destroy(new Error("artifact_seed_header_timeout")), timeoutMs);
  timer.unref?.();
  let buffered = Buffer.alloc(0);
  try {
    for (;;) {
      const next = await chunks.next().catch(() => { throw new Error("artifact_seed_header_timeout"); });
      if (next.done) throw new Error("artifact_seed_header_truncated");
      buffered = Buffer.concat([buffered, toBuffer(next.value)]);
      const end = buffered.indexOf(0x0a);
      if (end < 0) {
        if (buffered.byteLength >= ARTIFACT_SEED_MAX_HEADER_BYTES) throw new Error("artifact_seed_header_too_large");
        continue;
      }
      if (end + 1 > ARTIFACT_SEED_MAX_HEADER_BYTES) throw new Error("artifact_seed_header_too_large");
      let header: unknown;
      try { header = JSON.parse(buffered.subarray(0, end).toString("utf8")); } catch { throw new Error("artifact_seed_header_invalid"); }
      return { header, leftover: buffered.subarray(end + 1), chunks };
    }
  } finally {
    clearTimeout(timer);
  }
}

export function encodeSeedHeader(value: unknown): Buffer {
  const line = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
  if (line.byteLength > ARTIFACT_SEED_MAX_HEADER_BYTES) throw new Error("artifact_seed_header_too_large");
  return line;
}

export async function writeWithBackpressure(stream: Duplex, chunk: Buffer): Promise<void> {
  if (stream.destroyed || stream.writableEnded) throw new Error("artifact_seed_stream_closed");
  if (!stream.write(chunk)) {
    await Promise.race([
      once(stream, "drain"),
      once(stream, "close").then(() => { throw new Error("artifact_seed_stream_closed"); }),
    ]);
  }
}

/** Monotonic pacing: never exceeds the owner's byte rate on average. */
export async function paceTransfer(startedAtMs: number, bytesSent: number, bytesPerSecond: number): Promise<void> {
  const wait = startedAtMs + bytesSent / bytesPerSecond * 1_000 - performance.now();
  if (wait > 1) await delay(Math.min(wait, 1_000));
}

export function toBuffer(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (typeof value === "string") return Buffer.from(value, "utf8");
  throw new Error("artifact_seed_stream_invalid");
}
