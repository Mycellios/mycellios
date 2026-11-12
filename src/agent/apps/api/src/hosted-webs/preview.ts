import { randomBytes } from "node:crypto";
import type { Actor, HostedWebBundle } from "@rakazo/contracts";
import { admitStaticBundle } from "./bundle.js";

// Short-lived read capabilities, never account/session tokens. Memory stays bounded.
const previews = new Map<
  string,
  {
    actor: Actor;
    id: string;
    version: number;
    bundle: HostedWebBundle;
    bytes: number;
    expires: number;
  }
>();
export function createWebPreview(
  actor: Actor,
  id: string,
  version: number,
  bundle: HostedWebBundle,
) {
  const { bytes } = admitStaticBundle(bundle);
  const now = Date.now();
  for (const [key, row] of previews) if (row.expires <= now) previews.delete(key);
  let total = [...previews.values()].reduce((sum, row) => sum + row.bytes, 0);
  while (previews.size && (total + bytes > 16 * 1024 * 1024 || previews.size >= 32)) {
    const key = previews.keys().next().value!;
    total -= previews.get(key)!.bytes;
    previews.delete(key);
  }
  const token = randomBytes(32).toString("hex"),
    expires = now + 120_000;
  previews.set(token, { actor: { ...actor }, id, version, bundle, bytes, expires });
  return {
    path: `/api/web-preview/${token}/index.html`,
    expiresAt: new Date(expires).toISOString(),
  };
}
export function readWebPreview(token: string) {
  const row = previews.get(token);
  if (!row || row.expires <= Date.now()) {
    previews.delete(token);
    return null;
  }
  return row;
}
