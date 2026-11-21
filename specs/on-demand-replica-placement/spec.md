# On-demand native replica placement

Status: phase 1 in progress (opened 2026-11-21).

## Goal

The network decides which native replicas run, and where, from current
demand. A model that is requested gets loaded; an idle one gives its memory
back. Operators no longer pin a fixed set of models to a GPU with external
keeper processes.

Native replicas today are Kokoro (speech), Whisper (transcription) and the
Qwen3-Embedding-4B CUDA replica. All three are qualified on MRPUCCHI's RTX 2060
(6143 MiB; safe budget 5221 MiB). Each needs a committed 2048 MiB reservation,
so only two fit at a time. Before this change, two external keepers held Kokoro
and Whisper permanently. The embedding keeper had died on 2026-10-31, so Jarvis
background embeddings could never run (see
`specs/embedding-lane-self-healing/spec.md`).

## Existing contract this builds on

- A replica's runner on the PC checks the public
  `/public/v1/requested-models/<modelId>/timeline`. It serves only while a
  committed reservation for its `consumerId`, node, memory and canary exists,
  and exits within seconds when the reservation disappears. Its Windows
  service restarts it, so it loads again once a reservation is committed.
- `DeploymentControlPlane.prepareRoute` enforces the per-node budget. It never
  grants more than the safe budget, whoever asks.

Granting and releasing a reservation is therefore enough to load and unload a
replica. Phase 1 needs no new node command and no change on the PCs.

## Phase 1: coordinator-owned GPU arbitration (this change)

`src/coordinator/native-replica-placement.ts`:

- **Demand ledger.** `MeshService` emits `demand` for every admitted request,
  with `served` false when no replica could take it (`no_capacity`). The ledger
  keeps, per configured public model, the last request time and the first
  unserved request since the model was last available.
- **Planner** (`planReplicaPlacement`, pure and tested):
  1. Replicas with unserved demand are placed first, oldest first.
  2. If one does not fit, the least recently used idle replicas on the same
     node are released. Its memory counts as occupied for `releaseGapMs`
     (30 s), so the old process can exit before another loads.
  3. Remaining free capacity is filled with the most recently used, then
     highest priority, replicas, so warm models stay ready.
  4. A replica is never released while it is busy (a deployment has fewer free
     slots than its concurrency), pinned, used within `idleMs` (10 min), or
     loaded less than `minResidencyMs` ago (3 min). This prevents thrashing.
  5. Reservations on a node that is no longer a fresh, verified CUDA executor
     are released.
- **Broker.** Every `tickMs` (15 s) it reads fresh workers and owned
  reservations, applies the plan, and renews kept reservations
  (`reservationTtlMs`, 180 s). Granting reuses the former keeper's sequence:
  identity check, claim operation, prepare, commit with the qualified canary.
  The canary receipt is hash-checked when the configuration loads.
- **Configuration.** `MYCELLIOS_NATIVE_REPLICA_PLACEMENT_CONFIG` points to a
  `mycellios-native-replica-placement/1` JSON file; without it, the coordinator
  uses `native-replica-placement.json` next to its state database when that
  file exists. Release promotion copies the running container's environment,
  so the file convention enables placement without recreating the container. Each replica declares its
  consumer, reservation model, the public models whose requests count as its
  demand, node, GPU identity, memory, priority, `pinned`, the operation
  metadata and the canary that its runner's guard requires. Without the
  variable or the file nothing changes.

### Rollout

1. Write the configuration from the existing keeper configurations (Kokoro,
   Whisper) plus the embedding replica (`gpu.private.json` fields: consumer
   `embedding-cuda-76166167-20261020`, `coreSha256`, `runtimeSourceId`,
   `modelDigest`).
2. Place the file at `/var/lib/mycellios/native-replica-placement.json` (or
   set the variable) and restart the coordinator through Nucleus.
3. Stop the two keeper containers. The broker adopts their live reservations,
   because ownership is by `consumerId`, and from then on is the only writer.
4. Verify on `/timeline`: grants and releases follow Jarvis embedding and
   speech traffic; no reservation exceeds 5221 MiB per node.

Rollback: remove the file (or unset the variable), restart the coordinator
and start the keepers again.

### Limits

- First request after an unload fails with `no_capacity` while the replica
  loads. Callers that retry (Jarvis backfill) succeed; interactive speech may
  see one failure. Phase 2 removes this.
- The AntSeed seller's health guard withdraws an offer whose model is
  unloaded. Demand that arrives through AntSeed then stops reaching the
  coordinator. Phase 2 addresses this; the seller change needs operator
  approval.

## Phase 2: wait instead of fail

- Hold a request for a loadable replica up to a bounded time (for example 90 s
  within its deadline) instead of answering `no_capacity`. Nothing has been
  dispatched yet, so no paid work is replayed.
- Publish a `standby` (loadable on demand) model state. The seller's health
  guard keeps advertising standby models.

## Phase 3: several nodes and CPU pipelines

- Nodes advertise the qualified replica packages they hold. The planner
  chooses among nodes, keeping at least two embedding replicas on distinct
  hosts.
- A node command starts or stops a native replica component, so the CPU
  two-stage embedding pipeline (HP + MSI GE60) is placed the same way.
- Runners wait quietly with backoff while they have no reservation. Today
  they restart every few seconds and grow their logs.

## Verification

- `tests/native-replica-placement.test.ts`: planner rules, ledger, and a broker
  run against the real control plane on in-memory storage (commit, renewal,
  release, grant after drain, operation metadata and canary binding).
- `npm run typecheck`, `npm run verify:architecture`, `npm run verify:structure`.
