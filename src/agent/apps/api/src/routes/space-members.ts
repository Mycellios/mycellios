import { spaceInvitationEmail } from "@mycellios/auth";
import type { Actor, SpaceMembers } from "@mycellios/contracts";
import { productAppUrl } from "@mycellios/contracts";
import {
  acceptSpaceInvitation,
  createSpaceInvitation,
  IsolationError,
  leaveSpace,
  listMicoShares,
  listSpaceAuditEvents,
  listSpaceMembers,
  previewSpaceInvitation,
  removeSpaceMember,
  revokeSpaceInvitation,
  SpaceDeletionInProgressError,
  SpaceFullError,
  SpaceInvitationAddressError,
  SpaceInvitationRateError,
  SpaceInvitationUnavailableError,
  SpaceInvitationUnverifiedError,
  SpaceMemberExistsError,
  SpaceMembersForbiddenError,
  SpaceNotShareableError,
  SpaceOwnerCannotLeaveError,
  setMicoShare,
  setSpaceMemberRole,
} from "@mycellios/db";
import { getLogger } from "@mycellios/logging";
import { ORPCError } from "@orpc/server";
import type { RouterContext } from "./context.js";
import { stopSharedMicoTurns } from "./shared-micos.js";

/** The link an invitation opens. The token travels in the fragment, so no server or log sees it. */
export function spaceInvitationUrl(webOrigin: string, token: string): string {
  return `${productAppUrl(webOrigin, "/join")}#${token}`;
}

/** Known refusals keep their own status and sentence; anything else stays a server error. */
async function mapped<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (
      error instanceof SpaceMembersForbiddenError ||
      error instanceof SpaceOwnerCannotLeaveError ||
      error instanceof SpaceNotShareableError ||
      error instanceof SpaceInvitationAddressError ||
      error instanceof SpaceInvitationUnverifiedError
    )
      throw new ORPCError("FORBIDDEN", { message: error.message });
    if (error instanceof SpaceInvitationUnavailableError)
      throw new ORPCError("NOT_FOUND", { message: error.message });
    if (
      error instanceof SpaceFullError ||
      error instanceof SpaceMemberExistsError ||
      error instanceof SpaceDeletionInProgressError
    )
      throw new ORPCError("CONFLICT", { message: error.message });
    if (error instanceof SpaceInvitationRateError)
      throw new ORPCError("TOO_MANY_REQUESTS", { message: error.message });
    if (error instanceof IsolationError) throw new ORPCError("NOT_FOUND");
    throw error;
  }
}

/**
 * `spaces.members.*` and `spaces.invites.*` (specs/space-members, phase 1). They act on the
 * request's Space and answer NOT_FOUND while the deployment keeps Space members off.
 */
