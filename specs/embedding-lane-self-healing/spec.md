# Embedding lane self-healing

Status: in progress (opened 2026-11-20).

## Problem

`mycellios-qwen3-embedding-4b` (Qwen/Qwen3-Embedding-4B, revision
`5cf2132abc99cad020ac570b19d031efec650f2b`) stopped serving Jarvis memory
embeddings. The AntSeed seller's model-health guard withdrew the offer after
repeated 503 health checks, so the gateway answered "price unknown". No alert
fired. Lexical search kept working.

## Observed topology (production, 2026-11-20)

The lane is an operator-run native replica, not a coordinator-activated model:

| Piece | Where | Unit |
|---|---|---|
| CPU cell worker (`wrk_577945c0…`) | nc-hz-control-01 | `mycellios-embedding-worker` |
| Pipeline gateway + outbound reverse transport | nc-hz-control-01 | `mycellios-embedding-gateway`, `mycellios-embedding-reverse` (:18490) |
| Stage 0-15 (bf16 storage, fp32 compute) | HP ProBook, `node-a229…` | `MycelliosEmbeddingStage` (WinSW) |
| Stage 15-36 | MSI GE60, `node-c173…` | `MycelliosEmbeddingStage` (WinSW) |
| CUDA cell worker (`wrk_c0e9f50a…`) | nc-hz-control-01 | `mycellios-embedding-gpu-worker` + proxy/reverse/canary units |
| CUDA executor | MRPUCCHI RTX 2060, `node-4c38…` | operator-installed source outside this repository |

`requested_models.auto_activate = 0` is not the cause: Kokoro and Whisper
use the same value and serve normally. The coordinator observes native
replicas from the deployments their workers advertise.

## Root causes

1. **Worker stalls before `server.ready`.** Both control-server workers hit a
   storm of `4409 duplicate worker connection` closes. The last attempt left
   an established socket to the proxy that never completed the handshake
   or received `server.ready`. The WebSocket had no handshake timeout, and the
   RTT liveness probe only starts after `open`. The reconnect loop therefore
   waited forever with the process still "active". This happened on
   2026-11-16 (CPU) and 2026-11-18 (CUDA).
2. **Stage executor node stopped reporting.** `node-c173…` (MSI GE60, node
   0.2.108) stopped sending snapshots on 2026-11-10. Its stage service then
   failed owner admission ("node not ready") in a restart loop, so the CPU
   pipeline lost a stage (`pipeline_stage_disconnected`). From 2026-11-11
   every request failed with `no_capacity`. Two faults kept the node down:
   - A crash between creating and writing `state/instance.lock` left an
     empty lock. `MycelliosNodeServiceHost.acquire` fails closed on an
     unreadable lock, so every later start exited with
     `mycellios_node_instance_lock_is_invalid`.
   - Its coordinator URL was the private NetBird relay
     (`https://100.102.50.179:18474`). After the 2026-11-19 migration the
     relay's upstream answers `404` to `/internal/v1/workers/connect`
     upgrades, so the node timed out before `ready`. The other nodes use
     `https://www.mycellios.com`.
3. **CUDA GPU reservation keeper not migrated.** The CUDA replica's keeper
   still targeted the retired SQLite store. Its last write was 2026-10-31
   23:01 UTC (`prepared`, never committed). Kokoro and Whisper got Postgres
   keepers with `restart: unless-stopped`; embeddings did not. After
   2026-11-11, Kokoro (2048 MiB) and Whisper (2048 MiB) use the full safe
   budget of the RTX 2060 (5221 MiB of 6143), so a 2048 MiB embedding
   reservation no longer fits.
4. **Transient activation retries gave up permanently.** After five attempts
   (about eight minutes), `nextAutomaticActivationRetry` returned `null` and the
   model stayed `failed` forever (for example `qwen3-1.7b-instruct`).
5. **No alert.** The seller's health guard withdraws and re-advertises offers
   silently.

`maxVramMiB: 0` in `node_desired_states` means "no cap". The node uses the
detected VRAM (`src/node/main.ts`), so it is not a cause.

## Changes in this branch

- Worker: a `COORDINATOR_READY_TIMEOUT_MS` (60 s) bound from socket creation
  to `server.ready`, plus `handshakeTimeout`. On expiry the worker terminates
  the socket and the existing reconnect loop resumes. Covered by
  `tests/worker-connection-liveness.test.ts`.
- Coordinator: after the progressive burst, transient activation failures
  keep retrying at the last configured delay (300 s by default). Capacity,
  activation-slot and planner admission still gate each launch. The incident
  stays visible as `scheduled` with a "persistent automatic retry" message.
  Deterministic failures still require a change. Covered by
  `tests/requested-model-api.test.ts`.
- Node service host: the instance lock is written to a temporary file and
  published with an exclusive hard link, so a crash can no longer leave an
  empty or truncated lock. An empty lock older than 60 s (left by earlier
  versions) is recovered; fresh empty and malformed locks still fail closed.
  Covered by `tests/node-service-host.test.ts`.

## Operational recovery (2026-11-20)

- Restarted `mycellios-embedding-worker` on the control server. It now waits
  for its stages and restarts every 10 s through systemd.
- Rebooted the MSI GE60 through Jarvis Local Node after confirming 36 days of
  console inactivity.
- 2026-11-21: operator access to the HP, MSI GE60 and MRPUCCHI now goes
  through NetBird SSH (JWT, `daniel-native-ssh` policy), not Jarvis.
  The MSI rejoined NetBird as a new peer; it was moved back to its previous
  address `100.102.242.239` and groups, and the duplicate peer was removed.
- On the MSI: moved the empty lock aside
  (`instance.lock.empty-20261110.bak`), pointed `node.json` at
  `https://www.mycellios.com` (backup `node.json.before-public-coordinator-20261121`)
  and restarted `MycelliosNode`. The node reached `ready`, stage 15-36
  reached `admitted-stage-serving`, the CPU cell worker connected, and the
  AntSeed seller re-advertised `mycellios-qwen3-embedding-4b` after an HTTP 200
  health check.
- The CUDA replica (`mycellios-embedding-gpu-mrpucchi-20261020`) remains
  down: its runner exits with `embedding_gpu_qualification_lease_missing`
  because no keeper renews its committed reservation. Kokoro (2048 MiB) and
  Whisper (2048 MiB) hold the RTX 2060 safe budget (5221 MiB), so a third
  2048 MiB reservation does not fit. Jarvis's bulk backfill uses this replica.

## Remaining work (follow-up PRs)

1. Retire or fix the private relay route on `:18474` (its upstream rejects
   worker WebSocket upgrades since the migration), and update the MSI GE60
   from node 0.2.108.
2. Bring the embedding runtime, stage service and GPU keeper sources into the
   repository so the coordinator can place replicas on any compatible node.
   Then add a native-node command to start or stop a qualified replica.
3. Share GPU memory on demand between Kokoro, Whisper and embeddings: load
   the replica that has demand and release the idle one, with bounded load
   time and owner limits.
4. Run at least two replicas, preferring distinct backends and hosts.
5. Alert through the existing Uptime Kuma (Telegram/SMS) with a keyword
   monitor on `/public/v1/snapshot` for
   `"id":"mycellios-qwen3-embedding-4b","replicas"`.
6. Measure throughput before any model change. Historical receipts: CUDA
   about 11.6 input tokens/s; CPU two-stage about 2.7 tokens/s. With those
   rates the 171k-chunk backlog would take weeks. Compare Qwen3-Embedding-0.6B
   only together with a full re-embedding plan; never mix models in one store.
