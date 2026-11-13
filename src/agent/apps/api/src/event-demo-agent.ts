import { createHmac } from "node:crypto";
import type { SecretStore } from "@rakazo/adapter-kit";
import type { PrismaClient } from "@rakazo/db";
import { bootstrapUserSpace, createRepos, runAsSystem, runAsTenant, saveModelPreference } from "@rakazo/db";
import { OPENAI_COMPATIBLE_PROVIDER_ID, productBrand } from "@rakazo/contracts";
import { serializeModelSecret } from "@rakazo/adapters";
import { eventAgentDigest, openEventAgentTicket } from "../../../../core/event-demo-agent-ticket.js";

export const DEMO_AGENT_HEADER = "x-mycellios-demo-event";
const validEvent = /^[a-z0-9-]{8,64}$/;
/** Real, isolated Agent profiles. The regular Better Auth cookie is never changed. */
export class EventDemoAgent {
  constructor(private readonly prisma: PrismaClient, private readonly secrets: SecretStore,
    private readonly key: string, private readonly origin: string, private readonly base: string,
    private readonly now = Date.now) {}
  private cookieName(event: string) { return (this.origin.startsWith("https:") ? "__Secure-" : "") + "mycellios-agent-demo-" + event; }
  private cookie(event: string, value: string, expiresAt: number) {
    return `${this.cookieName(event)}=${value}; Path=${this.base || "/"}; HttpOnly; SameSite=Strict; Max-Age=${Math.max(0, Math.floor((expiresAt - this.now()) / 1000))}${this.origin.startsWith("https:") ? "; Secure" : ""}`;
  }
  async enter(request: Request) {
    if (request.headers.get("origin") !== this.origin) throw new Error("demo_agent_access_required");
    const raw = await request.text();
    if (raw.length > 8192) throw new Error("demo_agent_ticket_invalid");
    const body = JSON.parse(raw) as { ticket?: unknown };
    if (typeof body.ticket !== "string" || Object.keys(body).length !== 1) throw new Error("demo_agent_ticket_invalid");
    const ticket = openEventAgentTicket(this.key, body.ticket, this.origin, this.now());
    const identity = eventAgentDigest(ticket.accountId), userId = "ed_" + identity.slice(0, 32);
    const token = createHmac("sha256", this.key).update("session:" + ticket.accountId).digest("base64url");
    return runAsSystem("operator-authorized temporary event Agent admission", async () => {
      await this.prisma.user.upsert({ where: { id: userId }, update: {}, create: {
        id: userId, name: ticket.name, email: identity + "@event.mycellios.invalid", emailVerified: false,
      } });
      const { spaceId } = await bootstrapUserSpace(this.prisma, { id: userId }, { signupsEnabled: "false", signupAllowlist: undefined });
      const actor = { userId, spaceId, email: identity + "@event.mycellios.invalid", isDeploymentOwner: false };
      const credentialId = "event-model-" + identity.slice(0, 32);
      // Existing credentials and choices are preserved on reload. No second grant or model call.
      if (!(await this.prisma.userModelCredential.findUnique({ where: { id: credentialId } }))) {
        const stored = await this.secrets.put(serializeModelSecret({ kind: "openai_compatible",
          baseUrl: productBrand.apiBaseUrl, apiKey: ticket.apiKey,
          headers: { "x-mycellios-funding": "contribution-credits" }, maxTokens: 1024, contextWindow: 32768,
          enabledModelIds: [ticket.model],
        }), { operationId: "event-model", traceId: "event-model", userId, spaceId, signal: request.signal });
        await this.prisma.$transaction(async tx => {
          // Serialize repeated handoffs without holding a connection during secret storage.
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${credentialId}))`;
          if (await tx.userModelCredential.findUnique({ where: { id: credentialId } })) return;
          await tx.secret.create({ data: { id: stored.id, userId, spaceId: null, kind: "model", ciphertext: stored.ciphertext } });
          await tx.userModelCredential.create({ data: { id: credentialId, userId,
            provider: OPENAI_COMPATIBLE_PROVIDER_ID, label: "Mycellios", secretId: stored.id } });
          await saveModelPreference(tx, { userId }, credentialId, ticket.model);
          await tx.userModelRoleChoice.create({ data: { userId, role: "main", position: 0,
            provider: OPENAI_COMPATIBLE_PROVIDER_ID, modelId: ticket.model, credentialId } });
        });
      }
      const bot = await runAsTenant(actor, () => createRepos(this.prisma).createBot(actor, {
        name: "Mico", title: "", description: "", instructions: "", notifyOnFinish: true,
        spawnKey: "event-demo-initial", agentEngine: "pi",
      }));
      const id = "event-session-" + identity;
      const session = { token: eventAgentDigest(token), expiresAt: new Date(ticket.endsAt), activeOrganizationId: spaceId,
        userAgent: JSON.stringify({ kind: "event-demo", event: ticket.event, spaceId }), userId };
      await this.prisma.session.upsert({ where: { id }, create: { id, ...session }, update: session });
      return { cookie: this.cookie(ticket.event, token, ticket.endsAt), id: ticket.event, spaceId,
        botId: bot.id, endsAt: ticket.endsAt };
    });
  }
  async session(request: Request) {
    const event = request.headers.get(DEMO_AGENT_HEADER);
    if (!event || !validEvent.test(event)) return null;
    if (!["GET", "HEAD"].includes(request.method) && request.headers.get("origin") !== this.origin) return null;
    const name = this.cookieName(event);
    const token = (request.headers.get("cookie") ?? "").split(";").map(v => v.trim()).find(v => v.startsWith(name + "="))?.slice(name.length + 1);
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    return runAsSystem("authenticate bounded temporary event Agent session", async () => {
      const row = await this.prisma.session.findUnique({ where: { token: eventAgentDigest(token) }, include: { user: true } });
      if (!row || !row.id.startsWith("event-session-") || row.expiresAt.getTime() <= this.now()) return null;
      const meta = JSON.parse(row.userAgent ?? "null") as { kind?: string; event?: string } | null;
      if (meta?.kind !== "event-demo" || meta.event !== event || !row.userId.startsWith("ed_")) return null;
      const { user, ...session } = row;
      // Never return the stored token digest, even to its owner.
      return { user, session: { ...session, token: "" } };
    });
  }
  async auth(request: Request, path: string): Promise<Response> {
    const session = await this.session(request);
    const headers = { "cache-control": "private, no-store" };
    if (path === "/get-session" && request.method === "GET") return Response.json(session, { headers });
    if (path === "/sign-out" && request.method === "POST" && session) {
      await runAsSystem("sign out temporary event guest only", () => this.prisma.session.delete({ where: { id: session.session.id } }));
      return Response.json({ success: true }, { headers: { ...headers, "set-cookie": this.cookie(request.headers.get(DEMO_AGENT_HEADER)!, "", 0) } });
    }
    return Response.json({ code: "TEMPORARY_EVENT_SESSION", message: "This action requires a registered account." }, { status: 403, headers });
  }
}
