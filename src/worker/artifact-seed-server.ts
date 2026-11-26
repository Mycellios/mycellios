import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type AddressInfo, type Server } from "node:net";
import type { Duplex } from "node:stream";
import {
  ARTIFACT_SEED_MAX_GRANT_MS,
  ARTIFACT_SEED_RESPONSE_SCHEMA,
  artifactSeedGrantSchema,
  artifactSeedRequestSchema,
  type ArtifactSeedGrant,
} from "../contracts/artifact-seed.js";
import type { ArtifactSeedStore } from "./artifact-seed-store.js";
import { encodeSeedHeader, paceTransfer, readSeedHeader, toBuffer, writeWithBackpressure } from "./artifact-seed-wire.js";

const MAX_GRANTS = 256;
const REQUEST_TIMEOUT_MS = 10_000;
const PEER_CLOSE_TIMEOUT_MS = 60_000;

export interface ArtifactSeedServerOptions {
  nodeId: string;
  store: ArtifactSeedStore;
  /** Live owner state: paused or disabled seeding refuses every new transfer. */
  enabled: () => boolean;
  maxUploadBytesPerSecond: number;
  now?: () => number;
  /** Content-free outcome codes only; never tokens, paths or request data. */
  onOutcome?: (outcome: ArtifactSeedServeOutcome) => void;
  /**
   * Production requires the coordinator to have bound each incoming runtime
   * stream to the requester node it authenticated. Only isolated tests disable it.
   */
  requireStreamBinding?: boolean;
}

export type ArtifactSeedServeOutcome =
  | { ok: true; bytesSent: number; transferId: string }
  | { ok: false; code: string; bytesSent: number; transferId?: string };

interface HeldGrant {
  grant: ArtifactSeedGrant;
  tokenDigest: Buffer;
}

interface StreamBinding {
  requesterNodeId: string;
  expiresAtMs: number;
}

const MAX_BINDINGS = 256;

/**
 * Serves whole verified blobs to the requester named by a coordinator grant.
 * Transport is supplied by the caller (a runtime stream to the loopback seed
 * port); this class adds no network listener beyond loopback.
 */
export class ArtifactSeedServer {
  private readonly grants = new Map<string, HeldGrant>();
  private readonly bindings = new Map<string, StreamBinding>();
  private readonly streamsByPeerPort = new Map<number, string>();
  private readonly now: () => number;
  private loopback: Server | null = null;

  constructor(private readonly options: ArtifactSeedServerOptions) {
    if (!(options.maxUploadBytesPerSecond > 0)) throw new Error("artifact_seed_upload_rate_invalid");
    this.now = options.now ?? Date.now;
  }

  /** Accept a grant delivered over this node's authenticated coordinator session. */
  admitGrant(value: unknown): void {
    const grant = artifactSeedGrantSchema.parse(value);
    const now = this.now();
    if (grant.sourceNodeId !== this.options.nodeId) throw new Error("artifact_seed_grant_wrong_source");
    if (grant.expiresAtMs <= now || grant.expiresAtMs - now > ARTIFACT_SEED_MAX_GRANT_MS) {
      throw new Error("artifact_seed_grant_expired");
    }
    this.prune(now);
    if (this.grants.has(grant.transferId)) throw new Error("artifact_seed_grant_duplicate");
    if (this.grants.size >= MAX_GRANTS) throw new Error("artifact_seed_grant_capacity");
    this.grants.set(grant.transferId, { grant, tokenDigest: tokenDigest(grant.token) });
  }

  /** Pause, disconnect or plan replacement revokes every outstanding grant. */
  revokeAll(): void {
    this.grants.clear();
    this.bindings.clear();
    this.streamsByPeerPort.clear();
  }

  revoke(transferIds: readonly string[]): void {
    for (const id of transferIds) this.grants.delete(id);
  }

  /** Coordinator statement: this runtime stream's source is `requesterNodeId`. */
  bindStream(streamId: string, requesterNodeId: string, expiresAtMs: number): void {
    const now = this.now();
    for (const [id, binding] of this.bindings) if (binding.expiresAtMs <= now) this.bindings.delete(id);
    if (expiresAtMs <= now || this.bindings.size >= MAX_BINDINGS) return;
    this.bindings.set(streamId, { requesterNodeId, expiresAtMs });
  }

  /**
   * The local tunnel reports which loopback client port carries a stream, so
   * an accepted connection can be matched to its coordinator binding.
   */
  attachIncoming(streamId: string, localPort: number | undefined): void {
    if (localPort === undefined || !this.bindings.has(streamId)) return;
    if (this.streamsByPeerPort.size >= MAX_BINDINGS) return;
    this.streamsByPeerPort.set(localPort, streamId);
  }

  /** One-shot: a binding authorizes exactly one served request. */
  private requesterForPeerPort(port: number | undefined): string | null {
    if (port === undefined) return null;
    const streamId = this.streamsByPeerPort.get(port);
    this.streamsByPeerPort.delete(port);
    const binding = streamId === undefined ? undefined : this.bindings.get(streamId);
    if (streamId !== undefined) this.bindings.delete(streamId);
    return binding && binding.expiresAtMs > this.now() ? binding.requesterNodeId : null;
  }

  get pendingGrants(): number {
    this.prune(this.now());
    return this.grants.size;
  }

