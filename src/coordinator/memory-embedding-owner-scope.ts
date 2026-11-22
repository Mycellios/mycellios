import { MEMORY_EMBEDDING_MODEL } from "../contracts/memory-embedding.js";
import type { MeshStore, StoredWorker } from "../storage/store.js";

/**
 * Operator memory embeddings carry private memory text. The
 * coordinator places them only on native nodes (paired devices, or enrolled
 * standalone replica cells) whose active ownership belongs to the requesting
 * account. This is a model-bound,
 * coordinator-side rule: callers cannot widen it (public `privacy` is
 * dropped by `parseChatRequest`), and no other placement rule relaxes it
 * without an explicit policy. The internal, identity-pinned qualification
 * probe is exempt because it only carries the fixed public canary.
 *
 * Specification: specs/memory-embedding-qwen06/spec.md ("Owner-scoped placement").
 */
export function requiresOwnerScopedPlacement(model: string): boolean {
  return model === MEMORY_EMBEDDING_MODEL;
}

/** Active owner account of a paired device or enrolled cell; null for browsers, unowned, revoked or unknown workers. */
export async function activeNodeOwnerAccountId(store: Pick<MeshStore, "database">,
  worker: Pick<StoredWorker, "identityKind" | "identityId"> | null | undefined): Promise<string | null> {
  if ((worker?.identityKind !== "device" && worker?.identityKind !== "cell") || !worker.identityId) return null;
  const ownership = await store.database.getNodeOwnership(worker.identityKind, worker.identityId);
  return ownership?.status === "active" ? ownership.accountId : null;
}

/** The subset of `workerIds` whose node is actively owned by `ownerAccountId`. */
export async function ownerScopedWorkerIds(store: Pick<MeshStore, "getWorker" | "database">, workerIds: Iterable<string>, ownerAccountId: string): Promise<Set<string>> {
  const allowed = new Set<string>();
  for (const workerId of workerIds) {
    if ((await activeNodeOwnerAccountId(store, await store.getWorker(workerId))) === ownerAccountId) allowed.add(workerId);
  }
  return allowed;
}
