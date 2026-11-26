import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { lstat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { z } from "zod";
import {
  artifactSeedServerPayloadSchemas,
  type ArtifactSeedGrant,
  type ArtifactSeedObservation,
} from "../contracts/artifact-seed.js";
import { fetchArtifactSeedBlob } from "./artifact-seed-client.js";
import { ArtifactSeedServer } from "./artifact-seed-server.js";
import { artifactSeedBlobPath, emptyArtifactSeedObservation, type ArtifactSeedStore } from "./artifact-seed-store.js";
import type { ArtifactSeedTunnelService } from "./runtime-stream-tunnel.js";

const DIGEST = /^[a-f0-9]{64}$/;
const MAX_PENDING_DEMANDS = 4;
const MAX_ENDPOINT_REQUESTS = 2;
const ENDPOINT_PATH = /^\/v1\/artifact-seed\/blobs\/([a-f0-9]{64})\?sizeBytes=([1-9][0-9]{0,15})$/;
export const ARTIFACT_SEED_ENDPOINT_TOKEN_HEADER = "x-mycellios-seed-token";

const S = artifactSeedServerPayloadSchemas;
/** Coordinator messages the worker agent admits; handled only by this peer. */
export const artifactSeedAgentMessageSchemas = [
  z.object({ v: z.literal(1), type: z.literal("artifact.seed.ready"), payload: S["artifact.seed.ready"] }).strict(),
  z.object({ v: z.literal(1), type: z.literal("artifact.seed.grant"), payload: S["artifact.seed.grant"] }).strict(),
  z.object({ v: z.literal(1), type: z.literal("artifact.seed.unavailable"), payload: S["artifact.seed.unavailable"] }).strict(),
  z.object({ v: z.literal(1), type: z.literal("artifact.seed.revoke"), payload: S["artifact.seed.revoke"] }).strict(),
  z.object({ v: z.literal(1), type: z.literal("artifact.seed.bind"), payload: S["artifact.seed.bind"] }).strict(),
] as const;

function parseServerMessage(message: unknown): { type: string; payload: unknown } | null {
  if (typeof message !== "object" || message === null) return null;
  const { type, payload } = message as { type?: unknown; payload?: unknown };
  if (typeof type !== "string" || !Object.hasOwn(artifactSeedServerPayloadSchemas, type)) return null;
  const schema = artifactSeedServerPayloadSchemas[type as keyof typeof artifactSeedServerPayloadSchemas] as z.ZodType;
  const parsed = schema.safeParse(payload);
  return parsed.success ? { type, payload: parsed.data } : null;
}

export interface ArtifactSeedPeerTunnel {
  setArtifactSeedService(service: ArtifactSeedTunnelService | null): void;
  openArtifactSeedStream(destinationNodeId: string, targetPort: number): Promise<Socket>;
}

export interface ArtifactSeedPeerOptions {
  nodeId: string;
  /** This node's stage store, `<cachePath>/stage-cas`; requested blobs land here. */
  casRoot: string;
  /** Present only when the owner opted in to seeding. */
  seed?: { store: ArtifactSeedStore; maxUploadBytesPerSecond: number } | undefined;
  demandTimeoutMs?: number;
  /** Requester-side floor for slow links; transfers above it fall back to origin. */
  minimumGoodputBytesPerSecond?: number;
  now?: () => number;
  logger?: { warn(message: string): void };
}

type RequestOutcome = { ok: true; published: boolean } | { ok: false; code: string };
type GrantAnswer = { grant: ArtifactSeedGrant; seedTargetPort: number } | { code: string };

/**
 * Worker-side artifact seeding: serves verified blobs when the owner opted in,
 * and lets local stage preparation request planned blobs from seeds. Every
 * transfer is authorized by the coordinator and re-verified by the requester.
 */
export class ArtifactSeedPeer {
  private readonly server: ArtifactSeedServer | null;
  private readonly now: () => number;
  private send: ((type: string, payload: unknown) => boolean | void) | null = null;
  private tunnel: ArtifactSeedPeerTunnel | null = null;
  private coordinatorReady = false;
  private seedingActive = false;
  private servicePort: number | null = null;
  private readonly pendingDemands = new Map<string, (answer: GrantAnswer) => void>();
  private endpoint: { server: Server; url: string; token: string } | null = null;
  private endpointRequests = 0;

  constructor(private readonly options: ArtifactSeedPeerOptions) {
    this.now = options.now ?? Date.now;
    this.server = options.seed ? new ArtifactSeedServer({
      nodeId: options.nodeId,
      store: options.seed.store,
      enabled: () => this.seedingActive,
      maxUploadBytesPerSecond: options.seed.maxUploadBytesPerSecond,
      now: this.now,
      onOutcome: (outcome) => {
        if (outcome.transferId !== undefined) {
          this.send?.("artifact.seed.complete", { transferId: outcome.transferId, ok: outcome.ok,
            ...(outcome.ok ? {} : { code: outcome.code }) });
        }
      },
    }) : null;
  }

  /** Called once by the worker agent with its authenticated session and tunnel. */
  attach(binding: { send(type: string, payload: unknown): boolean | void; tunnel: ArtifactSeedPeerTunnel | null }): void {
    this.send = binding.send;
    this.tunnel = binding.tunnel;
    this.registerTunnelService();
  }

  /** Start the loopback seed listener (seeders only). No Python, no model. */
  async start(): Promise<void> {
    if (!this.server || this.servicePort !== null) return;
    this.servicePort = await this.server.listenLoopback();
    this.options.seed!.store.setServicePort(this.servicePort);
    this.registerTunnelService();
  }

  /** Heartbeat observation; `enabled` is the live owner contribution state. */
  observe(enabled: boolean): ArtifactSeedObservation {
    this.seedingActive = enabled && this.server !== null;
    if (!enabled) this.server?.revokeAll();
    return this.options.seed ? this.options.seed.store.observe(enabled) : emptyArtifactSeedObservation(this.now());
  }

  /** Validated coordinator message for this protocol; anything else is ignored. */
  handle(message: unknown): void {
    const parsed = parseServerMessage(message);
    if (!parsed) return;
    const { type, payload } = parsed;
    switch (type) {
      case "artifact.seed.ready":
        this.coordinatorReady = true;
        break;
      case "artifact.seed.grant":
        this.acceptGrant(payload);
        break;
      case "artifact.seed.unavailable": {
        const value = payload as { demandId: string; code: string };
        this.pendingDemands.get(value.demandId)?.({ code: value.code });
        break;
      }
      case "artifact.seed.revoke":
        this.server?.revoke((payload as { transferIds: string[] }).transferIds);
        break;
      case "artifact.seed.bind": {
        const value = payload as { streamId: string; requesterNodeId: string; expiresAtMs: number };
        this.server?.bindStream(value.streamId, value.requesterNodeId, value.expiresAtMs);
        break;
      }
    }
  }

  /** The session ended; demands cannot be answered on a new session. */
  disconnected(): void {
    this.coordinatorReady = false;
    this.server?.revokeAll();
    for (const resolve of this.pendingDemands.values()) resolve({ code: "artifact_seed_disconnected" });
  }

  /**
   * Ask the coordinator for a planned seed of one blob, fetch it over the
   * authorized runtime stream and publish it only after an exact hash match.
   */
  async requestBlob(blobSha256: string, sizeBytes: number, signal?: AbortSignal): Promise<RequestOutcome> {
    if (!DIGEST.test(blobSha256) || !Number.isSafeInteger(sizeBytes) || sizeBytes < 1) {
      return { ok: false, code: "artifact_seed_request_invalid" };
    }
    if (await lstat(artifactSeedBlobPath(this.options.casRoot, blobSha256)).then(() => true, () => false)) {
      return { ok: true, published: false };
    }
    if (!this.coordinatorReady || !this.send || !this.tunnel) return { ok: false, code: "artifact_seed_unavailable" };
    if (this.pendingDemands.size >= MAX_PENDING_DEMANDS) return { ok: false, code: "artifact_seed_busy" };
    const demandId = randomUUID();
    const answer = await new Promise<GrantAnswer>((resolve) => {
      const timer = setTimeout(() => resolve({ code: "artifact_seed_demand_timeout" }), this.options.demandTimeoutMs ?? 15_000);
      timer.unref?.();
      const abort = () => resolve({ code: "artifact_seed_cancelled" });
      signal?.addEventListener("abort", abort, { once: true });
      this.pendingDemands.set(demandId, (value) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        resolve(value);
      });
      if (this.send!("artifact.seed.demand", { demandId, blobSha256, sizeBytes }) === false) {
        resolve({ code: "artifact_seed_unavailable" });
      }
    }).finally(() => this.pendingDemands.delete(demandId));
    if ("code" in answer) return { ok: false, code: answer.code };
    const { grant, seedTargetPort } = answer;
    if (grant.blobSha256 !== blobSha256 || grant.sizeBytes !== sizeBytes || grant.requesterNodeId !== this.options.nodeId) {
      this.complete(grant.transferId, false, "artifact_seed_grant_mismatch");
      return { ok: false, code: "artifact_seed_grant_mismatch" };
    }
    let socket: Socket | null = null;
    const deadline = setTimeout(() => socket?.destroy(new Error("artifact_seed_transfer_timeout")),
      30_000 + Math.ceil(sizeBytes / (this.options.minimumGoodputBytesPerSecond ?? 1024 * 1024) * 1_000));
    deadline.unref?.();
    const cancel = () => socket?.destroy(new Error("artifact_seed_cancelled"));
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      socket = await this.tunnel.openArtifactSeedStream(grant.sourceNodeId, seedTargetPort);
      const result = await fetchArtifactSeedBlob(socket, { grant, requesterNodeId: this.options.nodeId,
        casRoot: this.options.casRoot, now: this.now });
      this.complete(grant.transferId, true);
      return { ok: true, published: result.published };
    } catch (error) {
      const code = error instanceof Error && /^artifact_seed_[a-z_]+$/.test(error.message)
        ? error.message : "artifact_seed_transfer_failed";
      this.complete(grant.transferId, false, code);
      this.options.logger?.warn(code);
      return { ok: false, code };
    } finally {
      clearTimeout(deadline);
      signal?.removeEventListener("abort", cancel);
    }
  }

  /**
   * Loopback endpoint the Python stage cache asks before using its origin.
   * It is bound to 127.0.0.1 and requires a per-process random token.
   */
  async requesterEndpoint(): Promise<{ url: string; token: string }> {
    if (this.endpoint) return { url: this.endpoint.url, token: this.endpoint.token };
    const token = randomBytes(32).toString("base64url");
    const expected = createHash("sha256").update(token).digest();
    const server = createServer((request, response) => {
      const reply = (status: number, body: object) => {
        response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
        response.end(JSON.stringify(body));
      };
      const presented = request.headers[ARTIFACT_SEED_ENDPOINT_TOKEN_HEADER];
      const match = ENDPOINT_PATH.exec(request.url ?? "");
      if (request.method !== "POST" || typeof presented !== "string"
          || !timingSafeEqual(createHash("sha256").update(presented).digest(), expected)) {
        reply(403, { ok: false, code: "artifact_seed_forbidden" });
        return;
      }
      if (!match) { reply(404, { ok: false, code: "artifact_seed_request_invalid" }); return; }
      if (this.endpointRequests >= MAX_ENDPOINT_REQUESTS) { reply(429, { ok: false, code: "artifact_seed_busy" }); return; }
      this.endpointRequests += 1;
      const aborted = new AbortController();
      response.once("close", () => { if (!response.writableFinished) aborted.abort(); });
      void this.requestBlob(match[1]!, Number(match[2]), aborted.signal)
        .then(outcome => reply(outcome.ok ? 200 : 404, outcome))
        .catch(() => reply(500, { ok: false, code: "artifact_seed_transfer_failed" }))
        .finally(() => { this.endpointRequests -= 1; });
    });
    server.requestTimeout = 0;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    server.unref();
    this.endpoint = { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, token };
    return { url: this.endpoint.url, token };
  }

  async close(): Promise<void> {
    this.disconnected();
    this.tunnel?.setArtifactSeedService(null);
    await this.server?.close();
    const endpoint = this.endpoint;
    this.endpoint = null;
    if (endpoint) await new Promise<void>(resolve => endpoint.server.close(() => resolve()));
  }

  private acceptGrant(payload: unknown): void {
    const value = payload as { role: "source"; grant: ArtifactSeedGrant }
      | { role: "requester"; demandId: string; grant: ArtifactSeedGrant; seedTargetPort: number };
    if (value.role === "requester") {
      const pending = this.pendingDemands.get(value.demandId);
      if (pending) pending({ grant: value.grant, seedTargetPort: value.seedTargetPort });
      else this.complete(value.grant.transferId, false, "artifact_seed_demand_unknown");
      return;
    }
    try {
      if (!this.server || !this.seedingActive) throw new Error("artifact_seed_paused");
      this.server.admitGrant(value.grant);
    } catch (error) {
      const code = error instanceof Error && /^artifact_seed_[a-z_]+$/.test(error.message)
        ? error.message : "artifact_seed_grant_invalid";
      this.complete(value.grant.transferId, false, code);
    }
  }

  private complete(transferId: string, ok: boolean, code?: string): void {
    this.send?.("artifact.seed.complete", { transferId, ok, ...(code === undefined ? {} : { code }) });
  }

  private registerTunnelService(): void {
    if (!this.tunnel || !this.server || this.servicePort === null) return;
    const server = this.server;
    this.tunnel.setArtifactSeedService({
      port: this.servicePort,
      active: () => this.seedingActive,
      onIncoming: (streamId, socket) => server.attachIncoming(streamId, socket.localPort),
    });
  }
}
