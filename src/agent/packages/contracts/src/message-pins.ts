import * as z from "zod";
import { Id } from "./ids.js";

/** How many pins one conversation holds, whoever made them. */
export const MESSAGE_PINS_PER_CONVERSATION = 100;
/** The combined list of one Mico's pins across its main chat and side conversations. */
export const MICO_PINS_LIST_LIMIT = 200;

/** A pin in one conversation. Older servers omit who pinned it (the person). */
export const MessagePinSchema = z.object({
  messageId: Id,
  seq: z.number().int().nonnegative(),
  role: z.enum(["user", "bot"]),
  preview: z.string().max(800),
  createdAt: z.string(),
  pinnedAt: z.string(),
  /** The person's own Mico pinned it; null or absent is the person's pin. */
  pinnedByBotId: Id.nullable().optional(),
  pinnedByName: z.string().optional(),
});
export type MessagePin = z.infer<typeof MessagePinSchema>;

/** A pin in the combined list, with the conversation it belongs to. */
export const MicoMessagePinSchema = MessagePinSchema.extend({
  threadId: Id,
  /** Null for the Mico's main chat. */
  taskThreadId: Id.nullable(),
  conversationTitle: z.string(),
  archived: z.boolean(),
});
export type MicoMessagePin = z.infer<typeof MicoMessagePinSchema>;
