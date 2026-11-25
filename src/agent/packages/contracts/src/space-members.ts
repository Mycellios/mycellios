import * as z from "zod";
import { Id, IsoDate } from "./ids.js";
import { SideThreadStateSchema } from "./side-threads.js";

/**
 * People in a Space other than Personal (specs/space-members, phase 1). The owner created the
 * Space and is never changed or removed; admins invite and remove members.
 */
export const SpaceRoleSchema = z.enum(["owner", "admin", "member"]);
export type SpaceRole = z.infer<typeof SpaceRoleSchema>;

/** Roles a person can be given; nobody becomes or stops being the owner. */
export const SpaceMemberRoleSchema = z.enum(["admin", "member"]);
export type SpaceMemberRole = z.infer<typeof SpaceMemberRoleSchema>;

export const SPACE_INVITATION_DAYS = 7;
export const DEFAULT_SPACE_MEMBER_LIMIT = 20;
export const MAX_SPACE_MEMBER_LIMIT = 100;

/** 32 random bytes, base64url. The server keeps only its SHA-256. */
export const SpaceInviteTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const SpacePersonSchema = z.object({
  userId: Id,
  name: z.string(),
  /** Owners and admins see every address; members see only the owner's and admins'. */
  email: z.string().nullable(),
  role: SpaceRoleSchema,
  joinedAt: z.string(),
  you: z.boolean(),
});
export type SpacePerson = z.infer<typeof SpacePersonSchema>;

export const SpaceInvitationKindSchema = z.enum(["email", "link"]);
export type SpaceInvitationKind = z.infer<typeof SpaceInvitationKindSchema>;

/** A pending invitation, listed for the owner and admins. */
export const SpaceInvitationSchema = z.object({
  id: Id,
  kind: SpaceInvitationKindSchema,
  email: z.string().nullable(),
  invitedBy: z.string(),
  createdAt: z.string(),
  expiresAt: z.string(),
});
export type SpaceInvitation = z.infer<typeof SpaceInvitationSchema>;

export const SpaceMembersSchema = z.object({
  spaceId: Id,
  /** The viewer's role in the Space. */
  role: SpaceRoleSchema,
  limit: z.number().int().positive(),
  people: z.array(SpacePersonSchema),
  invitations: z.array(SpaceInvitationSchema),
});
export type SpaceMembers = z.infer<typeof SpaceMembersSchema>;

export const SpaceInvitationCreateInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("email"), email: z.string().trim().toLowerCase().email().max(254) }),
  z.object({ kind: z.literal("link") }),
]);
export type SpaceInvitationCreateInput = z.infer<typeof SpaceInvitationCreateInputSchema>;

export const SpaceInvitationCreatedSchema = z.object({
  invitation: SpaceInvitationSchema,
  /** The one-use link. It is shown once: only its hash is stored. */
  url: z.url(),
  /** True when an email invitation was handed to the deployment's mail provider. */
  emailSent: z.boolean(),
});
export type SpaceInvitationCreated = z.infer<typeof SpaceInvitationCreatedSchema>;

export const SpaceInvitePreviewSchema = z.object({
  spaceId: Id,
  spaceName: z.string(),
  ownerName: z.string(),
  invitedBy: z.string(),
  expiresAt: z.string(),
  /** The signed-in account already belongs to the Space. */
  member: z.boolean(),
});
export type SpaceInvitePreview = z.infer<typeof SpaceInvitePreviewSchema>;

export const SPACE_AUDIT_EVENT_TYPES = [
  "space.invitation.created",
  "space.invitation.revoked",
  "space.member.joined",
  "space.member.left",
  "space.member.removed",
  "space.member.role_changed",
  "space.mico.shared",
] as const;
export const SpaceAuditEventTypeSchema = z.enum(SPACE_AUDIT_EVENT_TYPES);
export type SpaceAuditEventType = z.infer<typeof SpaceAuditEventTypeSchema>;

/**
 * Who a Mico is shared with (phase 1b). `none` is every Mico's default; `everyone` includes people
 * who join later; `people` lists them. Sharing gives the level `chat`.
 */
export const MicoShareAudienceSchema = z.enum(["none", "everyone", "people"]);
export type MicoShareAudience = z.infer<typeof MicoShareAudienceSchema>;

/** One membership change, with the names people had when it happened. */
export const SpaceAuditEventSchema = z.object({
  id: Id,
  type: SpaceAuditEventTypeSchema,
  actorName: z.string().nullable(),
  targetName: z.string().nullable(),
  role: SpaceMemberRoleSchema.nullable(),
  kind: SpaceInvitationKindSchema.nullable(),
  /** For a share: the Mico's name at the time and who it went to. Absent from older servers. */
  micoName: z.string().nullable().optional(),
  audience: MicoShareAudienceSchema.nullable().optional(),
  createdAt: z.string(),
});
export type SpaceAuditEvent = z.infer<typeof SpaceAuditEventSchema>;

