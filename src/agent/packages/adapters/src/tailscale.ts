import { assertTailnetUrl, safeTailscaleAuthUrl, type TailnetConnection } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import type { RemoteTransportDependencies } from "./remote-mcp.js";
import { createSafeRemoteFetch } from "./remote-mcp.js";

type Scope = { spaceId: string; userId: string; botId?: string; signal?: AbortSignal };
type Server = { id: string; endpoint: string | null; networkId?: string | null; networkOAuthOrigins?: unknown };
type DeviceStatus = Pick<TailnetConnection, "status" | "authUrl" | "deviceName">;
const unavailable: DeviceStatus = { status: "unavailable", authUrl: null, deviceName: null };
export class TailnetError extends Error {}

export class TailnetService {
  private readonly watched = new Map<string, { scope: Scope; suffix: string }>();
  private reaper?: ReturnType<typeof setInterval>;
  private reaping = false;
  private reconcileTask?: Promise<void>;
  constructor(readonly prisma: PrismaClient, private readonly gateway?: {
    url: string; key: string; fetch?: typeof fetch;
  }) {}
  get available() { return Boolean(this.gateway); }
  private watch(id: string, scope: Scope, suffix: string) {
    this.watched.set(id, { scope: { userId: scope.userId, spaceId: scope.spaceId }, suffix });
    if (this.reaper) return;
    this.reaper = setInterval(() => {
      if (this.reaping) return;
      this.reaping = true;
      this.reconcileTask = this.reconcile().catch(() => undefined).finally(() => { this.reaping = false; });
    }, 15_000);
    this.reaper.unref?.();
  }
  /** Stop known devices after membership, network or company-policy revocation. */
  async reconcile() {
    const { runAsTenant } = await import("@rakazo/db");
    for (const [id, entry] of this.watched) {
      try { await runAsTenant(entry.scope, () => this.authorize(id, entry.scope)); }
      catch {
        try { await this.control(id, entry.suffix, "remove"); this.watched.delete(id); }
        catch { /* Admission already fails closed; retry device cleanup later. */ }
      }
    }
  }
  async close() {
    if (this.reaper) clearInterval(this.reaper);
    await this.reconcileTask;
    this.watched.clear();
  }

