import type { MicoShare, MicoShareAudience, MicoShareInput } from "@mycellios/contracts";
import {
  allowanceDayStart,
  canInviteToSpace,
  DEFAULT_MICO_SHARE_DAILY_ALLOWANCE_MICROS,
  SHARED_MICO_UNAVAILABLE_ERROR,
  spaceRoleOf,
} from "@mycellios/contracts";
import { ACTIVE_RUN_STATUSES } from "@mycellios/core";
import type { PrismaClient } from "./client.js";
import { Prisma } from "./client.js";
import type { MemberAllowance } from "./model-credits.js";
import { memberSpentMicros, SharedMicoAllowanceError } from "./model-credits.js";
import { IsolationError } from "./scope.js";
import { recordSecurityEvent } from "./security-events.js";
import {
  assertShareable,
  lockSpace,
  requireSpaceMembership,
  SpaceMembersForbiddenError,
} from "./space-members.js";
import { withTransactionRetry } from "./transaction-retry.js";

/**
 * Micos shared with people in a Space (specs/space-members, phase 1b). The owner or an admin
 * shares a Mico with chosen people or with everyone, at the level `chat`. A person then talks to
 * it only in their own conversations: side threads of that Mico that stay its owner's, marked
 * with `memberUserId`. Access is resolved again on every request and before every paid model
 * call, so unsharing and removal take effect at once.
 */

type Tx = Prisma.TransactionClient;
type Db = Tx | PrismaClient;

export class SharedMicoUnavailableError extends Error {
  constructor() {
    super(SHARED_MICO_UNAVAILABLE_ERROR);
    this.name = "SharedMicoUnavailableError";
  }
}

const shareSelection = {
  id: true,
  name: true,
  title: true,
  color: true,
  share: {
    select: {
      everyone: true,
      dailyAllowanceMicros: true,
      members: { select: { userId: true }, orderBy: { createdAt: "asc" } },
    },
  },
} as const satisfies Prisma.BotSelect;

type ShareRow = Prisma.BotGetPayload<{ select: typeof shareSelection }>;

function audienceOf(row: ShareRow): MicoShareAudience {
  if (!row.share) return "none";
  if (row.share.everyone) return "everyone";
  return row.share.members.length ? "people" : "none";
}

function shareDto(row: ShareRow): MicoShare {
  const audience = audienceOf(row);
  return {
    botId: row.id,
    name: row.name,
    title: row.title,
    color: row.color,
    audience,
    userIds: audience === "people" ? (row.share?.members ?? []).map((member) => member.userId) : [],
    dailyAllowanceMicros: Number(
      row.share?.dailyAllowanceMicros ?? DEFAULT_MICO_SHARE_DAILY_ALLOWANCE_MICROS,
    ),
  };
}

/** The Space's owner: the only person whose Micos are shared in phase 1. */
async function spaceOwner(db: Db, spaceId: string) {
  const rows = await db.spaceMember.findMany({
    where: { spaceId },
    select: {
      userId: true,
      role: true,
      member: { select: { user: { select: { name: true, email: true } } } },
    },
    orderBy: { createdAt: "asc" },
  });
  const owner = rows.find((row) => spaceRoleOf(row.role) === "owner");
  return owner
    ? {
        userId: owner.userId,
        name: owner.member.user.name.trim(),
        email: owner.member.user.email,
      }
    : null;
}

/** Who each of the Space owner's Micos is shared with, for the owner and admins. */
export async function listMicoShares(
  prisma: PrismaClient,
  input: { spaceId: string; userId: string },
): Promise<MicoShare[]> {
  const viewer = await requireSpaceMembership(prisma, input.spaceId, input.userId);
  if (!canInviteToSpace(viewer.role)) throw new SpaceMembersForbiddenError();
  // A Personal Space is never shared.
  if (viewer.space.isDefault) return [];
  const owner = await spaceOwner(prisma, input.spaceId);
  if (!owner) return [];
  const rows = await prisma.bot.findMany({
    where: { spaceId: input.spaceId, userId: owner.userId, archivedAt: null },
    select: shareSelection,
    orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });
  return rows.map(shareDto);
}

