import { createHash, randomBytes, randomUUID } from "node:crypto";
import type {
  SpaceAuditEvent,
  SpaceInvitation,
  SpaceInvitationKind,
  SpaceInvitePreview,
  SpaceMemberRole,
  SpaceMembers,
  SpacePerson,
  SpaceRole,
} from "@mycellios/contracts";
import {
  canChangeSpaceRole,
  canInviteToSpace,
  canRemoveSpacePerson,
  SPACE_AUDIT_EVENT_TYPES,
  SPACE_INVITATION_DAYS,
  SpaceAuditEventTypeSchema,
  spaceRoleOf,
} from "@mycellios/contracts";
import type { PrismaClient } from "./client.js";
import { Prisma } from "./client.js";
import { runAsSystem } from "./row-security.js";
import { IsolationError } from "./scope.js";
import { recordSecurityEvent } from "./security-events.js";
import { withTransactionRetry } from "./transaction-retry.js";

/**
 * Space members (specs/space-members, phase 1). An invitation admits a signed-in account to
 * one Space other than Personal: it gets a `member` organization membership in the owner's
 * organization and a `member` Space membership, nothing else. Every change takes the Space's
 * advisory lock, the same one Space deletion and content creation take.
 */

export class SpaceMembersForbiddenError extends Error {
  constructor() {
    super("Only the space owner or an admin can do this.");
    this.name = "SpaceMembersForbiddenError";
  }
}

export class SpaceNotShareableError extends Error {
  constructor() {
    super("This space cannot be shared.");
    this.name = "SpaceNotShareableError";
  }
}

export class SpaceFullError extends Error {
  constructor() {
    super("This space is full.");
    this.name = "SpaceFullError";
  }
}

export class SpaceMemberExistsError extends Error {
  constructor() {
    super("Already in this space.");
    this.name = "SpaceMemberExistsError";
  }
}

export class SpaceInvitationUnavailableError extends Error {
  constructor() {
    super("This invitation is no longer valid.");
    this.name = "SpaceInvitationUnavailableError";
  }
}

export class SpaceInvitationAddressError extends Error {
  constructor() {
    super("This invitation is for another email address.");
    this.name = "SpaceInvitationAddressError";
  }
}

export class SpaceInvitationUnverifiedError extends Error {
  constructor() {
    super("Verify your email address to accept this invitation.");
    this.name = "SpaceInvitationUnverifiedError";
  }
}

export class SpaceInvitationRateError extends Error {
  constructor() {
    super("Too many email invitations today. Try again tomorrow.");
    this.name = "SpaceInvitationRateError";
  }
}

export class SpaceOwnerCannotLeaveError extends Error {
  constructor() {
    super("The owner cannot leave their space.");
    this.name = "SpaceOwnerCannotLeaveError";
  }
}

/** Email invitations one person may send per rolling day, so a Space cannot be used to spam. */
export const SPACE_EMAIL_INVITATIONS_PER_DAY = 50;
const INVITATION_MS = SPACE_INVITATION_DAYS * 24 * 60 * 60 * 1000;

type Tx = Prisma.TransactionClient;

export function newSpaceInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

export function spaceInviteTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** The Space's advisory lock, the same one Space deletion and content creation take. */
export function lockSpace(tx: Tx, spaceId: string) {
  return tx.$queryRaw(Prisma.sql`
    SELECT pg_advisory_xact_lock(hashtextextended(${spaceId}, 0))::text AS "lock"
  `);
}

/** Serializes joining and leaving another Space of the same organization for one person. */
function lockOrganizationMember(tx: Tx, organizationId: string, userId: string) {
  return tx.$queryRaw(Prisma.sql`
    SELECT pg_advisory_xact_lock(hashtextextended(${`space-member:${organizationId}:${userId}`}, 0))::text AS "lock"
  `);
}

function transaction<T>(prisma: PrismaClient, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withTransactionRetry(() => prisma.$transaction(fn));
}

