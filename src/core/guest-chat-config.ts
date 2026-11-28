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
  // The whole guest conversation travels with every turn: 12 messages and their answers fit both
  // bounds, and 96 KiB (~27k tokens) stays inside the smallest assumed free model window (32k).
  historyMessages: z.number().int().min(2).max(200).default(24),
  historyBytes: z.number().int().min(4096).max(131_072).default(98_304),
  messageChars: z.number().int().min(200).max(8000).default(4000),
  // Room for a complete answer, including a small working app; free routes cost nothing per token.
  maxOutputTokens: z.number().int().min(64).max(2048).default(2048),
  sessionsPerPrefixHour: z.number().int().min(1).max(100).default(5),
  messagesPerPrefixDay: z.number().int().min(1).max(1000).default(40),
  messagesPerDay: z.number().int().min(1).max(100_000).default(2000),
  concurrentTurns: z.number().int().min(1).max(256).default(16),
  /** Leading zero bits of the admission proof of work (16 ≈ 65k SHA-256 digests on average). */
  powDifficulty: z.number().int().min(8).max(26).default(16),
  /**
   * Behind Cloudflare, the visitor's address is the edge's `cf-connecting-ip` header. It is read
   * only when the direct peer is inside one of these private proxy networks (IPv4 CIDR).
   */
  clientAddress: z.object({
    header: z.literal("cf-connecting-ip"),
    trustedProxies: z.array(z.string().regex(/^(?:\d{1,3}\.){3}\d{1,3}\/(?:[89]|[12]\d|3[0-2])$/)).min(1).max(8),
  }).strict().optional(),
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