/**
 * Replace who a Mico is shared with. Only its Space's owner or an admin does this, never in a
 * Personal Space, and only with people in the Space other than its owner. Returns the people who
 * lost it, so their unfinished turns can be stopped.
 */
export async function setMicoShare(
  prisma: PrismaClient,
  input: { spaceId: string; userId: string; share: MicoShareInput },
): Promise<{ share: MicoShare; lostUserIds: string[] }> {
  const { share } = input;
  const result = await withTransactionRetry(() =>
    prisma.$transaction(async (tx) => {
      await lockSpace(tx, input.spaceId);
      const actor = await requireSpaceMembership(tx, input.spaceId, input.userId);
      if (!canInviteToSpace(actor.role)) throw new SpaceMembersForbiddenError();
      assertShareable(actor.space);
      const people = await tx.spaceMember.findMany({
        where: { spaceId: input.spaceId },
        select: { userId: true, role: true },
      });
      const owner = people.find((person) => spaceRoleOf(person.role) === "owner");
      if (!owner) throw new IsolationError();
      const before = await tx.bot.findFirst({
        where: { id: share.botId, spaceId: input.spaceId, userId: owner.userId, archivedAt: null },
        select: shareSelection,
      });
      if (!before) throw new IsolationError();
      const others = new Set(
        people.filter((person) => person.userId !== owner.userId).map((person) => person.userId),
      );
      if (share.audience === "people" && share.userIds.some((userId) => !others.has(userId)))
        throw new IsolationError("That person is not in this space.");
      const had = (userId: string) =>
        Boolean(
          before.share &&
            (before.share.everyone ||
              before.share.members.some((member) => member.userId === userId)),
        );
      const has = (userId: string) =>
        share.audience === "everyone" ||
        (share.audience === "people" && share.userIds.includes(userId));
      const lostUserIds = [...others].filter((userId) => had(userId) && !has(userId));
      if (share.audience === "none") {
        await tx.micoShare.deleteMany({ where: { botId: before.id } });
      } else {
        const values = {
          everyone: share.audience === "everyone",
          dailyAllowanceMicros: BigInt(share.dailyAllowanceMicros),
        };
        await tx.micoShare.upsert({
          where: { botId: before.id },
          create: { botId: before.id, spaceId: input.spaceId, ...values },
          update: values,
        });
        await tx.micoShareMember.deleteMany({
          where: {
            botId: before.id,
            ...(share.audience === "people" ? { userId: { notIn: share.userIds } } : {}),
          },
        });
        if (share.audience === "people")
          await tx.micoShareMember.createMany({
            data: share.userIds.map((userId) => ({
              botId: before.id,
              spaceId: input.spaceId,
              userId,
            })),
            skipDuplicates: true,
          });
      }
      const after = await tx.bot.findUniqueOrThrow({
        where: { id: before.id },
        select: shareSelection,
      });
      const previous = shareDto(before);
      const next = shareDto(after);
      return {
        share: next,
        lostUserIds,
        changed: JSON.stringify(previous) !== JSON.stringify(next),
        actorName: actor.name,
      };
    }),
  );
  if (result.changed)
    await recordSecurityEvent({
      type: "space.mico.shared",
      userId: input.userId,
      spaceId: input.spaceId,
      metadata: {
        botId: result.share.botId,
        micoName: result.share.name,
        audience: result.share.audience,
        people: result.share.audience === "people" ? result.share.userIds.length : null,
        actorName: result.actorName,
      },
    });
  return { share: result.share, lostUserIds: result.lostUserIds };
}

/** What a person may use of a Mico shared with them, resolved on every request. */
export interface SharedMicoAccess {
  spaceId: string;
  botId: string;
  name: string;
  title: string;
  color: string;
  /** The Mico's owner, whose tenant identity and Credits the person's turns use. */
  owner: { userId: string; name: string; email: string };
  member: { userId: string; name: string };
  dailyAllowanceMicros: bigint;
}

