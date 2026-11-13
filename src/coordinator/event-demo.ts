import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { EventDemoConfig } from "../core/event-demo-config.js";
import type { MeshDatabase } from "../storage/database.js";
import type { ContributionCreditWallet } from "../economy/contribution-credit-wallet.js";
import type { ApiAccessManager } from "./api-access.js";
import type { ManagedGateway } from "./managed-gateway.js";
import type { BrowserInference } from "./browser-inference.js";
import type { MobileComputeHub } from "./mobile-compute-hub.js";
import { sha256CanonicalEvidence } from "../core/json.js";

export type EventDemoGateway = Pick<ManagedGateway, "catalog" | "quote" | "execute" | "replayFor" | "reconcile">;
export interface DemoGuest { id: string; accountId: string; ordinal: number; device: string; workerId: string | null }
export const demoChatSchema = z.object({
  key: z.string().uuid(),
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(2000) }).strict()).min(1).max(12),
}).strict().refine(value => value.messages.at(-1)?.role === "user", "Last message must be from the user");
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const equal = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const guestFrom = (row: Record<string, unknown>): DemoGuest => ({ id: String(row.id), accountId: String(row.account_id),
  ordinal: Number(row.ordinal), device: String(row.device_kind), workerId: row.worker_id === null ? null : String(row.worker_id) });

/** An event capability is deliberately not a normal user, SSO session or API key. */
export class EventDemo {
  private readonly active = new Set<string>();
  constructor(readonly config: EventDemoConfig, private readonly db: MeshDatabase,
    private readonly wallet: ContributionCreditWallet, private readonly api: ApiAccessManager,
    private readonly gateway: EventDemoGateway, private readonly browser: BrowserInference | undefined,
    private readonly hub: MobileComputeHub, private readonly now = Date.now) {}

