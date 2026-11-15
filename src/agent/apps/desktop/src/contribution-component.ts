import {createHash, randomUUID} from "node:crypto";
import {createReadStream, createWriteStream} from "node:fs";
import {lstat, mkdir, rename, rm} from "node:fs/promises";
import path from "node:path";
import {Readable, Transform} from "node:stream";
import {pipeline} from "node:stream/promises";
import type {ReadableStream} from "node:stream/web";
import {fetchDesktopArtifact} from "./published-desktop-release.js";

type Component = {schema: string; file: string; sha256: string; bytes: number; url: string};
/** Called only by enrollment after the existing owner/expiry/platform admission. */
export async function contributionComponent(value: unknown, expectedFile: string, cache: string, fetcher: typeof fetch = fetch): Promise<string> {
  const c = value as Component | null;
  if (c?.schema !== "mycellios-desktop-runtime/2" || c.file !== expectedFile ||
      !/^mycellios-runtime\.(pkg|msi|deb)$/.test(c.file) || !/^[a-f0-9]{64}$/.test(c.sha256) ||
      !Number.isSafeInteger(c.bytes) || c.bytes < 1 || c.bytes > 2_000_000_000 ||
      c.url !== `https://github.com/Mycellios/mycellios/releases/download/desktop-runtime-${c.sha256}/${c.file}`)
    throw Error("Invalid contribution component");
  const directory = path.join(cache, c.sha256);
  await mkdir(directory, {recursive: true, mode: 0o700});
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw Error("Invalid contribution cache");
  const destination = path.join(directory, c.file);
  const valid = async () => {
    try {
      const info = await lstat(destination);
      if (!info.isFile() || info.isSymbolicLink() || info.size !== c.bytes) return false;
      const hash = createHash("sha256");
      for await (const block of createReadStream(destination)) hash.update(block);
      return hash.digest("hex") === c.sha256;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  };
  if (await valid()) return destination;
  const partial = path.join(directory, `${randomUUID()}.partial`);
  try {
    const response = await fetchDesktopArtifact(fetcher, c.url, AbortSignal.timeout(15 * 60_000), c.sha256);
    if (!response.ok || !response.body) throw Error("Contribution component unavailable");
    let bytes = 0;
    const hash = createHash("sha256");
    const verify = new Transform({transform(block: Buffer, _encoding, done) {
      bytes += block.length;
      if (bytes > c.bytes) return done(Error("Contribution component exceeds pinned size"));
      hash.update(block); done(null, block);
    }});
    await pipeline(Readable.fromWeb(response.body as ReadableStream<Uint8Array>), verify,
      createWriteStream(partial, {flags: "wx", mode: 0o600}));
    if (bytes !== c.bytes || hash.digest("hex") !== c.sha256) throw Error("Contribution component checksum differs");
    await rename(partial, destination);
    return destination;
  } finally { await rm(partial, {force: true}); }
}
