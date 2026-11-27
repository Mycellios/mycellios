import { z } from "zod";

/**
 * Registration-free guest chat on the web (specs/guest-chat/spec.md). Disabled
 * unless the operator sets MYCELLIOS_GUEST_CHAT_ENABLED=true; every limit is bounded.
 */
export const guestChatConfigSchema = z.object({
  publicOrigin: z.string().url(),
  /** Signs admission challenges and session tokens and keys network-prefix digests. */
  secret: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/),
  model: z.literal("mycellios/managed/free").default("mycellios/managed/free"),
  messagesPerSession: z.number().int().min(1).max(100).default(12),
  sessionHours: z.number().int().min(1).max(72).default(24),
  historyMessages: z.number().int().min(2).max(20).default(8),
  historyBytes: z.number().int().min(4096).max(65_536).default(24_576),
  messageChars: z.number().int().min(200).max(8000).default(4000),
  maxOutputTokens: z.number().int().min(64).max(2048).default(800),
  sessionsPerPrefixHour: z.number().int().min(1).max(100).default(5),
  messagesPerPrefixDay: z.number().int().min(1).max(1000).default(40),
  messagesPerDay: z.number().int().min(1).max(100_000).default(2000),
  concurrentTurns: z.number().int().min(1).max(256).default(16),
  /** Leading zero bits of the admission proof of work (16 ≈ 65k SHA-256 digests on average). */
  powDifficulty: z.number().int().min(8).max(26).default(16),
}).strict().superRefine((value, ctx) => {
  const url = new URL(value.publicOrigin);
  if (url.origin !== value.publicOrigin || (url.protocol !== "https:" &&
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)))
    ctx.addIssue({ code: "custom", message: "Guest chat requires a canonical HTTPS or loopback origin" });
  if (value.messagesPerPrefixDay > value.messagesPerDay)
    ctx.addIssue({ code: "custom", message: "A network prefix cannot exceed the global guest budget" });
});
export type GuestChatConfig = z.infer<typeof guestChatConfigSchema>;

export function readGuestChatConfig(env: NodeJS.ProcessEnv): GuestChatConfig | undefined {
  if (env.MYCELLIOS_GUEST_CHAT_ENABLED !== "true") return undefined;
  return guestChatConfigSchema.parse(JSON.parse(env.MYCELLIOS_GUEST_CHAT_CONFIG_JSON ?? "null"));
}
