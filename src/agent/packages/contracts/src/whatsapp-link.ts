import * as z from "zod";
import { Id } from "./ids.js";

/**
 * WhatsApp linked device (Desktop connector). The WhatsApp session lives on
 * the owner's PC; the server keeps only which Mico answers, who may write and
 * the conversations. See specs/whatsapp-linked-device/spec.md.
 */
export const WhatsAppLinkModeSchema = z.enum(["personal", "dedicated"]);
export const WhatsAppSenderKindSchema = z.enum(["contact", "group"]);
export const WhatsAppSenderStatusSchema = z.enum(["allowed", "pending", "denied"]);

export const WhatsAppSenderSchema = z.object({
  id: Id,
  kind: WhatsAppSenderKindSchema,
  jid: z.string(),
  /** Phone number in E.164 digits for contacts, group name for groups. */
  label: z.string(),
  status: WhatsAppSenderStatusSchema,
  /** One-time approval code sent to a pending sender of a dedicated number. */
  code: z.string().nullable(),
  createdAt: z.string(),
});
export type WhatsAppSender = z.infer<typeof WhatsAppSenderSchema>;

export const WhatsAppGroupSchema = z.object({ jid: z.string(), name: z.string() });

export const WhatsAppLinkSchema = z.object({
  id: Id,
  botId: Id,
  botName: z.string(),
  mode: WhatsAppLinkModeSchema,
  phone: z.string(),
  pushName: z.string().nullable(),
  status: z.enum(["connected", "connecting", "logged_out"]),
  /** Stable Desktop device id that holds the session; only that PC can answer. */
  desktopDeviceId: z.string(),
  lastSeenAt: z.string().nullable(),
  senders: z.array(WhatsAppSenderSchema),
  /** Groups the number belongs to, as last reported by Desktop. */
  groups: z.array(WhatsAppGroupSchema),
});
export type WhatsAppLink = z.infer<typeof WhatsAppLinkSchema>;

export const WhatsAppSenderAddInput = z.union([
  z.object({ linkId: Id, kind: z.literal("contact"), phone: z.string().min(6).max(32) }),
  z.object({ linkId: Id, kind: z.literal("group"), jid: z.string().regex(/@g\.us$/) }),
]);
