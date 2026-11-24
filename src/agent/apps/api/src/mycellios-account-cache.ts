import { createHash } from "node:crypto";
import { withAbort } from "@mycellios/adapters";
import type { MycelliosAccount } from "@mycellios/contracts";

/**
 * Clients poll every 60 s (5 s while contributing) and also read on focus. A 15 s
 * window collapses those bursts and parallel tabs without delaying events that the
 * client knows changed the balance: those pass `refresh` and always read the authority.
 */
const TTL_MS = 15_000;
const MAX_OWNERS = 1_000;

type Flight = { value: Promise<MycelliosAccount | null>; expiresAt?: number };

/**
 * Process-local, per-owner balance reads with single-flight. Only verified results are
 * kept; a failure is never cached, so an unavailable read stays unavailable.
 */
export function createMycelliosAccountCache({ now = Date.now, ttlMs = TTL_MS, maxOwners = MAX_OWNERS } = {}) {
  const flights = new Map<string, Flight>();
  return (
    owner: { userId: string; baseUrl: string; apiKey?: string; credentialId?: string },
    read: () => Promise<MycelliosAccount | null>,
    { refresh = false, signal }: { refresh?: boolean; signal?: AbortSignal } = {},
  ): Promise<MycelliosAccount | null> => {
    // The exact authorized identity: user, owned connection and the credential it sends.
    const key = createHash("sha256")
      .update(JSON.stringify([owner.userId, owner.credentialId ?? null, owner.baseUrl, owner.apiKey ?? ""]))
      .digest("hex");
    let flight = flights.get(key);
    if (refresh || !flight || (flight.expiresAt !== undefined && flight.expiresAt <= now())) {
      // The shared read is bounded by its own deadline, not by the first caller's signal.
      const current: Flight = { value: read() };
      current.value.then(
        () => { if (flights.get(key) === current) current.expiresAt = now() + ttlMs; },
        () => { if (flights.get(key) === current) flights.delete(key); },
      );
      flight = current;
    }
    flights.delete(key);
    flights.set(key, flight);
    for (const oldest of flights.keys()) {
      if (flights.size <= maxOwners) break;
      flights.delete(oldest);
    }
    return withAbort(flight.value, signal);
  };
}