export async function spaceMembership(db: Tx | PrismaClient, spaceId: string, userId: string) {
  const row = await db.spaceMember.findUnique({
    where: { spaceId_userId: { spaceId, userId } },
    select: {
      role: true,
      organizationId: true,
      space: { select: { name: true, isDefault: true, deletingAt: true } },
      member: { select: { user: { select: { name: true } } } },
    },
  });
  return row
    ? {
        role: spaceRoleOf(row.role),
        organizationId: row.organizationId,
        space: row.space,
        name: row.member.user.name.trim(),
      }
    : null;
}

export async function requireSpaceMembership(
  db: Tx | PrismaClient,
  spaceId: string,
  userId: string,
) {
  const membership = await spaceMembership(db, spaceId, userId);
  if (!membership) throw new IsolationError();
  return membership;
}

/** A Space can take people when it is not the owner's Personal Space and is not being deleted. */
export function assertShareable(space: { isDefault: boolean; deletingAt: Date | null }) {
  if (space.isDefault) throw new SpaceNotShareableError();
  if (space.deletingAt) throw new SpaceInvitationUnavailableError();
}

function pending(now: Date) {
  return { revokedAt: null, acceptedAt: null, expiresAt: { gt: now } };
}

const ROLE_ORDER: Record<SpaceRole, number> = { owner: 0, admin: 1, member: 2 };

