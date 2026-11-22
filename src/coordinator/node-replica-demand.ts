import type { EventEmitter } from "node:events";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { MEMORY_EMBEDDING_DIGEST, MEMORY_EMBEDDING_MODEL } from "../contracts/memory-embedding.js";
import { NODE_REPLICAS_SCHEMA, nodeReplicasResponseSchema, type NodeReplicasResponse } from "../contracts/node-replicas.js";
import type { MeshDatabase } from "../storage/database.js";

/**
 * Demand-driven automatic memory embedding replicas on paired native nodes
 * (specs/memory-embedding-qwen06/spec.md, "Automatic node replicas").
 *
 * A node asks, with its own device session, whether it should run the pinned
 * replica. The answer is yes only while the node's owner account is an
 * operator-approved replica account and that same account sent a memory
 * embedding request within `idleMs`. Requests are owner-scoped
 * (memory-embedding-owner-scope.ts), so another account's demand never wakes
 * a node it cannot use, and no node learns about anyone else's traffic.
 */
export const MEMORY_EMBEDDING_REPLICA_IDLE_MS = 10 * 60_000;
const ACCOUNTS_ENV = "MYCELLIOS_MEMORY_EMBEDDING_NODE_REPLICA_ACCOUNTS";

/** Operator-approved owner accounts, from a comma-separated list. Empty (the default) disables the feature. */
export function approvedReplicaAccounts(value: string | undefined): ReadonlySet<string> {
  const ids = (value ?? "").split(",").map((id) => id.trim()).filter(Boolean);
  if (ids.length > 16 || ids.some((id) => id.length > 256 || !/^[A-Za-z0-9._:-]+$/.test(id))) {
    throw new Error("memory_embedding_node_replica_accounts_invalid");
  }
  return new Set(ids);
}

/** Last memory embedding request per approved owner account; bounded and in memory. */
export class MemoryEmbeddingOwnerDemand {
  private readonly lastRequestAt = new Map<string, number>();
  constructor(readonly accounts: ReadonlySet<string>, private readonly idleMs = MEMORY_EMBEDDING_REPLICA_IDLE_MS) {}

  record(model: string, ownerAccountId: string | null | undefined, now = Date.now()): void {
    if (model !== MEMORY_EMBEDDING_MODEL || !ownerAccountId || !this.accounts.has(ownerAccountId)) return;
    this.lastRequestAt.set(ownerAccountId, Math.max(this.lastRequestAt.get(ownerAccountId) ?? 0, now));
  }

  desired(ownerAccountId: string | null, now = Date.now()): boolean {
    if (!ownerAccountId || !this.accounts.has(ownerAccountId)) return false;
    const last = this.lastRequestAt.get(ownerAccountId);
    return last !== undefined && last <= now && now - last < this.idleMs;
  }
}

export function nodeReplicasFor(nodeId: string, desired: boolean): NodeReplicasResponse {
  return nodeReplicasResponseSchema.parse({ schema: NODE_REPLICAS_SCHEMA, nodeId,
    replicas: [{ model: MEMORY_EMBEDDING_MODEL, modelDigest: MEMORY_EMBEDDING_DIGEST, desired }] });
}

export function registerNodeReplicaRoutes(app: FastifyInstance, options: {
  database: Pick<MeshDatabase, "getNodeOwnership">;
  service: Pick<EventEmitter, "on">;
  sessionPrincipal(request: FastifyRequest): string | null | undefined;
  demand?: MemoryEmbeddingOwnerDemand;
}): MemoryEmbeddingOwnerDemand {
  const demand = options.demand ?? new MemoryEmbeddingOwnerDemand(approvedReplicaAccounts(process.env[ACCOUNTS_ENV]));
  options.service.on("demand", (event: { model: string; ownerAccountId?: string | null }) => demand.record(event.model, event.ownerAccountId));
  app.get("/internal/v1/nodes/:identityId/replicas", async (request, reply) => {
    const { identityId } = z.object({ identityId: z.string().min(1).max(256) }).strict().parse(request.params);
    if (options.sessionPrincipal(request) !== identityId) return reply.code(401).send({ error: { code: "worker_session_required" } });
    const ownership = await options.database.getNodeOwnership("device", identityId);
    const owner = ownership?.status === "active" ? ownership.accountId : null;
    return nodeReplicasFor(identityId, demand.desired(owner));
  });
  return demand;
}