/**
 * The Mico, when it is shared with this person now: they are in the Space other than as its
 * owner, the Space is not Personal or being deleted, and the Mico is the owner's, not archived and
 * shared with everyone or with them. Null otherwise; callers answer as if the Mico did not exist.
 */
export async function sharedMicoAccess(
  db: Db,
  input: { spaceId: string; memberUserId: string; botId: string },
): Promise<SharedMicoAccess | null> {
  const membership = await db.spaceMember.findUnique({
    where: { spaceId_userId: { spaceId: input.spaceId, userId: input.memberUserId } },
    select: {
      role: true,
      member: { select: { user: { select: { name: true } } } },
      space: { select: { isDefault: true, deletingAt: true } },
    },
  });
  if (!membership || spaceRoleOf(membership.role) === "owner") return null;
  if (membership.space.isDefault || membership.space.deletingAt) return null;
  const bot = await db.bot.findFirst({
    where: { id: input.botId, spaceId: input.spaceId, archivedAt: null },
    select: {
      id: true,
      userId: true,
      name: true,
      title: true,
      color: true,
      share: {
        select: {
          everyone: true,
          dailyAllowanceMicros: true,
          members: { where: { userId: input.memberUserId }, select: { userId: true } },
        },
      },
    },
  });
  if (!bot?.share || (!bot.share.everyone && bot.share.members.length === 0)) return null;
  const owner = await spaceOwner(db, input.spaceId);
  if (!owner || owner.userId !== bot.userId || owner.userId === input.memberUserId) return null;
  return {
    spaceId: input.spaceId,
    botId: bot.id,
    name: bot.name,
    title: bot.title,
    color: bot.color,
    owner,
    member: { userId: input.memberUserId, name: membership.member.user.name.trim() },
    dailyAllowanceMicros: bot.share.dailyAllowanceMicros,
  };
}

/** The allowance a member's next paid call on a shared Mico counts against, or null without access. */
export async function sharedMicoAllowance(
  db: Db,
  input: { spaceId: string; memberUserId: string; botId: string; now?: Date },
): Promise<MemberAllowance | null> {
  const access = await sharedMicoAccess(db, input);
  return access
    ? {
        memberUserId: input.memberUserId,
        botId: input.botId,
        limitMicros: access.dailyAllowanceMicros,
        since: allowanceDayStart(input.now ?? new Date()),
      }
    : null;
}

/** Refuses a send once the person's allowance on this Mico is 0 or used up for today (UTC). */
export async function assertSharedMicoAllowanceLeft(
  db: Db,
  access: SharedMicoAccess,
  now = new Date(),
): Promise<void> {
  if (access.dailyAllowanceMicros <= 0n) throw new SharedMicoAllowanceError(true);
  const spent = await memberSpentMicros(db, {
    memberUserId: access.member.userId,
    botId: access.botId,
    since: allowanceDayStart(now),
  });
  if (spent >= access.dailyAllowanceMicros) throw new SharedMicoAllowanceError(false);
}

