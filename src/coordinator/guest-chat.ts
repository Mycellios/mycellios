import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { isIPv4, isIPv6 } from "node:net";
import { z } from "zod";
import type { GuestChatConfig } from "../core/guest-chat-config.js";
import type { MeshDatabase } from "../storage/database.js";
import type { EventDemoGateway } from "./event-demo.js";

export type GuestChatGateway = Pick<EventDemoGateway, "quote" | "execute" | "replayFor">;
export interface GuestSession { id: string; prefixDigest: string; createdAt: number; expiresAt: number; messages: number }
export interface GuestChatResult { status: "completed" | "pending"; content?: string; remaining: number }

/** Thrown for every refusal the visitor may see; anything else becomes guest_temporarily_unavailable. */
export class GuestChatError extends Error {}

const HOUR = 3_600_000, DAY = 86_400_000, CHALLENGE_TTL = 5 * 60_000;
/** Ended sessions and old counters are deleted after this; the privacy policy states it. */
export const GUEST_RETENTION_MS = 7 * DAY;
const base64url = /^[A-Za-z0-9_-]+$/;
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const equal = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const refuse = (code: string): never => { throw new GuestChatError(code); };

/** Server-owned persona. Guests never get tools, memory or the person's computer. */
export const GUEST_SYSTEM_PROMPT = [
  "You are Mico, the AI assistant inside Mycellios Agent. The person is trying Mycellios as a guest, without an account.",
  "How to talk:",
  "- Reply in the language of the conversation and match the person's tone; switch only if the person switches. Short or ambiguous messages (\"ok\", \"no sé\", \"go on\") continue the conversation in its language and topic. Be warm, natural and direct, like a capable friend, not a support bot.",
  "- Answer the actual request first. Keep everyday replies short; go longer only when the task needs it (writing, explanations, plans, code). Use Markdown lists or headings only when they help.",
  "- Vary your wording. Do not repeat greetings, disclaimers or what guest mode cannot do.",
  "- Ask one short follow-up question only when it genuinely moves the task forward.",
  "What you can do here: chat, explain, brainstorm, write and rewrite text, translate, summarise text the person pastes, plan and help with code, all inside this conversation.",
  "What needs a free account: tools and web browsing, files and images, memory across visits, the person's own Micos (agents that keep working on tasks) and the Desktop app.",
  "Mention the account only when the person asks for one of those or for something you cannot do here, in one short sentence, and still help as far as the chat allows.",
  "When the person asks for autonomous work (something on a schedule, watching for a change, research with sources, a team of Micos, building or publishing an app or website, working with their files or computer), answer in this order:",
  "1. Start with the short, concrete plan their own Mico would run: the Micos involved and their roles, the steps and tools, when it runs or checks, and what the person receives and when (a few bullets).",
  "2. Then do the part you can do right now in this chat: a first draft, a template, the questions you need answered, or a minimal working version.",
  "3. End with one short line saying a free account lets their Mico do it by itself (build and publish, run on a schedule, keep watching).",
  "Your answer has a length limit, so keep any code compact and complete: a minimal working version, never a long file cut off halfway. Do not send the person to outside hosting, schedulers or tools for something their Mico does. Never pretend it is already running.",
  "About Mycellios, if asked: an independent AI platform where people create Micos, AI agents that plan, research, write and keep working on their tasks. It also runs on a distributed network where people can share their computer's power and earn credits.",
  "Do not invent prices, features or facts you are unsure of. Never claim to have browsed, run code, saved anything or acted outside this conversation.",
].join("\n");

/** /24 for IPv4 (including IPv4-mapped IPv6) and /64 for IPv6. */
export function networkPrefix(address: string): string {
  let value = address.trim().toLowerCase().replace(/%.*$/, "");
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(value);
  if (mapped) value = mapped[1]!;
  if (isIPv4(value)) return value.split(".").slice(0, 3).join(".") + ".0/24";
  if (!isIPv6(value)) return "unknown";
  const [head = "", tail] = value.split("::");
  const left = head ? head.split(":") : [], right = tail ? tail.split(":") : [];
  const groups = tail === undefined ? left : [...left, ...Array(8 - left.length - right.length).fill("0"), ...right];
  return groups.slice(0, 4).map(group => parseInt(group || "0", 16).toString(16)).join(":") + "::/64";
}

