import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:http";
import { z } from "zod";
import { effectiveMicoSettings, MicoSettingsState, RoutineSchema, ThreadSnapshotSchema } from "@rakazo/contracts";

const Id = z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/);
const base = { botId: Id, nonce: z.string().min(1).max(128) };
export const LocalScriptRequest = z.discriminatedUnion("action", [
  z.object({ ...base, action: z.literal("send"), text: z.string().trim().min(1).max(16000) }).strict(),
  z.object({ ...base, action: z.literal("routine"), routineId: Id }).strict(),
  z.object({ ...base, action: z.literal("answer"), runId: Id, messageId: Id, answer: z.string().min(1).max(16000) }).strict(),
  z.object({ ...base, action: z.literal("approval"), runId: Id, messageId: Id, decision: z.enum(["allow", "deny"]) }).strict(),
]);
export type ScriptBinding = { server: string; owner: string; space: string };
export type ScriptSession = { binding: ScriptBinding; rpc: (path: string, input?: unknown) => Promise<unknown>; valid: () => Promise<boolean> };
export type LocalScriptsState = { enabled: boolean; requestsPerHour: number; endpoint: string | null; configPath: string };
const Binding = z.object({ server: z.string().url(), owner: z.string().min(1), space: z.string().min(1) });
const Config = z.object({ schema: z.literal(1), binding: Binding.nullable(), token: z.string().regex(/^[a-f0-9]{64}$/).nullable(), requestsPerHour: z.union([z.literal(10), z.literal(30), z.literal(60), z.literal(120)]) });
const same = (a: ScriptBinding | null, b: ScriptBinding | null) => a !== null && b !== null && a.server === b.server && a.owner === b.owner && a.space === b.space;
const ONE_HOUR = 3600000;