  async member(scope: Scope) {
    const member = await this.prisma.spaceMember.findFirst({ where: {
      spaceId: scope.spaceId, userId: scope.userId,
    } });
    if (!member) throw new TailnetError("Tailscale access is not authorized");
    return member;
  }
  async admin(scope: Scope) {
    return ["owner", "admin"].includes((await this.member(scope)).role);
  }
  async row(id: string, scope: Scope) {
    await this.member(scope);
    const row = await this.prisma.tailnetConnection.findFirst({ where: {
      id, spaceId: scope.spaceId, userId: scope.userId,
    } });
    if (!row) throw new TailnetError("Tailscale access is not authorized");
    return row;
  }
  async companyAllowed(scope: Scope, dnsSuffix: string) {
    const policy = await this.prisma.tailnetPolicy.findFirst({ where: {
      spaceId: scope.spaceId, dnsSuffix, enabled: true,
    } });
    if (!policy) throw new TailnetError("A Space administrator must enable this company network");
  }
  async checkKind(scope: Scope, kind: string, dnsSuffix: string) {
    if (kind === "company") return this.companyAllowed(scope, dnsSuffix);
    const policy = await this.prisma.tailnetPolicy.findFirst({ where: { spaceId: scope.spaceId, dnsSuffix } });
    if (policy) throw new TailnetError("Use the company connection for this Space's network");
  }
  async validateBinding(id: string, scope: Scope, endpoint: string) {
    const row = await this.row(id, scope);
    await this.checkKind(scope, row.kind, row.dnsSuffix);
    assertTailnetUrl(endpoint, row.dnsSuffix);
    return row;
  }
  async authorize(id: string, scope: Scope, server?: Server) {
    const row = await this.row(id, scope);
    if (!row.enabled || !this.available) throw new TailnetError("Tailscale is disconnected");
    await this.checkKind(scope, row.kind, row.dnsSuffix);
    if (scope.botId) {
      if (!Array.isArray(row.allowedBotIds) || !row.allowedBotIds.includes(scope.botId))
        throw new TailnetError("This Mico is not authorized for the Tailscale network");
      const bot = await this.prisma.bot.findFirst({ where: {
        id: scope.botId, spaceId: scope.spaceId, userId: scope.userId, archivedAt: null,
      }, select: { id: true } });
      if (!bot) throw new TailnetError("This Mico is not authorized for the Tailscale network");
    }
    if (server) {
      const current = await this.prisma.mcpServer.findFirst({ where: {
        id: server.id, spaceId: scope.spaceId, userId: scope.userId, enabled: true,
      } });
      if (!current || current.networkId !== id || current.endpoint !== server.endpoint ||
          JSON.stringify(current.networkOAuthOrigins ?? []) !== JSON.stringify(server.networkOAuthOrigins ?? []))
        throw new TailnetError("The private MCP binding changed or was revoked");
      if (!current.endpoint) throw new TailnetError("A private MCP URL is required");
      assertTailnetUrl(current.endpoint, row.dnsSuffix);
      if (scope.botId && !await this.prisma.botMcpServer.findFirst({ where: {
        serverId: server.id, botId: scope.botId, spaceId: scope.spaceId, userId: scope.userId,
      } })) throw new TailnetError("This MCP is not assigned to the Mico");
    }
    return row;
  }
  private async control(id: string, suffix: string, action: string, body: object = {}, signal?: AbortSignal) {
    if (!this.gateway) throw new TailnetError("Tailscale gateway is not configured");
    const response = await (this.gateway.fetch ?? fetch)(
      `${this.gateway.url}/nodes/${encodeURIComponent(id)}/${action}`, {
        method: "POST", redirect: "error", cache: "no-store",
        headers: { authorization: `Bearer ${this.gateway.key}`, "content-type": "application/json" },
        body: JSON.stringify({ ...body, dnsSuffix: suffix }),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(65_000)]) : AbortSignal.timeout(20_000),
      });
    if (!response.ok && action !== "fetch") throw new TailnetError("Tailscale gateway is unavailable; try again");
    return response;
  }
  async status(id: string, scope: Scope, connect = false): Promise<TailnetConnection> {
    const row = await this.row(id, scope);
    let state: DeviceStatus = { status: "disconnected", authUrl: null, deviceName: null };
    if (connect && !this.available) throw new TailnetError("Tailscale gateway is not configured");
    await this.checkKind(scope, row.kind, row.dnsSuffix);
    const generation = connect ? (await this.prisma.tailnetConnection.update({
      where: { id }, data: { enabled: true, generation: { increment: 1 } },
    })).generation : row.generation;
    if (connect || row.enabled) {
      try {
        const response = await this.control(id, row.dnsSuffix, connect ? "connect" : "status");
        const status = await response.json() as DeviceStatus;
        const valid = ["connected", "needs_auth", "needs_approval", "wrong_tailnet"].includes(status.status);
        state = valid ? { ...status, authUrl: safeTailscaleAuthUrl(status.authUrl) } : unavailable;
        if (connect) {
          const current = await this.row(id, scope);
          if (!current.enabled || current.generation !== generation) {
            await this.control(id, row.dnsSuffix, "remove");
            throw new TailnetError("The Tailscale connection was cancelled");
          }
        }
      } catch (error) {
        if (connect) {
          await this.prisma.tailnetConnection.updateMany({ where: { id, generation }, data: { enabled: false } });
          throw error;
        }
        state = unavailable;
      }
    }
    if (connect || row.enabled) this.watch(id, scope, row.dnsSuffix);
    return { id: row.id, name: row.name, kind: row.kind as "personal" | "company",
      dnsSuffix: row.dnsSuffix, allowedBotIds: row.allowedBotIds as string[],
      enabled: connect || row.enabled, ...state };
  }
  async disconnect(id: string, scope: Scope) {
    const row = await this.row(id, scope);
    // Persist the refusal before touching the device; failed cleanup can be retried.
    await this.prisma.tailnetConnection.update({ where: { id }, data: { enabled: false, generation: { increment: 1 } } });
    await this.control(id, row.dnsSuffix, "remove");
    this.watched.delete(id);
  }
  async transport(id: string, scope: Scope, server: Server): Promise<RemoteTransportDependencies> {
    const initial = await this.authorize(id, scope, server);
    this.watch(id, scope, initial.dnsSuffix);
    const managedFetch: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      const row = await this.authorize(id, scope, server);
      const url = new URL(request.url);
      if (!url.hostname.endsWith(".ts.net")) {
        // OAuth issuers may be public (e.g. a corporate identity provider).
        // They retain the normal public-only SSRF policy; private MCPs never
        // fall through to this route and redirects stay forbidden.
        const publicFetch = createSafeRemoteFetch();
        try {
          const response = await publicFetch(request.url, {
            method: request.method, headers: request.headers,
            body: request.method === "GET" ? undefined : await request.arrayBuffer(),
            signal: AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]),
          });
          const chunks: Uint8Array[] = [];
          let total = 0;
          if (response.body) for await (const chunk of response.body) {
            total += chunk.byteLength;
            if (total > 2_000_000) {
              throw new TailnetError("OAuth response is too large");
            }
            chunks.push(chunk);
          }
          const bytes = Buffer.concat(chunks);
          return new Response([204, 205, 304].includes(response.status) ? null : bytes, {
            status: response.status, headers: response.headers,
          });
        } finally { await publicFetch.close(); }
      }
      assertTailnetUrl(request.url, row.dnsSuffix);
      const oauthOrigins = Array.isArray(server.networkOAuthOrigins) ? server.networkOAuthOrigins.filter((item): item is string => typeof item === "string") : [];
      if (!server.endpoint || ![new URL(server.endpoint).origin, ...oauthOrigins].includes(url.origin))
        throw new TailnetError("This private OAuth origin is not authorized for the MCP server");
      const body = request.method === "GET" || request.method === "HEAD" ? undefined :
        Buffer.from(await request.arrayBuffer()).toString("base64");
      if ((body?.length ?? 0) > 2_800_000) throw new TailnetError("MCP request is too large");
      const abort = new AbortController();
      let checking = false;
      const timer = setInterval(() => {
        if (checking) return;
        checking = true;
        void this.authorize(id, scope, server).catch(() => abort.abort()).finally(() => { checking = false; });
      }, 2_000);
      timer.unref?.();
      const finish = () => clearInterval(timer);
      try {
        // A cached MCP session outlives the run that created it. Only the
        // current SDK request may cancel this call, never that earlier run.
        const signal = AbortSignal.any([request.signal, abort.signal]);
        signal.addEventListener("abort", finish, { once: true });
        const response = await this.control(id, row.dnsSuffix, "fetch", {
          url: request.url, method: request.method, headers: Object.fromEntries(request.headers), body,
        }, signal);
        if (!response.body || [204, 205, 304].includes(response.status)) { finish(); return response; }
        const reader = response.body.getReader();
        return new Response(new ReadableStream({
          async pull(controller) {
            try {
              const result = await reader.read();
              if (result.done) { finish(); controller.close(); }
              else controller.enqueue(result.value);
            } catch { finish(); controller.error(new Error("Private MCP stream disconnected")); }
          },
          async cancel() { finish(); abort.abort(); await reader.cancel(); },
        }), { status: response.status, headers: response.headers });
      } catch { finish(); throw new TailnetError("Private MCP connection failed; check Tailscale access"); }
    };
    return { managedFetch };
  }
}

export function tailnetServiceFromEnv(prisma: PrismaClient, env: NodeJS.ProcessEnv = process.env) {
  const url = env.TAILSCALE_GATEWAY_URL?.replace(/\/$/, "");
  const key = env.TAILSCALE_GATEWAY_KEY;
  if (Boolean(url) !== Boolean(key) || (key && key.length < 32))
    throw new TailnetError("Configure both Tailscale gateway URL and a private key of at least 32 characters");
  if (url) {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/")
      throw new TailnetError("Invalid Tailscale gateway URL");
  }
  return new TailnetService(prisma, url && key ? { url, key } : undefined);
}
