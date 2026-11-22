import { createHash, timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "./client.js";

/** HttpOnly cookie that carries an invitation from its link to account creation. */
export const SIGNUP_INVITE_COOKIE = "mycellios_signup_invite";
/** An invitation stays in the browser long enough to register and confirm the mailbox. */
export const SIGNUP_INVITE_COOKIE_MAX_AGE_SECONDS = 2 * 86_400;

/** Deployment-configured invitation link: a secret code and the number of accounts it admits. */
export interface SignupInvite {
  code: string;
  limit: number;
}

/** Stored instead of the code, so changing the code starts a new batch of places. */
export function signupInviteId(code: string): string {
  return createHash("sha256").update(`signup-invite:${code}`).digest("hex");
}

export function signupInviteCodeMatches(candidate: string | undefined, invite: SignupInvite): boolean {
  if (!candidate) return false;
  const expected = Buffer.from(signupInviteId(invite.code), "hex");
  return timingSafeEqual(Buffer.from(signupInviteId(candidate), "hex"), expected);
}

/** The invitation code in a Cookie header, or undefined when absent or repeated. */
export function signupInviteCodeFromCookie(header: string | null | undefined): string | undefined {
  const values = (header ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${SIGNUP_INVITE_COOKIE}=`))
    .map((part) => part.slice(SIGNUP_INVITE_COOKIE.length + 1));
  return values.length === 1 && values[0] ? values[0] : undefined;
}

/** Whether the invitation still has a free place. Advisory only: claiming decides. */
export async function signupInviteHasRoom(prisma: PrismaClient, invite: SignupInvite): Promise<boolean> {
  const used = await prisma.signupInviteRedemption.count({
    where: { inviteId: signupInviteId(invite.code) },
  });
  return used < invite.limit;
}

/**
 * Claims one place for this user, at most `limit` per invitation even under concurrent
 * signups. A user who already holds a place keeps it, so retries never consume another.
 */
export async function claimSignupInvite(
  prisma: PrismaClient,
  invite: SignupInvite,
  userId: string,
): Promise<boolean> {
  const inviteId = signupInviteId(invite.code);
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`signup-invite:${inviteId}`}, 0))`;
    const held = await tx.signupInviteRedemption.findUnique({ where: { userId } });
    if (held) return held.inviteId === inviteId;
    if ((await tx.signupInviteRedemption.count({ where: { inviteId } })) >= invite.limit)
      return false;
    await tx.signupInviteRedemption.create({ data: { userId, inviteId } });
    return true;
  });
}
