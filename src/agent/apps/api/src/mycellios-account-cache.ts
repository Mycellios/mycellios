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

type Flight<T> = { value: Promise<T>; expiresAt?: number };

/**
 * Process-local, per-owner balance reads with single-flight. Only verified results are
 * kept; a failure is never cached, so an unavailable read stays unavailable.
 */
export function createMycelliosAccountCache({ now = Date.now, ttlMs = TTL_MS, maxOwners = MAX_OWNERS } = {}) {
  return createOwnerReadCache<MycelliosAccount | null>({ now, ttlMs, maxOwners });
}

/**
 * The Mycellios chat catalog behind the model picker: the coordinator needs several
 * seconds for its long AntSeed list, and every open of the picker asked again. A minute
 * per owner keeps the menu quick; the catalog never authorizes a model, the run does.
 */
export function createMycelliosModelsCache<T>({
  now = Date.now,
  ttlMs = 60_000,
  maxOwners = MAX_OWNERS,
  staleMs = MODELS_STALE_MS,
} = {}) {
  // An empty catalog is polled again soon, so it is shared by concurrent callers but not kept.
  return createOwnerReadCache<T>({ now, ttlMs, maxOwners, staleMs, keep: value => !Array.isArray(value) || value.length > 0 });
}

/**
 * A coordinator release or restart leaves it unreachable for a few minutes. The picker then
 * keeps the owner's last good catalog instead of an error: it only lists models, and every
 * run still checks the model, price and balance with the coordinator itself.
 */
const MODELS_STALE_MS = 6 * 60 * 60_000;

function createOwnerReadCache<T>({ now, ttlMs, maxOwners, keep = () => true, staleMs }: {
  now: () => number; ttlMs: number; maxOwners: number; keep?: (value: T) => boolean;
  /** When set, a failed read returns the owner's last kept value younger than this. */
  staleMs?: number;
}) {
  const flights = new Map<string, Flight<T>>();
  const lastGood = new Map<string, { value: T; at: number }>();
  const readOrLastGood = async (key: string, read: () => Promise<T>): Promise<T> => {
    try {
      const value = await read();
      if (staleMs !== undefined && keep(value)) {
        lastGood.delete(key);
        lastGood.set(key, { value, at: now() });
        for (const oldest of lastGood.keys()) {
          if (lastGood.size <= maxOwners) break;
          lastGood.delete(oldest);
        }
      }
      return value;
    } catch (error) {
      const last = staleMs === undefined ? undefined : lastGood.get(key);
      if (last && now() - last.at <= staleMs!) return last.value;
      throw error;
    }
  };
  return (
    owner: { userId: string; baseUrl: string; apiKey?: string; credentialId?: string },
    read: () => Promise<T>,
    { refresh = false, signal }: { refresh?: boolean; signal?: AbortSignal } = {},
  ): Promise<T> => {
    // The exact authorized identity: user, owned connection and the credential it sends.
    const key = createHash("sha256")
      .update(JSON.stringify([owner.userId, owner.credentialId ?? null, owner.baseUrl, owner.apiKey ?? ""]))
      .digest("hex");
    let flight = flights.get(key);
    if (refresh || !flight || (flight.expiresAt !== undefined && flight.expiresAt <= now())) {
      // The shared read is bounded by its own deadline, not by the first caller's signal.
      const current: Flight<T> = { value: readOrLastGood(key, read) };
      current.value.then(
        (value) => {
          if (flights.get(key) !== current) return;
          if (keep(value)) current.expiresAt = now() + ttlMs;
          else flights.delete(key);
        },
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
