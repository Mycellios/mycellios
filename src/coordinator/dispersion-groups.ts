import { BlockList, isIP } from "node:net";
import type { StoredWorker } from "../storage/store.js";

/**
 * Chunk dispersion (specs/node-owner-privacy, D3). A client marks the pieces
 * of one recording with an opaque group. The coordinator remembers which
 * nodes, identities, owners and networks have received a piece and never
 * offers another piece of the same group to any of them. The group is never
 * sent to a node.
 */

const NON_PUBLIC = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.168.0.0", 16],
] as const) NON_PUBLIC.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [["::", 127], ["fc00::", 7], ["fe80::", 10]] as const) {
  NON_PUBLIC.addSubnet(network, prefix, "ipv6");
}

/**
 * The network a worker connects from, coarse enough to group machines behind
 * one home or provider block: IPv4 /24, IPv6 /48. Private, loopback,
 * link-local and carrier-grade NAT addresses (overlay networks, the tunnel in
 * front of the coordinator) say nothing about the owner and are ignored.
 */
export function publicNetworkPrefix(address: string | null | undefined): string | null {
  if (!address) return null;
  const unmapped = address.startsWith("::ffff:") && isIP(address.slice(7)) === 4 ? address.slice(7) : address;
  const family = isIP(unmapped);
  if (family === 4) {
    if (NON_PUBLIC.check(unmapped, "ipv4")) return null;
    return `${unmapped.split(".").slice(0, 3).join(".")}.0/24`;
  }
  if (family === 6) {
    if (NON_PUBLIC.check(unmapped, "ipv6")) return null;
    const groups = expandIpv6(unmapped).slice(0, 3);
    return `${groups.join(":")}::/48`;
  }
  return null;
}

function expandIpv6(address: string): string[] {
  const [head = "", tail = ""] = address.split("::", 2);
  const left = head ? head.split(":") : [];
  const right = address.includes("::") && tail ? tail.split(":") : [];
  const missing = 8 - left.length - right.length;
  return [...left, ...Array.from({ length: Math.max(0, missing) }, () => "0"), ...right]
    .map((group) => group.toLowerCase().replace(/^0+(?=.)/, ""));
}

export interface WorkerDispersionFacts {
  ownerAccountId: string | null;
  networkAddress: string | null;
}

/** Everything that would let one party receive two pieces of a recording. */
export function workerDispersionKeys(worker: StoredWorker, facts: WorkerDispersionFacts): string[] {
  const keys = [`worker:${worker.id}`];
  if (worker.identityId) keys.push(`identity:${worker.identityId}`);
  if (facts.ownerAccountId) keys.push(`owner:${facts.ownerAccountId}`);
  const prefix = publicNetworkPrefix(facts.networkAddress);
  if (prefix) keys.push(`network:${prefix}`);
  return keys;
}

interface Group {
  /** Key -> jobs of this group that reserved it. */
  readonly keys: Map<string, Set<string>>;
  lastUsedAt: number;
  tail: Promise<void>;
}

export interface DispersionGroupsOptions {
  ttlMs?: number;
  maxGroups?: number;
  now?: () => number;
}

export class DispersionGroups {
  private readonly groups = new Map<string, Group>();
  private readonly ttlMs: number;
  private readonly maxGroups: number;
  private readonly now: () => number;

  constructor(options: DispersionGroupsOptions = {}) {
    this.ttlMs = options.ttlMs ?? 60 * 60_000;
    this.maxGroups = options.maxGroups ?? 10_000;
    this.now = options.now ?? Date.now;
  }

  /** Runs `work` alone for this group, so parallel pieces cannot pick the same node. */
  async exclusive<T>(group: string, work: () => Promise<T>): Promise<T> {
    const state = this.group(group);
    const previous = state.tail;
    let release!: () => void;
    state.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await work();
    } finally {
      release();
    }
  }

  /** True when another job of the group already reserved any of these keys. */
  conflicts(group: string, jobId: string, keys: readonly string[]): boolean {
    const state = this.groups.get(group);
    if (!state || this.expired(state)) return false;
    return keys.some((key) => [...(state.keys.get(key) ?? [])].some((owner) => owner !== jobId));
  }

  reserve(group: string, jobId: string, keys: readonly string[]): void {
    const state = this.group(group);
    for (const key of keys) {
      const owners = state.keys.get(key) ?? new Set<string>();
      owners.add(jobId);
      state.keys.set(key, owners);
    }
    state.lastUsedAt = this.now();
    // Keep the map in least-recently-used order for eviction.
    this.groups.delete(group);
    this.groups.set(group, state);
  }

  private group(id: string): Group {
    let state = this.groups.get(id);
    if (state && this.expired(state)) {
      this.groups.delete(id);
      state = undefined;
    }
    if (!state) {
      this.evict();
      state = { keys: new Map(), lastUsedAt: this.now(), tail: Promise.resolve() };
      this.groups.set(id, state);
    }
    return state;
  }

  private expired(state: Group): boolean {
    return this.now() - state.lastUsedAt > this.ttlMs;
  }

  private evict(): void {
    for (const [id, state] of this.groups) {
      if (this.expired(state)) this.groups.delete(id);
    }
    while (this.groups.size >= this.maxGroups) {
      const oldest = this.groups.keys().next().value;
      if (oldest === undefined) break;
      this.groups.delete(oldest);
    }
  }
}
