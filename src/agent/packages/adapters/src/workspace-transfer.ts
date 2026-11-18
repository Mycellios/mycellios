/**
 * Rules for copying a Mico workspace between the server and a PC.
 *
 * A PC workspace belongs to that PC: the server copy is only seeded into a new
 * PC workspace and refreshed from it. Like an explicit instance transfer, the
 * copy leaves out repository internals, dependency trees, secrets and nested
 * archives, and moves large files in verified pieces instead of one request.
 */
import { createHash } from "node:crypto";

/** Bytes of file content carried by one transfer piece (before base64). */
export const WORKSPACE_TRANSFER_CHUNK_BYTES = 8 * 1024 * 1024;

const ARCHIVE = /\.(?:zip|tar|tgz|gz|7z|rar)$/iu;
const PRIVATE_KEY = /private.*key/iu;

/** True when a relative workspace path is never copied between machines. */
export function isWorkspaceTransferExcluded(relativePath: string): boolean {
  const parts = relativePath.replaceAll("\\", "/").split("/").filter(Boolean);
  const file = parts.at(-1)?.toLowerCase() ?? "";
  return (
    parts.includes(".git") ||
    parts.includes("node_modules") ||
    file.startsWith(".env") ||
    PRIVATE_KEY.test(file) ||
    ARCHIVE.test(file)
  );
}

export function workspaceTransferDigest(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

export type WorkspaceTransferPiece = {
  offset: number;
  content: Uint8Array;
};

/** Splits file content into ordered transfer pieces; an empty file is one empty piece. */
export function workspaceTransferPieces(
  content: Uint8Array,
  chunkBytes = WORKSPACE_TRANSFER_CHUNK_BYTES,
): WorkspaceTransferPiece[] {
  if (!content.byteLength) return [{ offset: 0, content }];
  const pieces: WorkspaceTransferPiece[] = [];
  for (let offset = 0; offset < content.byteLength; offset += chunkBytes)
    pieces.push({ offset, content: content.subarray(offset, offset + chunkBytes) });
  return pieces;
}