export function leadingZeroBits(hex: string): number {
  let bits = 0;
  for (const char of hex) {
    const nibble = parseInt(char, 16);
    if (nibble === 0) { bits += 4; continue; }
    return bits + Math.clz32(nibble) - 28;
  }
  return bits;
}

export function guestChatInputSchema(config: GuestChatConfig) {
  return z.object({
    key: z.string().uuid(),
    messages: z.array(z.discriminatedUnion("role", [
      z.object({ role: z.literal("user"), content: z.string().trim().min(1).max(config.messageChars) }).strict(),
      z.object({ role: z.literal("assistant"), content: z.string().trim().min(1).max(16_000) }).strict(),
    ])).min(1).max(config.historyMessages),
  }).strict().refine(value => value.messages.at(-1)?.role === "user", "Last message must be from the user")
    .refine(value => Buffer.byteLength(JSON.stringify(value.messages)) <= config.historyBytes, "History is too large");
}

const sessionFrom = (row: Record<string, unknown>): GuestSession => ({ id: String(row.id), prefixDigest: String(row.prefix_digest),
  createdAt: Number(row.created_at), expiresAt: Number(row.expires_at), messages: Number(row.messages) });

/**
 * Text-only chat for visitors without an account (specs/guest-chat/spec.md). It runs on the
 * exact-zero managed free route under a synthetic `guest:<session>` account, never takes a
 * priced offer or retries another free seller, and stores counters and digests only.
 */
export class GuestChat {
  private ready = false;
  private readonly active = new Set<string>();
  readonly input: ReturnType<typeof guestChatInputSchema>;
  constructor(readonly config: GuestChatConfig, private readonly db: MeshDatabase,
    private readonly gateway: GuestChatGateway | undefined, private readonly now = Date.now) {
    this.input = guestChatInputSchema(config);
  }

  /** Missing owner tables or a missing free route leave guest chat unavailable, never crash startup. */
  async initialize(): Promise<boolean> {
    try {
      if (!this.gateway || this.db.raw.dialect !== "postgres") return this.ready = false;
      for (const table of ["guest_chat_sessions", "guest_chat_usage"]) {
        await this.db.raw.prepare(`SELECT 1 FROM ${table} LIMIT 0`).all();
        const policy = await this.db.raw.prepare(`SELECT c.relrowsecurity AS protected FROM pg_class c
          JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=current_schema() AND c.relname=?`).get(table);
        if (!policy?.protected) return this.ready = false;
      }
      return this.ready = true;
    } catch { return this.ready = false; }
  }
  available() { return this.ready; }
  private requireReady() { if (!this.ready) refuse("guest_chat_unavailable"); }
  private mac(label: string, value: string) {
    return createHmac("sha256", this.config.secret).update(label + ":" + value).digest("base64url");
  }
  prefixDigest(address: string) { return this.mac("guest-prefix", networkPrefix(address)).slice(0, 32); }
  token(id: string) { return id + "." + this.mac("guest-token", id); }

  /** Public settings and a fresh signed proof-of-work challenge. Starts no inference. */
  publicConfig() {
    if (!this.ready) return { enabled: false as const };
    const payload = Buffer.from(JSON.stringify({ v: 1, n: randomBytes(16).toString("base64url"),
      e: this.now() + CHALLENGE_TTL, d: this.config.powDifficulty })).toString("base64url");
    return { enabled: true as const, limits: { messagesPerSession: this.config.messagesPerSession,
      messageChars: this.config.messageChars, historyMessages: this.config.historyMessages,
      historyBytes: this.config.historyBytes }, challenge: { token: payload + "." + this.mac("guest-challenge", payload),
      difficulty: this.config.powDifficulty, expiresAt: this.now() + CHALLENGE_TTL } };
  }
  verifyChallenge(token: string, solution: string) {
    const [payload, mac, extra] = token.split(".");
    if (!payload || !mac || extra || token.length > 512 || !base64url.test(payload) || !/^[0-9]{1,12}$/.test(solution)
      || !equal(this.mac("guest-challenge", payload), mac)) refuse("guest_challenge_invalid");
    let value: { v?: unknown; e?: unknown; d?: unknown };
    try { value = JSON.parse(Buffer.from(payload!, "base64url").toString("utf8")); } catch { return refuse("guest_challenge_invalid"); }
    if (value.v !== 1 || typeof value.e !== "number" || value.e <= this.now() || value.d !== this.config.powDifficulty
      || leadingZeroBits(sha256(token + ":" + solution)) < this.config.powDifficulty) refuse("guest_challenge_invalid");
  }

