import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { differentialPlan, downloadDifferential, parseBlockmap } from "./manual-update-differential.js";

const KB = 1024;
const block = (seed: number, size = 300 * KB) => Buffer.alloc(size, seed);
const blockmap = (blocks: Buffer[]) => gzipSync(JSON.stringify({ version: "2", files: [{ name: "file", offset: 0,
  checksums: blocks.map(b => createHash("sha512").update(b).digest("base64")), sizes: blocks.map(b => b.byteLength) }] }));
const folders: string[] = [];
afterEach(async () => { for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true }); });

const github = "https://github.com/Mycellios/mycellios/releases/download/";
const oldUrl = `${github}desktop-v0.7.0-windows-preview/Mycellios-Desktop-0.7.0-windows-x64-pilot.exe`;
const newUrl = `${github}desktop-v0.8.0-windows-preview/Mycellios-Desktop-0.8.0-windows-x64-pilot.exe`;

async function scenario(oldBlocks: Buffer[], newBlocks: Buffer[], options: { tamper?: boolean; noRanges?: boolean } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "differential-")); folders.push(directory);
  const previousFile = path.join(directory, "old.exe");
  await writeFile(previousFile, Buffer.concat(oldBlocks));
  const next = Buffer.concat(newBlocks);
  const ranges: string[] = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === oldUrl + ".blockmap") return new Response(blockmap(oldBlocks));
    if (url === newUrl + ".blockmap") return new Response(blockmap(newBlocks));
    const range = new Headers(init?.headers).get("range");
    if (url !== newUrl || !range || options.noRanges) return new Response(null, { status: 404 });
    ranges.push(range);
    const [, start, end] = /^bytes=(\d+)-(\d+)$/.exec(range)!.map(Number);
    const body = Buffer.from(next.subarray(start, end + 1));
    if (options.tamper) body[0] ^= 1;
    return new Response(body, { status: 206, headers: { "content-range": `bytes ${start}-${end}/${next.byteLength}` } });
  }) as typeof fetch;
  const release = { version: "0.8.0", url: newUrl, fileName: "Mycellios-Desktop-0.8.0-windows-x64-pilot.exe",
    bytes: next.byteLength, sha256: createHash("sha256").update(next).digest("hex") };
  const temporary = path.join(directory, "new.part");
  const run = () => downloadDifferential({ fetch: fetcher, release, previousFile, previousBlockmapUrl: oldUrl + ".blockmap",
    temporary, signal: new AbortController().signal, progress: () => {} });
  return { run, ranges, temporary, next };
}

describe("differential installer downloads", { timeout: 30_000 }, () => {
  it("copies unchanged blocks and downloads only the changed ones", async () => {
    const shared = [block(1), block(2), block(3), block(4), block(5)];
    const { run, ranges, temporary, next } = await scenario(shared, [shared[0]!, block(9), shared[2]!, shared[3]!, block(8), shared[4]!]);
    await run();
    expect(await readFile(temporary)).toEqual(next);
    const size = 300 * KB;
    expect(ranges).toEqual([`bytes=${size}-${2 * size - 1}`, `bytes=${4 * size}-${5 * size - 1}`]);
  });

  it("refuses a result that does not match the release hash", async () => {
    const shared = [block(1), block(2), block(3), block(4), block(5)];
    const { run } = await scenario(shared, [shared[0]!, block(9), shared[2]!, shared[3]!, shared[4]!], { tamper: true });
    await expect(run()).rejects.toThrow("Installer differs from catalog");
  });

  it("does not attempt it when most of the installer changed", async () => {
    const { run, ranges } = await scenario([block(1), block(2)], [block(3), block(4), block(5)]);
    await expect(run()).rejects.toThrow("not worthwhile");
    expect(ranges).toEqual([]);
  });

  it("fails when the server does not answer byte ranges", async () => {
    const shared = [block(1), block(2), block(3), block(4), block(5)];
    const { run } = await scenario(shared, [shared[0]!, block(9), shared[2]!, shared[3]!, shared[4]!], { noRanges: true });
    await expect(run()).rejects.toThrow("Range download unavailable");
  });

  it("folds short unchanged runs between changes into one request", () => {
    const map = (sizes: number[], checksums: string[]) => parseBlockmap(gzipSync(JSON.stringify({ version: "2",
      files: [{ name: "file", offset: 0, sizes, checksums }] })));
    const previous = map([10 * KB, 10 * KB, 10 * KB], ["a", "b", "c"]);
    const next = map([10 * KB, 10 * KB, 10 * KB, 10 * KB], ["a", "x", "b", "y"]);
    expect(differentialPlan(previous, next)).toEqual([
      { kind: "copy", from: 0, size: 10 * KB },
      { kind: "download", from: 10 * KB, size: 30 * KB },
    ]);
  });

  it("rejects malformed block maps", () => {
    expect(() => parseBlockmap(gzipSync(JSON.stringify({ version: "1", files: [] })))).toThrow("Invalid block map");
    expect(() => parseBlockmap(gzipSync(JSON.stringify({ version: "2", files: [{ offset: 0, checksums: ["a"], sizes: [0] }] }))))
      .toThrow("Invalid block map");
    expect(() => parseBlockmap(gzipSync(JSON.stringify({ version: "2", files: [{ offset: 0, checksums: ["a", "b"], sizes: [1] }] }))))
      .toThrow("Invalid block map");
  });
});
