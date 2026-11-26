# Artifact seed nodes

Status: implemented end to end in code and tested on one host (2026-11-26).
Not physically qualified across two computers.

## Problem

`src/distribution/fleet-resource-roles.ts` can assign a spare node the
`artifact-seed` role when it holds a verified blob and a measured peer transfer
beats the origin. Before this work no node reported held blobs, no demand was
produced, no grant reached any node and no byte path existed, so the role was
never assigned.

The target contributor is a weak PC: free disk, little RAM and CPU, no usable
GPU (for example Windows 10 LTSC, Pentium N4200, 4 GB RAM with about 0.7 GB
free and 27 GB free disk). It cannot run a model stage, but it can hold verified
stage blobs and send them to another node.

## Design

### Store and reporting (worker)

- Blobs are the native stage cache objects of
  `python/distributed_runtime/stage_artifact_cache.py`:
  `<cachePath>/stage-cas/objects/sha256/<xx>/<sha256>`.
- `src/worker/artifact-seed-store.ts` scans them in Node only, re-hashes each in
  digest order at a bounded rate with event-loop yields, and stops hashing once
  the owner quota or 256 advertised blobs is reached. Files with a wrong name,
  location or content are ignored. Changed files are withdrawn before serving.
- A persisted index (`<cachePath>/artifact-seed-index.json`, digests and file
  identities only, no paths) lets a restart skip re-hashing unchanged files.
- The observation `mycellios-artifact-seed-observation/1` rides on heartbeat
  capabilities (stripped from the signed registration, like `hostMemory`). It
  carries `inventoryRevision`; the digest list is sent only when it changed or
  at least every 60 s (delta heartbeats). The coordinator keeps a stored list
  only for the exact same revision (`evidence-authority.ts`).
- `ready` requires owner opt-in, a finished scan, a listening loopback seed port
  and contribution not paused. Every native node also sends an empty, unready
  observation: that announces the requester protocol.

### Demand, plan and grants (coordinator)

- `src/coordinator/artifact-seed-broker.ts`, owned by `WorkerHub`. A worker may
  send `artifact.seed.demand` only after the coordinator sent
  `artifact.seed.ready` for its session.
- Demand evidence: stored observations (`fleet-resource-evidence.ts`), the
  requester's measured downlink as origin estimate, and existing runtime link
  observations from seed to requester. Only fresh (≤ 120 s) **direct** link
  measurements count; no new probe is started. Without a downlink or a direct
  measurement the requester keeps its origin route.
- `planFleetResourceRoles` chooses a seed only if its pessimistic estimate beats
  the origin's optimistic one; slots already granted are subtracted.
- One single-use grant (256-bit token, transfer id, source, requester, digest,
  exact size, expiry ≤ 120 s) goes first to the seed, then to the requester
  together with the seed's loopback service port.
- Revocation: on disconnect, on a heartbeat that is not `online` or reports
  the seed unready, on expiry, and on any `artifact.seed.complete`.

### Stream (existing runtime-stream path)

- The requester opens an ordinary runtime stream to the seed node and its
  service port through `RuntimeStreamTunnel.openArtifactSeedStream`, so the
  existing relay or direct secure channel carries the bytes.
- `WorkerHub` asks the broker before forwarding a `runtime.stream.open` whose
  target is a seed service port. It admits it only for an active, unbound grant
  whose requester is the **authenticated source session's node id**, and sends
  `artifact.seed.bind {streamId, requesterNodeId}` to the seed first.
- The seed tunnel accepts its seed port only while seeding is active and maps
  the stream's loopback connection to that binding. The seed server requires
  the binding, the matching requester, token, digest and an unexpired grant;
  the token alone is not enough. Seed streams survive stage runtime resets.
- **Direct channel only.** Weights never cross the coordinator relay, enforced
  on three sides: the hub terminates a seed stream instead of starting a relay
  (no direct support, or failed direct negotiation, also after the grant ended)
  and revokes the grant on both nodes (`ArtifactSeedBroker.abandonRelay`); the
  requester tunnel closes a seed stream that is opened as relay; the seed tunnel
  never accepts its seed port from a relay open. The requester then reports the
  failure and its stage cache falls back to the origin.
- The requester closes the stream after reading exactly the granted size; the
  seed waits for that close, so transport teardown never races bytes in flight.

### Serving and verification

- `ArtifactSeedServer` streams the verified object paced to `maxUploadMbps`,
  with at most `maxTransferSlots` concurrent transfers, and stops on pause.
- `fetchArtifactSeedBlob` re-hashes every byte into
  `partials/artifact-seed/` and publishes into `objects/` only on an exact match,
  never replacing an existing object.
- Python: `stage_artifact_cache acquire --seed-endpoint <loopback>` (token only
  in `MYCELLIOS_ARTIFACT_SEED_TOKEN`) asks the worker's loopback endpoint before
  an HTTP origin, verifies the object again, deletes it on mismatch and falls
  back to the origin on any failure (`stage_seed_source.py`).

### Owner limits and modes

- `node-configuration.artifactSeed`: `enabled`, `diskQuotaMiB` (also capped by
  `limits.maxDiskMiB`), `maxTransferSlots` 1..4, `maxUploadMbps`, `seedOnly`.
- `seedOnly`: the node starts only the worker connection, the store and the
  seed server. It does not prepare accelerators, probe or launch Python, start
  the memory embedding replica or answer performance challenges. Its executor
  admits no stage (`computeMode: gpu-only`, not CPU eligible, refusing launch).

## Privacy and security boundaries

- Contributor PCs remain untrusted readers (`specs/node-owner-privacy/spec.md`).
  Only public, content-addressed stage weights cross this path; never request,
  prompt, output or account data.
- Logs and outcomes are content-free `artifact_seed_*` codes. Tokens are never
  logged or persisted; the loopback endpoint token stays out of argv.
- A digest list is a claim: it only makes a node eligible. The requester and the
  Python cache each re-verify; the origin remains the authoritative fallback.

## Desktop/Agent

None. No `src/agent` change is needed, so no changelog entry.

## Not claimed

- No multi-host evidence. `tests/artifact-seed-e2e.test.ts` runs the real
  WorkerHub, both tunnels (direct over loopback) and both peers in one process.
- No speed claim beyond the planner's measured comparison.

## Known limits and remaining work

1. Today's TypeScript preparation calls `acquire` with a locally compiled
   manifest, so the seed is consulted only for HTTP manifest origins. Serving
   pinned stage packages to nodes that have not compiled them needs a published
   manifest source for `--stage-package-identity` packages.
2. A repeatedly mismatching seed is not yet quarantined.
3. Physical qualification on two real PCs (seed-only weak PC plus requester),
   recorded in `docs/STATUS_AND_EVIDENCE.md` only after it passes.