/** Credit microunits a person may spend on one shared Mico per UTC day unless the owner says otherwise. */
export const DEFAULT_MICO_SHARE_DAILY_ALLOWANCE_MICROS = 1_000_000;
/** The largest daily allowance per person and Mico: 100 Credits. */
export const MAX_MICO_SHARE_DAILY_ALLOWANCE_MICROS = 100_000_000;

const DailyAllowanceMicros = z.number().int().min(0).max(MAX_MICO_SHARE_DAILY_ALLOWANCE_MICROS);

/** How one Mico of the Space is shared, for the Space's owner and admins. */
export const MicoShareSchema = z.object({
  botId: Id,
  name: z.string(),
  title: z.string(),
  color: z.string(),
  audience: MicoShareAudienceSchema,
  /** The people it is shared with when the audience is `people`. */
  userIds: z.array(Id),
  /** What each person may spend on it per UTC day, paid by its owner; 0 stops their messages. */
  dailyAllowanceMicros: DailyAllowanceMicros,
});
export type MicoShare = z.infer<typeof MicoShareSchema>;

export const MicoShareInputSchema = z
  .object({
    botId: Id,
    audience: MicoShareAudienceSchema,
    userIds: z.array(Id).max(MAX_SPACE_MEMBER_LIMIT).default([]),
    dailyAllowanceMicros: DailyAllowanceMicros.default(DEFAULT_MICO_SHARE_DAILY_ALLOWANCE_MICROS),
  })
  .refine(
    (input) =>
      input.audience === "people"
        ? input.userIds.length > 0 && new Set(input.userIds).size === input.userIds.length
        : input.userIds.length === 0,
    { message: "List the people only when sharing with chosen people", path: ["userIds"] },
  );
export type MicoShareInput = z.infer<typeof MicoShareInputSchema>;

/** One of the viewer's own conversations with a Mico shared with them. */
export const SharedMicoConversationSchema = z.object({
  threadId: Id,
  title: z.string(),
  state: SideThreadStateSchema,
  unread: z.boolean(),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type SharedMicoConversation = z.infer<typeof SharedMicoConversationSchema>;

/**
 * A Mico shared with the viewer: its name, avatar and title, never its settings, instructions,
 * memory, skills, connections or computer.
 */
export const SharedMicoSchema = z.object({
  botId: Id,
  name: z.string(),
  title: z.string(),
  color: z.string(),
  ownerName: z.string(),
  /** Credit microunits the viewer may still spend on it today (UTC). */
  allowanceLeftMicros: z.number().int().nonnegative(),
  conversations: z.array(SharedMicoConversationSchema),
});
export type SharedMico = z.infer<typeof SharedMicoSchema>;

export const SharedMicosSchema = z.object({ micos: z.array(SharedMicoSchema) });
export type SharedMicos = z.infer<typeof SharedMicosSchema>;

/** The viewer's own conversation with a shared Mico; their only way to reach it. */
export const SharedMicoTargetSchema = z.object({ botId: Id, taskThreadId: Id });
export type SharedMicoTarget = z.infer<typeof SharedMicoTargetSchema>;

/** Refusals a member may see, shared by the API, the worker and the clients that translate them. */
export const SHARED_MICO_UNAVAILABLE_ERROR = "This Mico is no longer shared with you.";
export const SHARED_MICO_PAUSED_ERROR = "Your messages to this Mico are paused.";
export const SHARED_MICO_ALLOWANCE_ERROR = "You reached today's limit for this Mico.";
export const SHARED_MICO_PAYER_ERROR = "This Mico can't answer members right now.";
export const SHARED_MICO_CONVERSATION_ERROR = "Only the person who started this conversation can write in it.";

/** The start of the UTC day a daily allowance counts from. */
export function allowanceDayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export const SpaceAuditInputSchema = z.object({
  /** The id of the last event on the previous page. */
  cursor: z.string().max(128).optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

/** A Space someone else owns that this account was invited to. */
export const SharedSpaceSchema = z.object({
  id: Id,
  name: z.string(),
  role: SpaceMemberRoleSchema,
  ownerName: z.string(),
});
export type SharedSpace = z.infer<typeof SharedSpaceSchema>;

/** A stored membership role as a Space role; Better Auth stores comma lists such as "owner,admin". */
export function spaceRoleOf(role: string): SpaceRole {
  const roles = role.split(",").map((value) => value.trim());
  if (roles.includes("owner")) return "owner";
  if (roles.includes("admin")) return "admin";
  return "member";
}

/** Whether `actor` may remove `target` from a Space. Nobody removes the owner. */
export function canRemoveSpacePerson(actor: SpaceRole, target: SpaceRole): boolean {
  if (target === "owner") return false;
  if (actor === "owner") return true;
  return actor === "admin" && target === "member";
}

/** Only the owner changes roles, and never their own. */
export function canChangeSpaceRole(actor: SpaceRole, target: SpaceRole): boolean {
  return actor === "owner" && target !== "owner";
}

export function canInviteToSpace(role: SpaceRole): boolean {
  return role === "owner" || role === "admin";
}