/** The people in a Space and, for its owner and admins, its pending invitations. */
export async function listSpaceMembers(
  prisma: PrismaClient,
  input: { spaceId: string; userId: string; limit: number; now?: Date },
): Promise<SpaceMembers> {
  const now = input.now ?? new Date();
  const viewer = await requireSpaceMembership(prisma, input.spaceId, input.userId);
  const manages = canInviteToSpace(viewer.role);
  const [rows, invitations] = await Promise.all([
    prisma.spaceMember.findMany({
      where: { spaceId: input.spaceId },
      select: {
        userId: true,
        role: true,
        createdAt: true,
        member: { select: { user: { select: { name: true, email: true } } } },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    manages
      ? prisma.spaceInvitation.findMany({
          where: { spaceId: input.spaceId, ...pending(now) },
          select: {
            id: true,
            kind: true,
            email: true,
            createdAt: true,
            expiresAt: true,
            inviter: { select: { name: true } },
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        })
      : Promise.resolve([]),
  ]);
  const people: SpacePerson[] = rows
    .map((row) => {
      const role = spaceRoleOf(row.role);
      const you = row.userId === input.userId;
      return {
        userId: row.userId,
        name: row.member.user.name.trim(),
        // Members see how to reach the people who run the Space, not each other.
        email: manages || you || role !== "member" ? row.member.user.email : null,
        role,
        joinedAt: row.createdAt.toISOString(),
        you,
      };
    })
    .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role]);
  return {
    spaceId: input.spaceId,
    role: viewer.role,
    limit: input.limit,
    people,
    invitations: invitations.map(invitationDto),
  };
}

function invitationDto(row: {
  id: string;
  kind: string;
  email: string | null;
  createdAt: Date;
  expiresAt: Date;
  inviter: { name: string };
}): SpaceInvitation {
  return {
    id: row.id,
    kind: row.kind === "email" ? "email" : "link",
    email: row.email,
    invitedBy: row.inviter.name.trim(),
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  };
}

/**
 * A new one-use invitation, valid for seven days. Returns the token once; only its hash is
 * stored. People and pending invitations together stay within the Space's limit, and a new
 * email invitation to the same address replaces the pending one.
 */
export async function createSpaceInvitation(
  prisma: PrismaClient,
  input: {
    spaceId: string;
    userId: string;
    kind: SpaceInvitationKind;
    email?: string;
    limit: number;
    now?: Date;
  },
): Promise<{ invitation: SpaceInvitation; token: string; spaceName: string }> {
  const now = input.now ?? new Date();
  const email = input.kind === "email" ? input.email?.trim().toLowerCase() : undefined;
  if (input.kind === "email" && !email) throw new SpaceInvitationUnavailableError();
  const token = newSpaceInviteToken();
  const result = await transaction(prisma, async (tx) => {
    await lockSpace(tx, input.spaceId);
    const inviter = await requireSpaceMembership(tx, input.spaceId, input.userId);
    if (!canInviteToSpace(inviter.role)) throw new SpaceMembersForbiddenError();
    assertShareable(inviter.space);
    if (email) {
      const existing = await tx.spaceMember.count({
        where: {
          spaceId: input.spaceId,
          member: { user: { email: { equals: email, mode: "insensitive" } } },
        },
      });
      if (existing > 0) throw new SpaceMemberExistsError();
      const sent = await tx.spaceInvitation.count({
        where: {
          inviterUserId: input.userId,
          kind: "email",
          createdAt: { gt: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
        },
      });
      if (sent >= SPACE_EMAIL_INVITATIONS_PER_DAY) throw new SpaceInvitationRateError();
      await tx.spaceInvitation.updateMany({
        where: { spaceId: input.spaceId, kind: "email", email, ...pending(now) },
        data: { revokedAt: now },
      });
    }
    const [people, invited] = await Promise.all([
      tx.spaceMember.count({ where: { spaceId: input.spaceId } }),
      tx.spaceInvitation.count({ where: { spaceId: input.spaceId, ...pending(now) } }),
    ]);
    if (people + invited >= input.limit) throw new SpaceFullError();
    const row = await tx.spaceInvitation.create({
      data: {
        id: randomUUID(),
        spaceId: input.spaceId,
        inviterUserId: input.userId,
        kind: input.kind,
        email: email ?? null,
        tokenHash: spaceInviteTokenHash(token),
        expiresAt: new Date(now.getTime() + INVITATION_MS),
        createdAt: now,
      },
      select: {
        id: true,
        kind: true,
        email: true,
        createdAt: true,
        expiresAt: true,
        inviter: { select: { name: true } },
      },
    });
    return {
      invitation: invitationDto(row),
      actorName: inviter.name,
      spaceName: inviter.space.name,
    };
  });
  await recordSecurityEvent({
    type: "space.invitation.created",
    userId: input.userId,
    spaceId: input.spaceId,
    metadata: {
      invitationId: result.invitation.id,
      kind: input.kind,
      actorName: result.actorName,
    },
  });
  return { invitation: result.invitation, token, spaceName: result.spaceName };
}

export async function revokeSpaceInvitation(
  prisma: PrismaClient,
  input: { spaceId: string; userId: string; invitationId: string; now?: Date },
): Promise<void> {
  const now = input.now ?? new Date();
  const actor = await transaction(prisma, async (tx) => {
    await lockSpace(tx, input.spaceId);
    const membership = await requireSpaceMembership(tx, input.spaceId, input.userId);
    if (!canInviteToSpace(membership.role)) throw new SpaceMembersForbiddenError();
    const revoked = await tx.spaceInvitation.updateMany({
      where: { id: input.invitationId, spaceId: input.spaceId, ...pending(now) },
      data: { revokedAt: now },
    });
    if (revoked.count !== 1) throw new SpaceInvitationUnavailableError();
    const invitation = await tx.spaceInvitation.findUniqueOrThrow({
      where: { id: input.invitationId },
      select: { kind: true },
    });
    return { name: membership.name, kind: invitation.kind };
  });
  await recordSecurityEvent({
    type: "space.invitation.revoked",
    userId: input.userId,
    spaceId: input.spaceId,
    metadata: { invitationId: input.invitationId, kind: actor.kind, actorName: actor.name },
  });
}

type InvitationRow = {
  id: string;
  spaceId: string;
  kind: string;
  email: string | null;
  expiresAt: Date;
  inviter: { name: string };
  space: { name: string; isDefault: boolean; deletingAt: Date | null; organizationId: string };
};

async function pendingInvitation(db: Tx | PrismaClient, token: string, now: Date) {
  const row: InvitationRow | null = await db.spaceInvitation.findFirst({
    where: { tokenHash: spaceInviteTokenHash(token), ...pending(now) },
    select: {
      id: true,
      spaceId: true,
      kind: true,
      email: true,
      expiresAt: true,
      inviter: { select: { name: true } },
      space: { select: { name: true, isDefault: true, deletingAt: true, organizationId: true } },
    },
  });
  if (!row || row.space.isDefault || row.space.deletingAt)
    throw new SpaceInvitationUnavailableError();
  return row;
}

/** An email invitation is for one verified address; a link is for any signed-in account. */
function assertAddress(
  invitation: { kind: string; email: string | null },
  user: { email: string; emailVerified: boolean },
) {
  if (invitation.kind !== "email") return;
  if (user.email.trim().toLowerCase() !== invitation.email) throw new SpaceInvitationAddressError();
  if (!user.emailVerified) throw new SpaceInvitationUnverifiedError();
}

async function spaceOwnerName(db: Tx | PrismaClient, spaceId: string): Promise<string | null> {
  const owners = await db.spaceMember.findMany({
    where: { spaceId },
    select: { role: true, member: { select: { user: { select: { name: true } } } } },
    orderBy: { createdAt: "asc" },
  });
  const owner = owners.find((row) => spaceRoleOf(row.role) === "owner");
  return owner ? owner.member.user.name.trim() : null;
}

/** Owners' names of the given Spaces, for Spaces shared with the viewer. */
export async function spaceOwnerNames(
  db: Pick<PrismaClient, "spaceMember">,
  spaceIds: string[],
): Promise<Map<string, string>> {
  if (spaceIds.length === 0) return new Map();
  const rows = await db.spaceMember.findMany({
    where: { spaceId: { in: spaceIds } },
    select: { spaceId: true, role: true, member: { select: { user: { select: { name: true } } } } },
    orderBy: { createdAt: "asc" },
  });
  const names = new Map<string, string>();
  for (const row of rows) {
    if (spaceRoleOf(row.role) !== "owner" || names.has(row.spaceId)) continue;
    names.set(row.spaceId, row.member.user.name.trim());
  }
  return names;
}

/** What an invitation opens. Invitations are read as system: the reader is not a member yet. */
export function previewSpaceInvitation(
  prisma: PrismaClient,
  input: { token: string; user: { id: string; email: string; emailVerified: boolean }; now?: Date },
): Promise<SpaceInvitePreview> {
  const now = input.now ?? new Date();
  return runAsSystem("read a Space invitation for the account opening it", async () => {
    const invitation = await pendingInvitation(prisma, input.token, now);
    const [ownerName, membership] = await Promise.all([
      spaceOwnerName(prisma, invitation.spaceId),
      prisma.spaceMember.findUnique({
        where: { spaceId_userId: { spaceId: invitation.spaceId, userId: input.user.id } },
        select: { id: true },
      }),
    ]);
    if (ownerName === null) throw new SpaceInvitationUnavailableError();
    if (!membership) assertAddress(invitation, input.user);
    return {
      spaceId: invitation.spaceId,
      spaceName: invitation.space.name,
      ownerName,
      invitedBy: invitation.inviter.name.trim(),
      expiresAt: invitation.expiresAt.toISOString(),
      member: Boolean(membership),
    };
  });
}

/**
 * Join a Space with a pending invitation. The invitation is used up only when someone joins:
 * opening it again as a member changes nothing.
 */
export async function acceptSpaceInvitation(
  prisma: PrismaClient,
  input: {
    token: string;
    user: { id: string; email: string; emailVerified: boolean };
    limit: number;
    now?: Date;
  },
): Promise<{ spaceId: string; joined: boolean }> {
  const now = input.now ?? new Date();
  const result = await runAsSystem("accept a Space invitation", () =>
    transaction(prisma, async (tx) => {
      const found = await pendingInvitation(tx, input.token, now);
      await lockSpace(tx, found.spaceId);
      // Read again under the lock: a revoke, an expiry or another person may have come first.
      const invitation = await pendingInvitation(tx, input.token, now);
      const existing = await tx.spaceMember.findUnique({
        where: { spaceId_userId: { spaceId: invitation.spaceId, userId: input.user.id } },
        select: { id: true },
      });
      if (existing) return { spaceId: invitation.spaceId, joined: false as const };
      assertAddress(invitation, input.user);
      if ((await spaceOwnerName(tx, invitation.spaceId)) === null)
        throw new SpaceInvitationUnavailableError();
      const people = await tx.spaceMember.count({ where: { spaceId: invitation.spaceId } });
      if (people >= input.limit) throw new SpaceFullError();
      const used = await tx.spaceInvitation.updateMany({
        where: { id: invitation.id, ...pending(now) },
        data: { acceptedAt: now, acceptedByUserId: input.user.id },
      });
      if (used.count !== 1) throw new SpaceInvitationUnavailableError();
      const organizationId = invitation.space.organizationId;
      await lockOrganizationMember(tx, organizationId, input.user.id);
      // A person already in another of the owner's Spaces keeps that organization membership.
      await tx.member.createMany({
        data: [
          {
            id: randomUUID(),
            organizationId,
            userId: input.user.id,
            role: "member",
            createdAt: now,
          },
        ],
        skipDuplicates: true,
      });
      await tx.spaceMember.create({
        data: {
          id: randomUUID(),
          spaceId: invitation.spaceId,
          organizationId,
          userId: input.user.id,
          role: "member",
          createdAt: now,
        },
      });
      const user = await tx.user.findUniqueOrThrow({
        where: { id: input.user.id },
        select: { name: true },
      });
      return {
        spaceId: invitation.spaceId,
        joined: true as const,
        invitationId: invitation.id,
        kind: invitation.kind,
        invitedBy: invitation.inviter.name.trim(),
        targetName: user.name.trim(),
      };
    }),
  );
  if (result.joined) {
    await recordSecurityEvent({
      type: "space.member.joined",
      userId: input.user.id,
      spaceId: result.spaceId,
      metadata: {
        invitationId: result.invitationId,
        kind: result.kind,
        actorName: result.invitedBy,
        targetName: result.targetName,
      },
    });
  }
  return { spaceId: result.spaceId, joined: result.joined };
}

/**
 * Delete one Space membership. Its organization membership goes too when it was the person's
 * last Space there and they do not own the organization.
 */
async function deleteMembership(
  tx: Tx,
  input: { spaceId: string; organizationId: string; userId: string },
) {
  await lockOrganizationMember(tx, input.organizationId, input.userId);
  await tx.spaceMember.delete({
    where: { spaceId_userId: { spaceId: input.spaceId, userId: input.userId } },
  });
  const [remaining, member] = await Promise.all([
    tx.spaceMember.count({
      where: { organizationId: input.organizationId, userId: input.userId },
    }),
    tx.member.findUnique({
      where: {
        organizationId_userId: { organizationId: input.organizationId, userId: input.userId },
      },
      select: { id: true, role: true },
    }),
  ]);
  if (remaining === 0 && member && spaceRoleOf(member.role) !== "owner")
    await tx.member.delete({ where: { id: member.id } });
}

/**
 * After a Space is deleted, drop organization memberships that no longer reach any Space there,
 * other than owners'. Each person is locked as when they join, so a concurrent join is kept.
 */
export async function pruneDetachedOrganizationMembers(tx: Tx, organizationId: string) {
  const candidates = await tx.member.findMany({
    where: { organizationId, spaceMemberships: { none: {} } },
    select: { id: true, userId: true, role: true },
  });
  for (const candidate of candidates) {
    if (spaceRoleOf(candidate.role) === "owner") continue;
    await lockOrganizationMember(tx, organizationId, candidate.userId);
    const remaining = await tx.spaceMember.count({
      where: { organizationId, userId: candidate.userId },
    });
    if (remaining === 0) await tx.member.deleteMany({ where: { id: candidate.id } });
  }
}

/** Remove someone from a Space. Nobody removes the owner; admins remove only members. */
export async function removeSpaceMember(
  prisma: PrismaClient,
  input: { spaceId: string; userId: string; targetUserId: string },
): Promise<void> {
  const names = await transaction(prisma, async (tx) => {
    await lockSpace(tx, input.spaceId);
    const actor = await requireSpaceMembership(tx, input.spaceId, input.userId);
    if (!canInviteToSpace(actor.role)) throw new SpaceMembersForbiddenError();
    const target = await spaceMembership(tx, input.spaceId, input.targetUserId);
    if (!target) throw new IsolationError();
    if (input.targetUserId === input.userId || !canRemoveSpacePerson(actor.role, target.role))
      throw new SpaceMembersForbiddenError();
    await deleteMembership(tx, {
      spaceId: input.spaceId,
      organizationId: target.organizationId,
      userId: input.targetUserId,
    });
    return { actorName: actor.name, targetName: target.name };
  });
  await recordSecurityEvent({
    type: "space.member.removed",
    userId: input.userId,
    spaceId: input.spaceId,
    metadata: { targetUserId: input.targetUserId, ...names },
  });
}

/** Leave a Space someone else owns. Access ends on the next request. */
export async function leaveSpace(
  prisma: PrismaClient,
  input: { spaceId: string; userId: string },
): Promise<void> {
  const name = await transaction(prisma, async (tx) => {
    await lockSpace(tx, input.spaceId);
    const membership = await requireSpaceMembership(tx, input.spaceId, input.userId);
    if (membership.role === "owner") throw new SpaceOwnerCannotLeaveError();
    await deleteMembership(tx, {
      spaceId: input.spaceId,
      organizationId: membership.organizationId,
      userId: input.userId,
    });
    return membership.name;
  });
  await recordSecurityEvent({
    type: "space.member.left",
    userId: input.userId,
    spaceId: input.spaceId,
    metadata: { targetUserId: input.userId, targetName: name },
  });
}

/** Make someone an admin or a member. Only the owner does this; the owner's role never changes. */
export async function setSpaceMemberRole(
  prisma: PrismaClient,
  input: { spaceId: string; userId: string; targetUserId: string; role: SpaceMemberRole },
): Promise<void> {
  const changed = await transaction(prisma, async (tx) => {
    await lockSpace(tx, input.spaceId);
    const actor = await requireSpaceMembership(tx, input.spaceId, input.userId);
    if (!canInviteToSpace(actor.role)) throw new SpaceMembersForbiddenError();
    const target = await spaceMembership(tx, input.spaceId, input.targetUserId);
    if (!target) throw new IsolationError();
    if (!canChangeSpaceRole(actor.role, target.role)) throw new SpaceMembersForbiddenError();
    if (target.role === input.role) return null;
    await tx.spaceMember.update({
      where: { spaceId_userId: { spaceId: input.spaceId, userId: input.targetUserId } },
      data: { role: input.role },
    });
    return { actorName: actor.name, targetName: target.name };
  });
  if (!changed) return;
  await recordSecurityEvent({
    type: "space.member.role_changed",
    userId: input.userId,
    spaceId: input.spaceId,
    metadata: { targetUserId: input.targetUserId, role: input.role, ...changed },
  });
}

/** The Space's membership changes, newest first, for its owner and admins. */
export async function listSpaceAuditEvents(
  prisma: PrismaClient,
  input: { spaceId: string; userId: string; cursor?: string; limit: number },
): Promise<SpaceAuditEvent[]> {
  const viewer = await requireSpaceMembership(prisma, input.spaceId, input.userId);
  if (!canInviteToSpace(viewer.role)) throw new SpaceMembersForbiddenError();
  return runAsSystem("read a Space's membership audit log for its owner or admin", async () => {
    const after = input.cursor
      ? await prisma.securityEvent.findFirst({
          where: { id: input.cursor, spaceId: input.spaceId },
          select: { id: true, createdAt: true },
        })
      : null;
    if (input.cursor && !after) return [];
    const rows = await prisma.securityEvent.findMany({
      where: {
        spaceId: input.spaceId,
        type: { in: [...SPACE_AUDIT_EVENT_TYPES] },
        ...(after
          ? {
              OR: [
                { createdAt: { lt: after.createdAt } },
                { createdAt: after.createdAt, id: { lt: after.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit,
    });
    return rows.flatMap((row) => {
      const type = SpaceAuditEventTypeSchema.safeParse(row.type);
      if (!type.success) return [];
      const metadata = (row.metadata ?? {}) as Record<string, unknown>;
      const text = (key: string) =>
        typeof metadata[key] === "string" ? (metadata[key] as string) : null;
      const role = text("role");
      const kind = text("kind");
      const audience = text("audience");
      return [
        {
          id: row.id,
          type: type.data,
          actorName: text("actorName"),
          targetName: text("targetName"),
          role: role === "admin" || role === "member" ? role : null,
          kind: kind === "email" || kind === "link" ? kind : null,
          ...(type.data === "space.mico.shared"
            ? {
                micoName: text("micoName"),
                audience:
                  audience === "none" || audience === "everyone" || audience === "people"
                    ? audience
                    : null,
              }
            : {}),
          createdAt: row.createdAt.toISOString(),
        },
      ];
    });
  });
}