  /**
   * Serve one request. `authenticatedRequester` returns the requester node the
   * coordinator bound to this stream; it is read only after the request arrives.
   */
  async serve(stream: Duplex, authenticatedRequester?: () => string | null): Promise<ArtifactSeedServeOutcome> {
    let bytesSent = 0;
    let release: (() => void) | null = null;
    let transferId: string | undefined;
    const finish = (outcome: ArtifactSeedServeOutcome) => {
      const reported = transferId === undefined || outcome.transferId !== undefined ? outcome : { ...outcome, transferId };
      this.options.onOutcome?.(reported);
      return reported;
    };
    try {
      const request = await readSeedHeader(stream, REQUEST_TIMEOUT_MS).catch(() => null);
      const parsed = request === null ? null : artifactSeedRequestSchema.safeParse(request.header);
      if (!parsed?.success || request!.leftover.byteLength > 0) return finish(await this.refuse(stream, "artifact_seed_request_invalid"));
      const requester = authenticatedRequester?.() ?? null;
      if (this.options.requireStreamBinding !== false && requester === null) {
        return finish(await this.refuse(stream, "artifact_seed_stream_unbound"));
      }
      const admitted = this.admit(parsed.data, requester);
      if (typeof admitted === "string") return finish(await this.refuse(stream, admitted));
      transferId = admitted.transferId;
      release = this.options.store.acquireSlot();
      if (!release) return finish(await this.refuse(stream, "artifact_seed_busy"));
      let opened;
      try {
        opened = await this.options.store.openVerified(admitted.blobSha256);
      } catch {
        return finish(await this.refuse(stream, "artifact_seed_blob_unavailable"));
      }
      if (opened.sizeBytes !== admitted.sizeBytes) {
        opened.stream.destroy();
        return finish(await this.refuse(stream, "artifact_seed_blob_unavailable"));
      }
      await writeWithBackpressure(stream, encodeSeedHeader({
        schema: ARTIFACT_SEED_RESPONSE_SCHEMA, ok: true, blobSha256: admitted.blobSha256, sizeBytes: opened.sizeBytes,
      }));
      const started = performance.now();
      try {
        for await (const chunk of opened.stream) {
          if (!this.options.enabled()) throw new Error("artifact_seed_paused");
          const bytes = toBuffer(chunk);
          await writeWithBackpressure(stream, bytes);
          bytesSent += bytes.byteLength;
          await paceTransfer(started, bytesSent, this.options.maxUploadBytesPerSecond);
        }
      } finally {
        opened.stream.destroy();
      }
      // The requester closes after the exact size; closing first could race
      // the transport's teardown with bytes still in flight.
      await waitForPeerClose(stream, PEER_CLOSE_TIMEOUT_MS);
      stream.end();
      return finish({ ok: true, bytesSent, transferId: admitted.transferId });
    } catch (error) {
      stream.destroy();
      const code = error instanceof Error && /^artifact_seed_[a-z_]+$/.test(error.message)
        ? error.message : "artifact_seed_transfer_failed";
      return finish({ ok: false, code, bytesSent });
    } finally {
      release?.();
    }
  }

  /** Loopback-only listener a runtime stream can target; never a public port. */
  async listenLoopback(): Promise<number> {
    if (this.loopback) return (this.loopback.address() as AddressInfo).port;
    const server = createServer((socket) => {
      void this.serve(socket, () => this.requesterForPeerPort(socket.remotePort));
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    this.loopback = server;
    return (server.address() as AddressInfo).port;
  }

  async close(): Promise<void> {
    this.revokeAll();
    const server = this.loopback;
    this.loopback = null;
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  }

  /** Consumes the grant on success, so a token authorizes one transfer only. */
  private admit(
    request: { transferId: string; requesterNodeId: string; blobSha256: string; token: string },
    authenticatedRequester: string | null,
  ): ArtifactSeedGrant | string {
    if (!this.options.enabled()) return "artifact_seed_paused";
    const now = this.now();
    const held = this.grants.get(request.transferId);
    this.prune(now);
    if (!held) return "artifact_seed_grant_unknown";
    if (held.grant.expiresAtMs <= now) return "artifact_seed_grant_expired";
    if (!timingSafeEqual(held.tokenDigest, tokenDigest(request.token))) return "artifact_seed_token_invalid";
    if (held.grant.requesterNodeId !== request.requesterNodeId
        || (authenticatedRequester !== null && authenticatedRequester !== held.grant.requesterNodeId)) {
      return "artifact_seed_requester_mismatch";
    }
    if (held.grant.blobSha256 !== request.blobSha256) return "artifact_seed_blob_mismatch";
    if (!this.options.store.offers(held.grant.blobSha256)) return "artifact_seed_blob_unavailable";
    this.grants.delete(request.transferId);
    return held.grant;
  }

  private prune(now: number): void {
    for (const [id, held] of this.grants) if (held.grant.expiresAtMs <= now) this.grants.delete(id);
  }

  private async refuse(stream: Duplex, code: string): Promise<ArtifactSeedServeOutcome> {
    try {
      await writeWithBackpressure(stream, encodeSeedHeader({ schema: ARTIFACT_SEED_RESPONSE_SCHEMA, ok: false, code }));
      stream.end();
    } catch {
      stream.destroy();
    }
    return { ok: false, code, bytesSent: 0 };
  }
}

function waitForPeerClose(stream: Duplex, timeoutMs: number): Promise<void> {
  if (stream.destroyed || stream.readableEnded) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { clearTimeout(timer); resolve(); };
    const timer = setTimeout(done, timeoutMs);
    timer.unref?.();
    stream.once("end", done);
    stream.once("close", done);
    stream.once("error", done);
    stream.resume();
  });
}

function tokenDigest(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}