/** OS-local automation. No token, cookie, RPC proxy or arbitrary target is exposed to a renderer. */
export class LocalScriptsHost {
  private config: z.infer<typeof Config> = { schema: 1, binding: null, token: null, requestsPerHour: 30 };
  private buckets: Record<string, number[]> = {};
  private server: Server | undefined;
  private endpoint: string | null = null;
  private serial: Promise<unknown> = Promise.resolve();
  constructor(private ports: {
    configPath: string;
    read: (kind: "config" | "quota") => Promise<string | null>;
    write: (kind: "config" | "quota", raw: string) => Promise<void>;
    session: () => Promise<ScriptSession | null>;
    now?: () => number;
  }) {}
  private locked<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.serial.then(fn); this.serial = next.catch(() => undefined); return next;
  }
  private now() { return this.ports.now?.() ?? Date.now(); }
  async start() {
    const [saved, quota] = await Promise.all([this.ports.read("config"), this.ports.read("quota")]);
    if (saved) this.config = Config.parse(JSON.parse(saved));
    if (quota) this.buckets = z.record(z.string(), z.array(z.number().int().nonnegative()).max(120)).parse(JSON.parse(quota));
    this.server = createServer((req, res) => {
      const fail = (status: number) => { res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify({ error: status === 429 ? "Rate limit reached" : "Local script request refused" })); };
      // Refuse browser fetches and DNS rebinding, including same-origin localhost pages.
      if (req.method !== "POST" || req.url !== "/v1/action" || req.headers.host !== new URL(this.endpoint!).host ||
        req.headers.origin || req.headers["sec-fetch-site"] || req.headers["sec-fetch-mode"] ||
        req.socket.remoteAddress !== "127.0.0.1" || req.headers["content-type"] !== "application/json") { req.resume(); return fail(403); }
      const supplied = req.headers.authorization?.replace(/^Bearer /, "") ?? "";
      const token = this.config.token;
      if (!token || !/^[a-f0-9]{64}$/.test(supplied) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))) { req.resume(); return fail(401); }
      let bytes = 0; const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes <= 65536) chunks.push(chunk); });
      req.on("end", () => {
        if (bytes > 65536) return fail(413);
        let input: unknown;
        try { input = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return fail(400); }
        void this.perform(input, supplied).then(result => {
          res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(result));
        }, error => fail(error instanceof LocalScriptRateError ? 429 : 403));
      });
      req.on("error", () => { if (!res.headersSent) fail(400); });
    });
    this.server.requestTimeout = 10000; this.server.headersTimeout = 10000;
    this.server.maxConnections = 16;
    await new Promise<void>((resolve, reject) => { this.server!.once("error", reject); this.server!.listen(0, "127.0.0.1", resolve); });
    const address = this.server.address();
    if (!address || typeof address === "string") throw new Error("No local script address");
    this.endpoint = `http://127.0.0.1:${address.port}/v1/action`;
    await this.saveConfig();
  }
  private saveConfig() { return this.ports.write("config", JSON.stringify({ ...this.config, endpoint: this.endpoint })); }
  async state(): Promise<LocalScriptsState> {
    const session = await this.ports.session();
    return { enabled: Boolean(this.config.token && same(this.config.binding, session?.binding ?? null)), requestsPerHour: this.config.requestsPerHour,
      endpoint: this.endpoint, configPath: this.ports.configPath };
  }
  configure(raw: unknown) {
    const patch = z.object({ enabled: z.boolean().optional(), requestsPerHour: Config.shape.requestsPerHour.optional() }).strict().parse(raw);
    return this.locked(async () => {
      const session = await this.ports.session();
      if (!session || !await session.valid()) throw new Error("Sign in to this Space first.");
      const previous = this.config;
      this.config = { ...previous, ...(patch.requestsPerHour ? { requestsPerHour: patch.requestsPerHour } : {}),
        ...(patch.enabled === true ? { binding: session.binding, token: randomBytes(32).toString("hex") } : patch.enabled === false ? { binding: null, token: null } : {}) };
      try { await this.saveConfig(); } catch (error) { this.config = previous; throw error; }
      return this.state();
    });
  }
  perform(raw: unknown, token: string) {
    return this.locked(async () => {
      const input = LocalScriptRequest.parse(raw), session = await this.ports.session();
      if (!this.config.token || token !== this.config.token || !session || !same(this.config.binding, session.binding) || !await session.valid()) throw new Error("Local scripts are not enabled for this session.");
      const policy = MicoSettingsState.parse(await session.rpc("preferences/micos"));
      if (policy.ownerId !== session.binding.owner || policy.spaceId !== session.binding.space) throw new Error("The authenticated account changed.");
      const bot = policy.bots.find(bot => bot.id === input.botId);
      if (!bot || !effectiveMicoSettings(policy.defaults, bot.preferences).localScripts) throw new Error("Local scripts are not allowed for this Mico.");
      const key = JSON.stringify([session.binding.server, session.binding.owner, session.binding.space, input.botId]);
      const now = this.now();
      // A clock rollback fails closed until the persisted timestamp catches up.
      const bucket = (this.buckets[key] ?? []).filter(at => at > now - ONE_HOUR);
      if (bucket.some(at => at > now) || bucket.length >= this.config.requestsPerHour) throw new LocalScriptRateError();
      const next = Object.fromEntries(Object.entries(this.buckets).map(([k, v]) => [k, v.filter(at => at > now - ONE_HOUR)]).filter(([, v]) => (v as number[]).length));
      next[key] = [...bucket, now];
      await this.ports.write("quota", JSON.stringify(next)); this.buckets = next;
      const invoke = async (path: string, value: unknown) => {
        if (!await session.valid() || !same(this.config.binding, session.binding)) throw new Error("The application session changed.");
        return session.rpc(path, value);
      };
      if (input.action === "routine") {
        const routines = z.array(RoutineSchema).parse(await invoke("routines/list", { botId: input.botId }));
        if (!routines.some(routine => routine.id === input.routineId && routine.botId === input.botId)) throw new Error("Routine is outside this Mico.");
        return invoke("routines/testRun", { routineId: input.routineId, clientNonce: `local:${input.nonce}` });
      }
      if (input.action === "send") return invoke("threads/send", { botId: input.botId, text: input.text, delivery: "queue", clientNonce: `local:${input.nonce}` });
      const snapshot = ThreadSnapshotSchema.parse(await invoke("threads/get", { botId: input.botId }));
      const message = snapshot.messages.find(message => message.id === input.messageId && message.runId === input.runId);
      const ask = message?.blocks.find(block => block.kind === "ask");
      if (!ask || ask.kind !== "ask" || ask.status === "answered" || ask.answer !== undefined || ask.dismissed) throw new Error("This question is not pending in this Mico.");
      const isApproval = Boolean(ask.approvalEffectId);
      if (isApproval !== (input.action === "approval")) throw new Error("Use the approval action for an approval card.");
      return invoke("threads/answer", { botId: input.botId, runId: input.runId, messageId: input.messageId,
        answer: input.action === "approval" ? input.decision : input.answer, clientNonce: `local:${input.nonce}` });
    });
  }
  async close() { this.server?.closeAllConnections(); await new Promise<void>(resolve => this.server ? this.server.close(() => resolve()) : resolve()); this.server = undefined; }
}
export class LocalScriptRateError extends Error {}
