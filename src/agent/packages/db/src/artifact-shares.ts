import type { PrismaClient } from "./generated/prisma/client.js";
import { runAsSystem } from "./row-security.js";

/** A share token: 32 random bytes in base64url. */
export const ARTIFACT_SHARE_TOKEN = /^[A-Za-z0-9_-]{43}$/;

/**
 * The exact version a live share link shows, read in system context: the visitor has no
 * session. A revoked link has no row, so it resolves to nothing like an unknown token.
 */
export async function sharedArtifactByToken(db: PrismaClient, token: string) {
  if (!ARTIFACT_SHARE_TOKEN.test(token)) return null;
  return runAsSystem("artifact shares: resolve a public link to the version its owner shared", () =>
    db.artifactShare.findUnique({
      where: { token },
      select: {
        spaceId: true,
        userId: true,
        artifact: {
          select: { id: true, name: true, mimeType: true, storageKey: true, botId: true, groupId: true, spaceId: true },
        },
      },
    }),
  );
}