export function spaceMemberRoutes(ctx: RouterContext) {
  const { deps, authed } = ctx;
  const enabled = authed.use(({ next }) => {
    if (!deps.env.spaceMembers) throw new ORPCError("NOT_FOUND");
    return next();
  });
  const limit = () => deps.env.spaceMembers?.limit ?? 0;
  const members = (actor: Actor): Promise<SpaceMembers> =>
    listSpaceMembers(deps.prisma, { spaceId: actor.spaceId, userId: actor.userId, limit: limit() });
  const account = (actor: Actor) =>
    deps.prisma.user.findUniqueOrThrow({
      where: { id: actor.userId },
      select: { id: true, email: true, emailVerified: true },
    });

  return {
    members: {
      list: enabled.spaces.members.list.handler(({ context }) =>
        mapped(() => members(context.actor)),
      ),
      remove: enabled.spaces.members.remove.handler(async ({ context, input }) => {
        await mapped(() =>
          removeSpaceMember(deps.prisma, {
            spaceId: context.actor.spaceId,
            userId: context.actor.userId,
            targetUserId: input.userId,
          }),
        );
        // Their access already ended with the membership; their queued turns stop too.
        await stopSharedMicoTurns(deps, {
          spaceId: context.actor.spaceId,
          memberUserIds: [input.userId],
        });
        return members(context.actor);
      }),
      setRole: enabled.spaces.members.setRole.handler(async ({ context, input }) => {
        await mapped(() =>
          setSpaceMemberRole(deps.prisma, {
            spaceId: context.actor.spaceId,
            userId: context.actor.userId,
            targetUserId: input.userId,
            role: input.role,
          }),
        );
        return members(context.actor);
      }),
      leave: enabled.spaces.members.leave.handler(async ({ context }) => {
        await mapped(() =>
          leaveSpace(deps.prisma, { spaceId: context.actor.spaceId, userId: context.actor.userId }),
        );
        await stopSharedMicoTurns(deps, {
          spaceId: context.actor.spaceId,
          memberUserIds: [context.actor.userId],
        });
        return { ok: true as const };
      }),
      audit: enabled.spaces.members.audit.handler(({ context, input }) =>
        mapped(() =>
          listSpaceAuditEvents(deps.prisma, {
            spaceId: context.actor.spaceId,
            userId: context.actor.userId,
            cursor: input.cursor,
            limit: input.limit,
          }),
        ),
      ),
    },
    invites: {
      create: enabled.spaces.invites.create.handler(async ({ context, input }) => {
        const created = await mapped(() =>
          createSpaceInvitation(deps.prisma, {
            spaceId: context.actor.spaceId,
            userId: context.actor.userId,
            kind: input.kind,
            email: input.kind === "email" ? input.email : undefined,
            limit: limit(),
          }),
        );
        const url = spaceInvitationUrl(deps.env.webOrigin, created.token);
        let emailSent = false;
        if (input.kind === "email" && deps.email) {
          try {
            await deps.email.send(
              await spaceInvitationEmail(input.email, {
                inviterName: created.invitation.invitedBy,
                spaceName: created.spaceName,
                url,
              }),
            );
            emailSent = true;
          } catch (error) {
            // The invitation stands; the person who invited can still copy its link.
            getLogger().error("space invitation email delivery failed", error);
          }
        }
        return { invitation: created.invitation, url, emailSent };
      }),
      revoke: enabled.spaces.invites.revoke.handler(async ({ context, input }) => {
        await mapped(() =>
          revokeSpaceInvitation(deps.prisma, {
            spaceId: context.actor.spaceId,
            userId: context.actor.userId,
            invitationId: input.invitationId,
          }),
        );
        return members(context.actor);
      }),
      preview: enabled.spaces.invites.preview.handler(async ({ context, input }) => {
        const user = await account(context.actor);
        return mapped(() => previewSpaceInvitation(deps.prisma, { token: input.token, user }));
      }),
      accept: enabled.spaces.invites.accept.handler(async ({ context, input }) => {
        const user = await account(context.actor);
        const { spaceId } = await mapped(() =>
          acceptSpaceInvitation(deps.prisma, { token: input.token, user, limit: limit() }),
        );
        return { spaceId };
      }),
    },
    shares: {
      list: enabled.spaces.shares.list.handler(({ context }) =>
        mapped(() =>
          listMicoShares(deps.prisma, {
            spaceId: context.actor.spaceId,
            userId: context.actor.userId,
          }),
        ),
      ),
      set: enabled.spaces.shares.set.handler(async ({ context, input }) => {
        const { share, lostUserIds } = await mapped(() =>
          setMicoShare(deps.prisma, {
            spaceId: context.actor.spaceId,
            userId: context.actor.userId,
            share: input,
          }),
        );
        // People who lost the Mico stop at their next request; their unfinished turns stop now.
        if (lostUserIds.length)
          await stopSharedMicoTurns(deps, {
            spaceId: context.actor.spaceId,
            memberUserIds: lostUserIds,
            botId: input.botId,
          });
        return share;
      }),
    },
  };
}
