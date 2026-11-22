import { z } from "zod";

export const NotificationLevelSchema = z.enum(["all", "needs_me", "off"]);
export const NotificationSettingsSchema = z.object({
  level: NotificationLevelSchema.default("all"),
  previews: z.boolean().default(false),
  mutedUntil: z.string().datetime().nullable().default(null),
  bots: z.record(z.string().max(100), NotificationLevelSchema).default({}),
  /** Replies and failures in a Mico's own task conversations (not routine ones) alert too. */
  taskReplies: z.boolean().default(true),
});
export type NotificationSettings = z.infer<typeof NotificationSettingsSchema>;
export const WebPushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{87}=?$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{22}={0,2}$/),
  }),
});
export type WebPushSubscription = z.infer<typeof WebPushSubscriptionSchema>;

/**
 * What a notice is about. The first four are understood by every installed client; the later
 * ones refine a failure and travel as a detail beside one of them (see notificationBaseKind).
 */
export const NOTIFICATION_KINDS = [
  "completion",
  "failure",
  "help",
  "takeover",
  /** A message or routine run that ended before its turn could start. */
  "not_started",
  /** A helper inside a turn, or a teammate's delegated turn, ended failed. */
  "helper_failed",
  /** The model provider or the account's Credits stopped the turn at a usage limit. */
  "usage_limit",
  /** The turn needs the person to sign in to its model provider again. */
  "sign_in",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];
export type NotificationBaseKind = "completion" | "failure" | "help" | "takeover";

export function isNotificationKind(value: unknown): value is NotificationKind {
  return typeof value === "string" && (NOTIFICATION_KINDS as readonly string[]).includes(value);
}

/** The original kind that older installed workers and apps validate and render. */
export function notificationBaseKind(kind: NotificationKind): NotificationBaseKind {
  return kind === "completion" || kind === "help" || kind === "takeover" ? kind : "failure";
}

/** Durations offered by the pause controls, in minutes; null pauses until turned back on. */
export const NOTIFICATION_PAUSE_MINUTES = [15, 60, 180, 480, 1440, null] as const;
/** Stored pause end for "until turned back on", so older clients still read it as paused. */
export const NOTIFICATIONS_PAUSED_UNTIL_RESUMED = "9999-12-31T23:59:59.999Z";
export const NOTIFICATIONS_PAUSED_UNTIL_RESUMED_MS = Date.parse(NOTIFICATIONS_PAUSED_UNTIL_RESUMED);

export function notificationPauseIsIndefinite(until: string | number | null | undefined): boolean {
  const at = typeof until === "string" ? Date.parse(until) : until;
  return typeof at === "number" && at >= NOTIFICATIONS_PAUSED_UNTIL_RESUMED_MS;
}

/** A saved account pause ends within seven days, or lasts until the person turns it off. */
export function validNotificationPause(until: string | null, now = Date.now()): boolean {
  if (!until) return true;
  const at = Date.parse(until);
  return Number.isFinite(at) && (at <= now + 7 * 86400_000 || at === NOTIFICATIONS_PAUSED_UNTIL_RESUMED_MS);
}

/** A Mico's own task conversation, excluding the one each routine runs in. */
export function isTaskConversation(
  thread: { groupId: string | null; taskBotId: string | null; taskKey: string | null },
  botId: string,
): boolean {
  return !thread.groupId && thread.taskBotId === botId && !thread.taskKey?.startsWith("routine:");
}

export type NotificationScope = {
  /** The notice comes from a Mico's own task conversation that is not a routine's. */
  taskConversation?: boolean;
};

/** Kinds that still alert from a task conversation while task replies are off. */
const NEEDS_PERSON = new Set<NotificationKind>(["help", "takeover", "usage_limit", "sign_in"]);

/** A global pause/off remains authoritative over individual Mico overrides. */
export function notificationAllowed(
  settings: NotificationSettings,
  botId: string,
  kind: NotificationKind,
  now = Date.now(),
  scope: NotificationScope = {},
): boolean {
  if (settings.level === "off" || (settings.mutedUntil && Date.parse(settings.mutedUntil) > now))
    return false;
  if (scope.taskConversation && settings.taskReplies === false && !NEEDS_PERSON.has(kind))
    return false;
  const level = settings.bots[botId] ?? settings.level;
  return level === "all" || (level === "needs_me" && kind !== "completion");
}