  /** Creates or resumes (same browser nonce) a guest session after a solved challenge. */
  async enter(input: { nonce: string; challenge: string; solution: string }, address: string) {
    this.requireReady();
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(input.nonce)) refuse("guest_request_invalid");
    this.verifyChallenge(input.challenge, input.solution);
    const nonceHash = sha256("guest-nonce:" + input.nonce), challengeHash = sha256(input.challenge);
    const prefixDigest = this.prefixDigest(address), now = this.now();
    // Sessions and counters are kept at most GUEST_RETENTION_MS after they end.
    await this.prune(now);
    const session = await this.db.transaction(async () => {
      const previous = await this.db.raw.prepare("SELECT * FROM guest_chat_sessions WHERE nonce_hash=?").get(nonceHash);
      if (previous && previous.state === "active" && Number(previous.expires_at) > now) return sessionFrom(previous);
      if (previous) refuse("guest_session_expired");
      if (await this.db.raw.prepare("SELECT 1 FROM guest_chat_sessions WHERE challenge_hash=?").get(challengeHash))
        refuse("guest_challenge_invalid");
      if (!(await this.bump(now - now % HOUR, "sessions:" + prefixDigest, this.config.sessionsPerPrefixHour)))
        refuse("guest_sessions_limit");
      const id = randomUUID(), expiresAt = now + this.config.sessionHours * HOUR;
      await this.db.raw.prepare(`INSERT INTO guest_chat_sessions
        (id,token_hash,nonce_hash,challenge_hash,prefix_digest,created_at,expires_at,messages,state) VALUES (?,?,?,?,?,?,?,0,'active')`)
        .run(id, sha256(this.token(id)), nonceHash, challengeHash, prefixDigest, now, expiresAt);
      return { id, prefixDigest, createdAt: now, expiresAt, messages: 0 };
    });
    return { session, token: this.token(session.id) };
  }
  private lastPrune = 0;
  private async prune(now: number) {
    if (now - this.lastPrune < HOUR) return;
    this.lastPrune = now;
    // Cleanup never blocks admission; it is retried an hour later.
    try {
      await this.db.raw.prepare("DELETE FROM guest_chat_sessions WHERE expires_at < ?").run(now - GUEST_RETENTION_MS);
      await this.db.raw.prepare("DELETE FROM guest_chat_usage WHERE bucket < ?").run(now - GUEST_RETENTION_MS - DAY);
    } catch { this.lastPrune = now - HOUR + 60_000; }
  }
  async authenticate(token: string | undefined): Promise<GuestSession> {
    this.requireReady();
    if (!token || token.length > 160) return refuse("guest_session_required");
    const [id, mac, extra] = token.split(".");
    if (!id || !mac || extra || !/^[0-9a-f-]{36}$/.test(id) || !equal(this.token(id), token)) return refuse("guest_session_required");
    const row = await this.db.raw.prepare("SELECT * FROM guest_chat_sessions WHERE id=? AND token_hash=?").get(id, sha256(token!));
    if (!row) refuse("guest_session_required");
    if (row!.state !== "active" || Number(row!.expires_at) <= this.now()) refuse("guest_session_expired");
    return sessionFrom(row!);
  }
  status(session: GuestSession) {
    return { remaining: Math.max(0, this.config.messagesPerSession - session.messages),
      limit: this.config.messagesPerSession, expiresAt: session.expiresAt };
  }

  /** One bounded counter row per bucket and scope; false when the limit is reached. */
  private async bump(bucket: number, scope: string, limit: number) {
    const result = await this.db.raw.prepare(`INSERT INTO guest_chat_usage (bucket,scope,count) VALUES (?,?,1)
      ON CONFLICT(bucket,scope) DO UPDATE SET count=guest_chat_usage.count+1 WHERE guest_chat_usage.count < ?`)
      .run(bucket, scope, limit);
    return Number(result.changes) === 1;
  }
  /** Session, prefix and global counters move together or not at all. */
  private async admit(session: GuestSession) {
    const now = this.now(), day = now - now % DAY;
    await this.db.transaction(async () => {
      const counted = await this.db.raw.prepare(`UPDATE guest_chat_sessions SET messages=messages+1
        WHERE id=? AND state='active' AND expires_at>? AND messages<?`).run(session.id, now, this.config.messagesPerSession);
      if (Number(counted.changes) !== 1) {
        const row = await this.db.raw.prepare("SELECT expires_at,state FROM guest_chat_sessions WHERE id=?").get(session.id);
        refuse(!row || row.state !== "active" || Number(row.expires_at) <= now ? "guest_session_expired" : "guest_session_limit_reached");
      }
      if (!(await this.bump(day, "global", this.config.messagesPerDay))) refuse("guest_daily_budget_reached");
      if (!(await this.bump(day, "prefix:" + session.prefixDigest, this.config.messagesPerPrefixDay))) refuse("guest_prefix_daily_limit");
    });
    return day;
  }
  /** A turn that provably did no work (nothing submitted, or the free seller refused) gives its message back. */
  private async refund(session: GuestSession, day: number) {
    await this.db.transaction(async () => {
      await this.db.raw.prepare("UPDATE guest_chat_sessions SET messages=messages-1 WHERE id=? AND messages>0").run(session.id);
      await this.db.raw.prepare("UPDATE guest_chat_usage SET count=count-1 WHERE bucket=? AND scope IN (?,?) AND count>0")
        .run(day, "global", "prefix:" + session.prefixDigest);
    });
  }

  async chat(session: GuestSession, value: unknown, chunk?: (value: Record<string, unknown>) => void): Promise<GuestChatResult> {
    this.requireReady();
    const parsed = this.input.safeParse(value);
    if (!parsed.success) refuse("guest_request_invalid");
    const input = parsed.data!;
    const accountId = "guest:" + session.id, key = "guest-chat:" + input.key;
    const request = { model: this.config.model, messages: [{ role: "system" as const, content: GUEST_SYSTEM_PROMPT },
      ...input.messages], max_tokens: this.config.maxOutputTokens, stream: true };
    const gateway = this.gateway!;
    const replay = await gateway.replayFor(accountId, key, request).catch(() => refuse("guest_request_invalid"));
    if (replay) return this.result(replay, session);
    if (this.active.has(session.id)) refuse("guest_request_in_progress");
    if (this.active.size >= this.config.concurrentTurns) refuse("guest_busy");
    this.active.add(session.id);
    try {
      let quote: Awaited<ReturnType<GuestChatGateway["quote"]>>;
      try { quote = await gateway.quote(accountId, request); }
      catch (error) {
        const message = (error as Error).message;
        return refuse(message === "managed_free_daily_limit_reached" ? "guest_session_limit_reached"
          : message === "managed_request_too_large" ? "guest_request_invalid" : "guest_busy");
      }
      // Guests are never charged: a priced quote means the free route is gone.
      if (quote.maximumMicrounits !== 0) refuse("guest_busy");
      const day = await this.admit(session);
      session.messages += 1;
      try {
        // Like accounts, a guest turn refused by a free seller moves down to the next strongest free
        // route (never a priced one); only when every retry is refused does the message come back.
        const result = await gateway.execute(accountId, null, key, request, quote.token, chunk);
        return this.result(result, session);
      } catch (error) {
        // execute() throws only before submission or after the seller refused before any work.
        await this.refund(session, day);
        session.messages -= 1;
        return refuse((error as Error).message === "managed_free_tier_exhausted" ? "guest_busy" : "guest_temporarily_unavailable");
      }
    } finally { this.active.delete(session.id); }
  }
  private result(value: { status: string; response?: Record<string, unknown> }, session: GuestSession): GuestChatResult {
    const remaining = Math.max(0, this.config.messagesPerSession - session.messages);
    const choices = value.response?.choices;
    const content = Array.isArray(choices) ? (choices[0] as { message?: { content?: unknown } } | undefined)?.message?.content : undefined;
    if (value.status === "completed" && typeof content === "string") return { status: "completed", content, remaining };
    return { status: "pending", remaining };
  }
}
