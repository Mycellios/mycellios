import { describe, expect, it } from "vitest";
import {
  isWorkspaceTransferExcluded,
  workspaceTransferDigest,
  workspaceTransferPieces,
} from "./workspace-transfer.js";

describe("workspace transfer rules", () => {
  it.each([
    "repo/.git/objects/pack/pack-1.pack",
    ".git/HEAD",
    "site/node_modules/react/index.js",
    ".env",
    "app/.env.local",
    "keys/deploy-private-key.pem",
    "exports/site.zip",
    "backup.tar",
    "logs.tgz",
    "repo\\.git\\config",
  ])("never copies %s between machines", (path) => {
    expect(isWorkspaceTransferExcluded(path)).toBe(true);
  });

  it.each(["notes.md", "site/index.html", "environment.md", "docs/git-guide.md", "gitignore", "keys/public.pem"])(
    "copies %s",
    (path) => {
      expect(isWorkspaceTransferExcluded(path)).toBe(false);
    },
  );

  it("splits content into ordered pieces that reassemble to the same digest", () => {
    const content = new Uint8Array(25).map((_, index) => index);
    const pieces = workspaceTransferPieces(content, 10);
    expect(pieces.map((piece) => [piece.offset, piece.content.byteLength])).toEqual([
      [0, 10],
      [10, 10],
      [20, 5],
    ]);
    const joined = new Uint8Array(content.byteLength);
    for (const piece of pieces) joined.set(piece.content, piece.offset);
    expect(workspaceTransferDigest(joined)).toBe(workspaceTransferDigest(content));
  });

  it("sends an empty file as one empty piece", () => {
    expect(workspaceTransferPieces(new Uint8Array(), 10)).toEqual([
      { offset: 0, content: new Uint8Array() },
    ]);
  });
});
