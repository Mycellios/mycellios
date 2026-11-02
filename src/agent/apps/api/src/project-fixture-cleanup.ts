import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/** Resolve and validate the exact disposable root before any recursive cleanup. */
export async function removeProjectFixture(root: string, prefix: string) {
  const resolved = path.resolve(root);
  if (
    path.dirname(resolved) !== path.resolve(tmpdir()) ||
    !path.basename(resolved).startsWith(prefix)
  )
    throw new Error("Unsafe fixture cleanup");
  await rm(resolved, { recursive: true, force: true });
}
