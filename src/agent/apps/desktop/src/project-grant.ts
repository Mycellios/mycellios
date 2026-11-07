import { createHmac } from "node:crypto";

/** A native folder grant stays fixed while its cloud binding is live. */
export function assertProjectGrant(existing: { path: string } | null, requested: string) {
  if (existing && existing.path !== requested)
    throw new Error("Revoke local computer access from the File menu before choosing another project for this agent.");
}
/** Stable project metadata ID, without sending the native folder path to the server. */
export function attachedRepositoryId(secret: string, scope: string, botId: string, folder: string) {
  const bytes = createHmac("sha256", secret).update(JSON.stringify([scope, botId, folder])).digest();
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  return [bytes.toString("hex", 0, 4), bytes.toString("hex", 4, 6), bytes.toString("hex", 6, 8),
    bytes.toString("hex", 8, 10), bytes.toString("hex", 10, 16)].join("-");
}
