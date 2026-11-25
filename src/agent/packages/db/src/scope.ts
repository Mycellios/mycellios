import type { Actor, SpaceRole } from "@mycellios/contracts";
import { spaceRoleOf } from "@mycellios/contracts";
import type { PrismaClient } from "./client.js";

export class IsolationError extends Error {
  constructor(message = "Resource not found") {
    super(message);
    this.name = "IsolationError";
  }
}

/** Unique (spaceId, userId, name) collision when renaming a bot section. */
export class BotSectionNameConflictError extends Error {
  constructor(message = "Folder name already used") {
    super(message);
    this.name = "BotSectionNameConflictError";
  }
}

async function findMembership(
  prisma: PrismaClient,
  userId: string,
  requestedSpaceId?: string | null,
) {
  // Read on every request, so leaving or removal ends access on the next one. Without a
  // requested Space this is the account's own Personal Space: Spaces shared with it never are.
  const membership = await prisma.spaceMember.findFirst({
    where: {
      userId,
      ...(requestedSpaceId ? { spaceId: requestedSpaceId } : {}),
    },
    orderBy: [{ space: { isDefault: "desc" } }, { createdAt: "asc" }, { id: "asc" }],
    include: { member: { include: { user: true } } },
  });
  if (!membership) {
    throw new IsolationError("No personal space");
  }
  return membership;
}

function actorOf(membership: Awaited<ReturnType<typeof findMembership>>): Actor {
  return {
    userId: membership.userId,
    spaceId: membership.spaceId,
    email: membership.member.user.email,
    isDeploymentOwner: false,
  };
}

export async function requireMembership(
  prisma: PrismaClient,
  userId: string,
  requestedSpaceId?: string | null,
): Promise<Actor> {
  return actorOf(await findMembership(prisma, userId, requestedSpaceId));
}

/** The actor and its role in that Space, for request admission (specs/space-members). */
export async function requireMembershipWithRole(
  prisma: PrismaClient,
  userId: string,
  requestedSpaceId?: string | null,
): Promise<{ actor: Actor; spaceRole: SpaceRole }> {
  const membership = await findMembership(prisma, userId, requestedSpaceId);
  return { actor: actorOf(membership), spaceRole: spaceRoleOf(membership.role) };
}

export function scoped<T extends { spaceId: string; userId?: string }>(
  actor: Actor,
  record: T | null,
): T {
  if (!record || record.spaceId !== actor.spaceId) {
    throw new IsolationError();
  }
  if (record.userId && record.userId !== actor.userId) {
    throw new IsolationError();
  }
  return record;
}
