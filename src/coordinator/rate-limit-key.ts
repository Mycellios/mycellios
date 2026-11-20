import { isIP } from "node:net";
import type { FastifyRequest } from "fastify";

/**
 * Global rate-limit bucket. Behind a declared reverse proxy, every request shares the
 * proxy's address, so the limit would apply to all clients together. Only for those
 * declared peers, use the last X-Forwarded-For hop: the address the proxy itself saw.
 * Earlier hops are client-supplied and are never trusted. Fastify's `trustProxy` stays
 * off, so `request.ip` and loopback-only routes keep their meaning.
 */
export function rateLimitClientKey(
  peer: string,
  forwardedFor: string | string[] | undefined,
  trustedProxies: ReadonlySet<string>,
): string {
  if (!trustedProxies.has(peer) || forwardedFor === undefined) return peer;
  const header = Array.isArray(forwardedFor) ? forwardedFor.join(",") : forwardedFor;
  const hop = header.split(",").map((value) => value.trim()).filter(Boolean).at(-1);
  return hop && isIP(hop) ? hop : peer;
}

export function rateLimitKeyGenerator(trustedProxies: readonly string[] = []) {
  const trusted = new Set(trustedProxies);
  return (request: FastifyRequest) =>
    rateLimitClientKey(request.ip, request.headers["x-forwarded-for"], trusted);
}
