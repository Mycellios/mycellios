import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

// An operator-only bridge, independent of the campaign's immutable cookie secret.
export function eventDemoAgentKey(environment: NodeJS.ProcessEnv = process.env): string | undefined {
  const path = environment.MYCELLIOS_EVENT_DEMO_AGENT_SECRET_FILE;
  if (!path) return undefined;
  const value = readFileSync(path, "utf8").trim();
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error("demo_agent_secret_invalid");
  return value;
}
export interface EventAgentTicket {
  event: string; guest: string; accountId: string; name: string; endsAt: number; issuedAt: number;
  origin: string; model: "mycellios/managed/antseed/deepseek-v4-flash"; apiKey: string;
}
function parseTicket(input: unknown): EventAgentTicket {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("demo_agent_ticket_invalid");
  const v = input as Record<string, unknown>;
  if (Object.keys(v).sort().join(",") !== "accountId,apiKey,endsAt,event,guest,issuedAt,model,name,origin"
    || typeof v.event !== "string" || !/^[a-z0-9-]{8,64}$/.test(v.event)
    || typeof v.guest !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v.guest)
    || typeof v.accountId !== "string" || v.accountId.length > 160
    || typeof v.name !== "string" || !v.name || v.name.length > 80
    || typeof v.origin !== "string" || v.origin.length > 256
    || !Number.isSafeInteger(v.endsAt) || !Number.isSafeInteger(v.issuedAt)
    || Number(v.endsAt) <= 0 || Number(v.issuedAt) <= 0
    || v.model !== "mycellios/managed/antseed/deepseek-v4-flash"
    || typeof v.apiKey !== "string" || !/^myc_live_[A-Za-z0-9_-]{10}_[A-Za-z0-9_-]{43}$/.test(v.apiKey)) throw new Error("demo_agent_ticket_invalid");
  if (new URL(v.origin).origin !== v.origin) throw new Error("demo_agent_ticket_invalid");
  return v as unknown as EventAgentTicket;
}
const aad = Buffer.from("mycellios-event-agent-v1");
export function sealEventAgentTicket(key: string, input: EventAgentTicket) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv);
  cipher.setAAD(aad);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(parseTicket(input))), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
}
export function openEventAgentTicket(key: string, ticket: string, origin: string, now = Date.now()) {
  if (!/^[A-Za-z0-9_-]{80,4096}$/.test(ticket)) throw new Error("demo_agent_ticket_invalid");
  const bytes = Buffer.from(ticket, "base64url");
  const cipher = createDecipheriv("aes-256-gcm", Buffer.from(key, "hex"), bytes.subarray(0, 12));
  cipher.setAAD(aad); cipher.setAuthTag(bytes.subarray(12, 28));
  const value = parseTicket(JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString()));
  if (value.origin !== origin || value.issuedAt > now + 5000 || now - value.issuedAt > 60_000
    || value.endsAt <= now || value.endsAt - value.issuedAt > 48 * 3600_000
    || value.accountId !== `demo:${value.event}:${value.guest}`) throw new Error("demo_agent_ticket_invalid");
  return value;
}
export const eventAgentDigest = (value: string) => createHash("sha256").update(value).digest("hex");
