import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";

/**
 * Tripwires for bait content (specs/node-owner-privacy, D8).
 *
 * Bait requests carry a link and an API key that look real but are derived
 * from MYCELLIOS_TRIPWIRE_SECRET. Nobody outside the operator can produce
 * them, and they only ever appear inside content sent to contributor nodes.
 * When one is used, someone read and kept that content. The coordinator
 * recognizes them statelessly and logs the hit with the tripwire id; the bait
 * client's private records map that id to the job, and the jobs table maps the
 * job to the node that received it.
 *
 * Formats (shared with scripts/node-privacy-bait.mjs):
 * - link: `${TRIPWIRE_LINK_PATH}${id22}${tag11}`, tag = first 8 bytes of
 *   HMAC-SHA256(secret, "mycellios-tripwire-link/1\n" + id);
 * - API key: `myc_live_${id10}_${mac43}`, mac = HMAC-SHA256(secret,
 *   "mycellios-tripwire-key/1\n" + id), the real key format.
 */
export const TRIPWIRE_LINK_PATH = "/go/";
const LINK = /^([A-Za-z0-9_-]{22})([A-Za-z0-9_-]{11})$/;
const KEY = /^myc_live_([A-Za-z0-9_-]{10})_([A-Za-z0-9_-]{43})$/;
const MIN_SECRET_LENGTH = 32;

export interface TripwireHit {
  event: "tripwire_hit";
  kind: "link" | "api_key";
  tripwireId: string;
  ip: string;
  forwardedFor: string | null;
  userAgent: string | null;
}

export class Tripwires {
  private readonly secret: Buffer;

  constructor(secret: string, private readonly report: (hit: TripwireHit) => void) {
    if (secret.length < MIN_SECRET_LENGTH) throw new Error(`MYCELLIOS_TRIPWIRE_SECRET must have at least ${MIN_SECRET_LENGTH} characters`);
    this.secret = Buffer.from(secret, "utf8");
  }

  /** Off unless MYCELLIOS_TRIPWIRE_SECRET is set. */
  static fromEnvironment(
    environment: NodeJS.ProcessEnv,
    log: { warn(details: object, message: string): void },
  ): Tripwires | null {
    const secret = environment.MYCELLIOS_TRIPWIRE_SECRET?.trim();
    if (!secret) return null;
    return new Tripwires(secret, (hit) => log.warn(hit, "A bait tripwire was used: a node's content was kept or leaked"));
  }

  /** The tripwire id of a bait link token, or null. */
  linkId(token: string): string | null {
    const match = LINK.exec(token);
    if (!match) return null;
    const expected = this.mac("mycellios-tripwire-link/1", match[1]!).subarray(0, 8).toString("base64url");
    return equal(match[2]!, expected) ? match[1]! : null;
  }

  /** The tripwire id of a bait API key, or null. */
  keyId(token: string): string | null {
    const match = KEY.exec(token);
    if (!match) return null;
    const expected = this.mac("mycellios-tripwire-key/1", match[1]!).toString("base64url");
    return equal(match[2]!, expected) ? match[1]! : null;
  }

  /** Called for every rejected API key; reports only bait keys. */
  observeKey(token: string, request: FastifyRequest): void {
    const id = this.keyId(token);
    if (id) this.report(hit("api_key", id, request));
  }

  /** A bait link answers like any unknown page, so following it reveals nothing. */
  register(app: FastifyInstance): void {
    app.get(`${TRIPWIRE_LINK_PATH}:token`, async (request, reply) => {
      const { token } = request.params as { token: string };
      const id = this.linkId(token);
      if (id) this.report(hit("link", id, request));
      return reply.code(404).send({ error: { code: "not_found" } });
    });
  }

  private mac(purpose: string, id: string): Buffer {
    return createHmac("sha256", this.secret).update(`${purpose}\n${id}`).digest();
  }
}

function hit(kind: TripwireHit["kind"], tripwireId: string, request: FastifyRequest): TripwireHit {
  const agent = request.headers["user-agent"];
  const forwarded = request.headers["x-forwarded-for"];
  return {
    event: "tripwire_hit",
    kind,
    tripwireId,
    ip: request.ip,
    // Evidence only: the proxy chain as received, never used for decisions.
    forwardedFor: typeof forwarded === "string" ? forwarded.slice(0, 256) : null,
    userAgent: typeof agent === "string" ? agent.slice(0, 256) : null,
  };
}

function equal(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
