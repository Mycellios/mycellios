import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";

// An operator-only bridge, independent of the campaign's immutable cookie secret.
export function eventDemoAgentKey(environment: NodeJS.ProcessEnv = process.env): string | undefined {
  const path = environment.MYCELLIOS_EVENT_DEMO_AGENT_SECRET_FILE;
  if (!path) return undefined;
  const value = readFileSync(path, "utf8").trim();
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error("demo_agent_secret_invalid");
  return value;
}
const payload = z.object({
  event: z.string().regex(/^[a-z0-9-]{8,64}$/), guest: z.string().uuid(),
  accountId: z.string().max(160), name: z.string().min(1).max(80),
  endsAt: z.number().int().positive(), issuedAt: z.number().int().positive(),
  origin: z.string().url(), model: z.literal("mycellios/managed/antseed/deepseek-v4-flash"),
  apiKey: z.string().regex(/^myc_live_[A-Za-z0-9_-]{10}_[A-Za-z0-9_-]{43}$/),
}).strict();
export type EventAgentTicket = z.infer<typeof payload>;
const aad = Buffer.from("mycellios-event-agent-v1");
export function sealEventAgentTicket(key: string, input: EventAgentTicket) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv);
  cipher.setAAD(aad);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload.parse(input))), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
}
export function openEventAgentTicket(key: string, ticket: string, origin: string, now = Date.now()) {
  if (!/^[A-Za-z0-9_-]{80,4096}$/.test(ticket)) throw new Error("demo_agent_ticket_invalid");
  const bytes = Buffer.from(ticket, "base64url");
  const cipher = createDecipheriv("aes-256-gcm", Buffer.from(key, "hex"), bytes.subarray(0, 12));
  cipher.setAAD(aad); cipher.setAuthTag(bytes.subarray(12, 28));
  const value = payload.parse(JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString()));
  if (value.origin !== origin || value.issuedAt > now + 5000 || now - value.issuedAt > 60_000
    || value.endsAt <= now || value.endsAt - value.issuedAt > 48 * 3600_000
    || value.accountId !== `demo:${value.event}:${value.guest}`) throw new Error("demo_agent_ticket_invalid");
  return value;
}
export const eventAgentDigest = (value: string) => createHash("sha256").update(value).digest("hex");
