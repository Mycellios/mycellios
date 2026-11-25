import type { PrismaClient } from "./client.js";
import { Prisma } from "./client.js";

/**
 * Who an artifact family belongs to besides its owner: a Space member's uploads to their
 * conversation with a shared Mico (specs/space-members) never join, or take, the owner's files of
 * the same name, nor another member's.
 */
type ArtifactFamilyKey = {
  spaceId: string;
  userId: string;
  botId: string;
  groupId?: string | null;
  name: string;
  memberUserId?: string | null;
};

export async function resolveNextArtifactVersion(
  prisma: Pick<PrismaClient, "artifact">,
  params: ArtifactFamilyKey,
): Promise<{ rootArtifactId: string | null; version: number }> {
  const previous = await prisma.artifact.findFirst({
    where: {
      spaceId: params.spaceId,
      userId: params.userId,
      botId: params.botId,
      groupId: params.groupId ?? null,
      memberUserId: params.memberUserId ?? null,
      name: { equals: params.name, mode: "insensitive" },
      // A file copied into a branch is a snapshot of its own: new versions never build on it.
      OR: [{ clientNonce: null }, { NOT: { clientNonce: { startsWith: "branch-copy:" } } }],
    },
    orderBy: [{ version: "desc" }, { createdAt: "desc" }],
    select: { id: true, rootArtifactId: true, version: true },
  });
  if (!previous) return { rootArtifactId: null, version: 1 };
  return {
    rootArtifactId: previous.rootArtifactId ?? previous.id,
    version: previous.version + 1,
  };
}

const MAX_VERSION_ALLOCATION_ATTEMPTS = 5;

type ArtifactVersionWrite = {
  rootArtifactId: string | null;
  version: number;
};

// Advisory lock queues same-name publishes; retry a unique family-version clash.
export async function withResolvedArtifactVersion<T>(
  prisma: Pick<PrismaClient, "$transaction">,
  params: ArtifactFamilyKey,
  attempt: (db: Prisma.TransactionClient, version: ArtifactVersionWrite) => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < MAX_VERSION_ALLOCATION_ATTEMPTS; i++) {
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`
          SELECT pg_advisory_xact_lock(hashtextextended(${artifactVersionLockKey(params)}, 0))::text AS "lock"
        `);
        const version = await resolveNextArtifactVersion(tx, params);
        return await attempt(tx, version);
      });
    } catch (error) {
      if (!isArtifactVersionConflict(error)) throw error;
      lastError = error;
    }
  }
  throw lastError;
}

// Same identity as the name lookup, so those publishes share one lock.
function artifactVersionLockKey(params: ArtifactFamilyKey): string {
  return [
    params.spaceId,
    params.userId,
    params.botId,
    params.groupId ?? "",
    params.name.toLowerCase(),
    ...(params.memberUserId ? [params.memberUserId] : []),
  ].join("\u001f");
}

function isArtifactVersionConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
