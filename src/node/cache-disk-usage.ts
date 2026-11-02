import { lstat, opendir } from "node:fs/promises";
import { resolve } from "node:path";

/** Count file payloads once per physical identity within this cache traversal.
 * This is a quota observation, not a claim about allocated disk clusters.
 * Unknown file identities are counted separately rather than guessed equal.
 */
export async function measureCacheDiskBytes(root: string): Promise<number> {
  const seen = new Map<string, bigint>();
  const visit = async (path: string): Promise<bigint> => {
    let directory;
    try { directory = await opendir(path); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0n;
      throw error;
    }
    let total = 0n;
    for await (const entry of directory) {
      if (entry.isSymbolicLink()) continue;
      const child = resolve(path, entry.name);
      if (entry.isDirectory()) { total += await visit(child); continue; }
      if (!entry.isFile()) continue;
      const info = await lstat(child, { bigint: true });
      if (!info.isFile()) continue;
      let bytes = info.size;
      if (info.nlink > 1n && info.dev >= 0n && info.ino > 0n) {
        const key = `${info.dev}:${info.ino}`;
        const previous = seen.get(key) ?? 0n;
        // If a file grows during observation, retain the largest observed size.
        seen.set(key, bytes > previous ? bytes : previous);
        bytes = bytes > previous ? bytes - previous : 0n;
      }
      total += bytes;
    }
    return total;
  };
  const bytes = await visit(resolve(root));
  if (bytes < 0n || bytes > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("cache_disk_size_exceeds_safe_observation_range");
  }
  return Number(bytes);
}