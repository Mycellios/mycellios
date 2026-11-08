import { z } from "zod";

export const NotificationLevelSchema = z.enum(["all", "needs_me", "off"]);
export const NotificationSettingsSchema = z.object({
  level: NotificationLevelSchema.default("all"),
  previews: z.boolean().default(false),
  mutedUntil: z.string().datetime().nullable().default(null),
  bots: z.record(z.string().max(100), NotificationLevelSchema).default({}),
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

/** A global pause/off remains authoritative over individual Mico overrides. */
export function notificationAllowed(
  settings: NotificationSettings,
  botId: string,
  kind: "completion" | "failure" | "help" | "takeover",
  now = Date.now(),
): boolean {
  if (settings.level === "off" || (settings.mutedUntil && Date.parse(settings.mutedUntil) > now))
    return false;
  const level = settings.bots[botId] ?? settings.level;
  return level === "all" || (level === "needs_me" && kind !== "completion");
}