/** The Micos shared with a person in this Space, with what is left of each allowance today. */
export async function sharedMicosForMember(
  db: Db,
  input: { spaceId: string; memberUserId: string; now?: Date },
) {
  const membership = await db.spaceMember.findUnique({
    where: { spaceId_userId: { spaceId: input.spaceId, userId: input.memberUserId } },
    select: { role: true, space: { select: { isDefault: true, deletingAt: true } } },
  });
  if (!membership || spaceRoleOf(membership.role) === "owner") return [];
  if (membership.space.isDefault || membership.space.deletingAt) return [];
  const owner = await spaceOwner(db, input.spaceId);
  if (!owner) return [];
  const bots = await db.bot.findMany({
    where: {
      spaceId: input.spaceId,
      userId: owner.userId,
      archivedAt: null,
      share: {
        is: {
          OR: [{ everyone: true }, { members: { some: { userId: input.memberUserId } } }],
        },
      },
    },
    select: {
      id: true,
      name: true,
      title: true,
      color: true,
      share: { select: { dailyAllowanceMicros: true } },
    },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });
  const spent = new Map<string, bigint>();
  if (bots.length) {
    const rows = await db.$queryRaw<Array<{ botId: string; spent: bigint | number | null }>>`
      SELECT r."botId", COALESCE(SUM(-e."amountMicros"), 0)::bigint AS spent
      FROM model_credit_entries e
      JOIN runs r ON r.id = e."runId"
      WHERE e."requestedByUserId" = ${input.memberUserId}
        AND e."createdAt" >= ${allowanceDayStart(input.now ?? new Date())}
        AND e."amountMicros" < 0
        AND r."botId" IN (${Prisma.join(bots.map((bot) => bot.id))})
      GROUP BY r."botId"`;
    for (const row of rows) spent.set(row.botId, BigInt(row.spent ?? 0));
  }
  return bots.map((bot) => {
    const limit = bot.share?.dailyAllowanceMicros ?? 0n;
    const left = limit - (spent.get(bot.id) ?? 0n);
    return {
      botId: bot.id,
      name: bot.name,
      title: bot.title,
      color: bot.color,
      ownerName: owner.name,
      ownerUserId: owner.userId,
      allowanceLeftMicros: Number(left > 0n ? left : 0n),
    };
  });
}

/** A person's conversations are ordinary Mico side threads; their key keeps them apart. */
export function sharedMicoTaskKey(botId: string, memberUserId: string, requestKey: string) {
  return `mico-task:${botId}:member:${memberUserId}:${requestKey}`;
}

/** Starts a person's conversation with a shared Mico; the same request key returns it again. */
export async function openSharedMicoConversation(
  db: Db,
  access: SharedMicoAccess,
  requestKey: string,
): Promise<{ threadId: string }> {
  const taskKey = sharedMicoTaskKey(access.botId, access.member.userId, requestKey);
  const row = await db.thread.upsert({
    where: {
      spaceId_userId_taskKey: { spaceId: access.spaceId, userId: access.owner.userId, taskKey },
    },
    create: {
      spaceId: access.spaceId,
      userId: access.owner.userId,
      taskBotId: access.botId,
      projectKey: `mico:${access.botId}`,
      taskKey,
      startedBy: "user",
      memberUserId: access.member.userId,
    },
    update: {},
    select: { id: true, taskBotId: true, memberUserId: true, deleteAfter: true },
  });
  if (
    row.taskBotId !== access.botId ||
    row.memberUserId !== access.member.userId ||
    row.deleteAfter
  )
    throw new IsolationError();
  return { threadId: row.id };
}

/** The person's own conversation with the Mico, or null: never its main chat or anyone else's. */
export function findSharedMicoConversation(db: Db, access: SharedMicoAccess, threadId: string) {
  return db.thread.findFirst({
    where: {
      id: threadId,
      spaceId: access.spaceId,
      userId: access.owner.userId,
      taskBotId: access.botId,
      botId: null,
      memberUserId: access.member.userId,
      deleteAfter: null,
    },
    select: { id: true },
  });
}

/**
 * Members' conversations in a Space with unfinished turns: of the given people, of one Mico, or
 * both. When someone loses access these are stopped, and their messages stay.
 */
export function sharedMicoConversationsWithActiveTurns(
  db: Db,
  input: { spaceId: string; memberUserIds?: string[]; botId?: string },
) {
  return db.thread.findMany({
    where: {
      spaceId: input.spaceId,
      memberUserId: input.memberUserIds ? { in: input.memberUserIds } : { not: null },
      ...(input.botId ? { taskBotId: input.botId } : {}),
      runs: { some: { status: { in: [...ACTIVE_RUN_STATUSES] } } },
    },
    select: { id: true, taskBotId: true, userId: true, memberUserId: true },
    take: 500,
  });
}