  async initialize() {
    if (this.db.raw.dialect !== "postgres") throw new Error("demo_requires_private_postgres");
    for (const table of ["economic_demo_campaigns", "economic_demo_guests"]) {
      await this.db.raw.prepare(`SELECT 1 FROM ${table} LIMIT 0`).all();
      const policy = await this.db.raw.prepare(`SELECT c.relrowsecurity AS protected FROM pg_class c
        JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=current_schema() AND c.relname=?`).get(table);
      if (!policy?.protected) throw new Error("demo_requires_private_storage");
    }
    const c = this.config;
    // A restart cannot silently replace dates, credit limits, model or capabilities.
    const digest = sha256CanonicalEvidence(c);
    await this.db.transaction(async () => {
      await this.db.raw.prepare(`INSERT INTO economic_demo_campaigns
        (id,starts_at,ends_at,max_guests,grant_microunits,config_digest,created_at) VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(id) DO NOTHING`).run(c.id, c.startsAt, c.endsAt, c.maxGuests, c.grantMicrounits, digest, this.now());
      const row = await this.db.raw.prepare("SELECT config_digest FROM economic_demo_campaigns WHERE id=?").get(c.id);
      if (row?.config_digest !== digest) throw new Error("demo_campaign_configuration_changed");
    });
  }
  isOpen() { return this.now() >= this.config.startsAt && this.now() < this.config.endsAt; }
  private requireOpen() { if (!this.isOpen()) throw new Error("demo_closed"); }
  private signed(id: string) { return id + "." + createHmac("sha256", this.config.cookieSecret).update(this.config.id + ":" + id).digest("base64url"); }
  async metadata() {
    const row = await this.db.raw.prepare("SELECT COUNT(*) AS count FROM economic_demo_guests WHERE campaign_id=?").get(this.config.id);
    const joined = Number(row?.count ?? 0);
    return { id: this.config.id, title: this.config.title, open: this.isOpen(), full: joined >= this.config.maxGuests,
      startsAt: this.config.startsAt, endsAt: this.config.endsAt, maxGuests: this.config.maxGuests, joined,
      grantMicrounits: this.config.grantMicrounits, model: this.config.model, modelName: "DeepSeek V4 Flash",
      provider: "Mycellios", processing: "external", browserInference: Boolean(this.browser?.models().length),
      inviteUrl: this.config.publicOrigin + "/agent/demo/" + this.config.id };
  }
  async enter(nonce: string, device: string) {
    this.requireOpen();
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(nonce)) throw new Error("demo_enrollment_invalid");
    const enrollment = hash(nonce);
    const guest = await this.db.transaction(async () => {
      this.requireOpen();
      const previous = await this.db.raw.prepare("SELECT * FROM economic_demo_guests WHERE campaign_id=? AND enrollment_hash=?")
        .get(this.config.id, enrollment);
      if (previous) return guestFrom(previous);
      const count = await this.db.raw.prepare("SELECT COUNT(*) AS count FROM economic_demo_guests WHERE campaign_id=?").get(this.config.id);
      const ordinal = Number(count?.count ?? 0) + 1;
      if (ordinal > this.config.maxGuests) throw new Error("demo_full");
      const id = randomUUID(), accountId = "demo:" + this.config.id + ":" + id, now = this.now();
      await this.api.getOrCreateAccount(accountId);
      await this.db.raw.prepare(`INSERT INTO economic_demo_guests
        (id,campaign_id,account_id,ordinal,enrollment_hash,device_kind,joined_at,last_seen_at) VALUES (?,?,?,?,?,?,?,?)`)
        .run(id, this.config.id, accountId, ordinal, enrollment, device, now, now);
      await this.db.raw.prepare(`INSERT INTO economic_promotional_grants
        (id,account_id,issued_by,reason,amount_microunits,created_at,expires_at) VALUES (?,?,?,?,?,?,?)`)
        .run("event-demo:" + this.config.id + ":" + id, accountId, "event-demo:" + this.config.id,
          "temporary-event-guest", this.config.grantMicrounits, now, this.config.endsAt);
      return { id, accountId, ordinal, device, workerId: null };
    });
    return { guest, token: this.signed(guest.id) };
  }
  async authenticate(token: string | undefined) {
    if (!token || token.length > 120) throw new Error("demo_session_required");
    const [id, mac, extra] = token.split(".");
    if (!id || !mac || extra || !equal(this.signed(id), token)) throw new Error("demo_session_required");
    const row = await this.db.raw.prepare("SELECT * FROM economic_demo_guests WHERE campaign_id=? AND id=?").get(this.config.id, id);
    if (!row) throw new Error("demo_session_required");
    return guestFrom(row);
  }
  async session(guest: DemoGuest) {
    const balance = await this.wallet.summary("account", guest.accountId, this.now());
    await this.db.raw.prepare("UPDATE economic_demo_guests SET last_seen_at=? WHERE id=? AND campaign_id=?")
      .run(this.now(), guest.id, this.config.id);
    return { guest: { number: guest.ordinal, name: "Invitado " + String(guest.ordinal).padStart(2, "0") },
      open: this.isOpen(), endsAt: this.config.endsAt, creditsMicrounits: balance.availableMicrounits,
      reservedMicrounits: balance.reservedMicrounits, earnedMicrounits: balance.contributionEarnedMicrounits ?? 0 };
  }
  async chat(guest: DemoGuest, value: unknown, chunk?: (value: Record<string, unknown>) => void) {
    this.requireOpen();
    const input = demoChatSchema.parse(value);
    const request = { model: this.config.model, messages: [{ role: "system" as const,
      content: "Eres Mico, el asistente de Mycellios. Responde en español salvo que te hablen en otro idioma. Sé útil, claro y breve. No tienes acceso a herramientas ni al ordenador. No afirmes que ejecutas acciones o que este modelo se ejecuta en los dispositivos de los asistentes." },
      ...input.messages], max_tokens: 256, stream: true };
    const key = "event-demo:" + input.key;
    const replay = await this.gateway.replayFor(guest.accountId, key, request);
    if (replay) return replay;
    if (this.active.has(guest.id)) throw new Error("demo_request_in_progress");
    this.active.add(guest.id);
    try {
      const quote = await this.gateway.quote(guest.accountId, request);
      if (quote.maximumMicrounits > this.config.grantMicrounits) throw new Error("demo_request_too_large");
      this.requireOpen();
      return await this.gateway.execute(guest.accountId, null, key, request, quote.token, chunk);
    } finally { this.active.delete(guest.id); }
  }
  async link(guest: DemoGuest, workerId: string, token: string) {
    this.requireOpen();
    if (!this.browser?.models().length) throw new Error("demo_browser_unavailable");
    await this.browser.bind(guest.accountId, workerId, token);
    await this.db.raw.prepare("UPDATE economic_demo_guests SET worker_id=? WHERE campaign_id=? AND id=?")
      .run(workerId, this.config.id, guest.id);
    return { linked: true };
  }
  async recover(guest: DemoGuest, key: string) {
    const stable = "event-demo:" + z.string().uuid().parse(key);
    const row = await this.db.raw.prepare("SELECT state,usage_id FROM economic_managed_purchases WHERE account_id=? AND key_digest=?")
      .get(guest.accountId, sha256CanonicalEvidence({ accountId: guest.accountId, key: stable }));
    if (!row) return { status: "not_submitted" as const };
    try { return await this.gateway.reconcile(guest.accountId, stable); }
    catch (error) {
      if ((error as Error).message === "managed_receipt_missing")
        return { status: "pending_reconciliation" as const, requestId: String(row.usage_id) };
      throw error;
    }
  }
  networkQuote(guest: DemoGuest) {
    this.requireOpen();
    const offer = this.browser?.models().find(model => "kind" in model && model.kind === "text");
    if (!offer || !this.browser) throw new Error("demo_browser_unavailable");
    const request = { kind: "text" as const, model: offer.model, prompt: "Artificial intelligence can help people", maxTokens: 4 };
    const quote = this.browser.quote(guest.accountId, request);
    if (quote.creditsMicrounits > 1000) throw new Error("demo_request_too_large");
    return { request, quote };
  }
  async networkTest(guest: DemoGuest, key: string, maximum: number) {
    z.string().uuid().parse(key);
    const { request, quote } = this.networkQuote(guest);
    if (quote.creditsMicrounits > maximum) throw new Error("demo_request_too_large");
    return this.browser!.execute(guest.accountId, null, "demo-network:" + key, request, quote.token);
  }
  networkStatus(guest: DemoGuest, key: string) {
    z.string().uuid().parse(key);
    return this.browser?.status(guest.accountId, "demo-network:" + key) ?? null;
  }
  async unlink(guest: DemoGuest) {
    // Pause disconnects the actual runtime. Keep its verified ownership so the
    // same browser can resume; permanent revocation is a different operation.
    await this.db.raw.prepare("UPDATE economic_demo_guests SET worker_id=NULL WHERE campaign_id=? AND id=?").run(this.config.id, guest.id);
    return { linked: false };
  }
  async network(view: string | undefined) {
    if (!view || !equal(view, this.config.presenterSecret)) throw new Error("demo_view_required");
    const guests = await this.db.raw.prepare(`SELECT g.ordinal,g.device_kind,g.worker_id,g.last_seen_at,
      COALESCE((SELECT SUM(c.amount_microunits) FROM economic_browser_inference_credits c WHERE c.account_id=g.account_id),0) AS earned,
      (SELECT COUNT(*) FROM economic_browser_inference_credits c WHERE c.account_id=g.account_id) AS inferences
      FROM economic_demo_guests g WHERE campaign_id=? ORDER BY ordinal LIMIT 50`).all(this.config.id);
    const workers = new Map(this.hub.listWorkers().map(worker => [worker.id, worker]));
    const devices = guests.map(row => {
      const worker = row.worker_id ? workers.get(String(row.worker_id)) : null;
      return { number: Number(row.ordinal), kind: String(row.device_kind),
        present: this.now() - Number(row.last_seen_at) < 30_000,
        connected: this.isOpen() && Boolean(worker?.connected && worker.visible && worker.status === "online"),
        working: this.isOpen() && Boolean(worker && this.hub.isFundedInferenceActive(worker.id)),
        earnedMicrounits: Number(row.earned), inferences: Number(row.inferences) };
    });
    return { ...await this.metadata(), at: this.now(), devices,
      connected: devices.filter(d => d.connected).length,
      inferences: devices.reduce((sum, d) => sum + d.inferences, 0),
      earnedMicrounits: devices.reduce((sum, d) => sum + d.earnedMicrounits, 0) };
  }
}
