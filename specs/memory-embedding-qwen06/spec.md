# Operator memory embeddings: Qwen3-Embedding-0.6B

Status: the Qwen 0.6B vectors are retained. The private forwarder and direct
device route were retired on 2026-11-22. Clients use the native coordinator
route once a paired node is qualified.

## Decision

The operator's memory index (190,594 chunks, about 29M tokens) moves from
`mycellios-qwen3-embedding-4b` to `Qwen/Qwen3-Embedding-0.6B`, revision
`97b0c614be4d77ee51c0cef4e5f07c00f9eb65b3`, 1024 dimensions. The owner
approved the change. Two problems ruled out the 4B model:

- **Too slow.** The 4B replicas run at about 12 tokens/s (CUDA) and 2.7
  tokens/s (two CPU stages), so a full backfill would take weeks. The 4B model
  in fp16 does not fit the 6 GB RTX 2060.
- **Route blocked.** The AntSeed route (Dify → OmniRoute → gateway) now
  rejects the free-only operator key, because the seller prices the 4B model
  at 0.30 $/M input. That public price is unchanged.

Measured on MRPUCCHI's RTX 2060 (fp16): about 9,000 tokens/s in-process and
about 4,300 tokens/s end-to-end over HTTP with 64-text batches. Peak memory is
1.8 GB, so the replica fits beside Kokoro. The public Qwen3 Embedding report
gives MMTEB of about 64 (0.6B) against about 69 (4B). Vectors from different
models belong in separate index columns.

## Historical backfill topology

| Piece | Where |
|---|---|
| GPU replica (fp16, primary) | MRPUCCHI `100.102.221.91:18495`, Windows service `MycelliosQwen06` |
| Apple GPU replica (MPS fp16, shares load) | MacBook Air M1 `100.102.252.212:18495`, user LaunchAgent `io.mycellios.qwen06` |
| DirectML replica (fp32, shares load) | PC-DANI Radeon 890M `100.102.1.112:18495`, user Startup entry `mycellios-qwen06.vbs` |
| CPU replicas (backup / disabled) | HP ProBook `100.102.123.237:18495`, MSI GE60 `100.102.242.239:18495` |
| Failover entry | control server `10.48.0.10:18495`, systemd `mycellios-qwen06-forwarder` |

- **GPU vs CPU vectors.** A canary on four cases gave a minimum cosine of
  0.999997 between the GPU (fp16) and the CPU (fp32) vectors, so the CPU
  backup produces interchangeable vectors.
- **Access control.** NetBird policy `mycellios-memory-embeddings` allows
  only the control server to reach port 18495 on the replica group. Windows
  Firewall on each PC admits only `100.102.50.179`. The forwarder admits only
  the configured client and loopback. Requests carry a bearer token.

## Distribution

The failover entry spreads requests by weighted least load (active
connections per unit of weight: GPU 2, each CPU 1), so every ready replica in
the network takes part instead of the GPU alone. A GPU replica reports
`ready: false` (state `cooling`) while it is above its thermal pause
threshold (81 °C, resume 76 °C on MRPUCCHI), so new work goes to the other
replicas until it cools. The backfill used four requests in flight with a
180 s timeout to keep the slower CPU replicas busy. Replicas fetch the pinned model
over NetBird from the control server (`qwen06-artifacts-persist`, range
requests, port 18496 for the replica group only).

## Contract

- `POST /v1/embeddings` with
  `{"model":"Qwen/Qwen3-Embedding-0.6B","input":[...],"input_type":"document"|"query"}`
  (1..64 inputs, truncated at 8192 tokens).
- `query` makes the server apply Qwen's official query instruction; clients
  never add it.
- The response is OpenAI-shaped, with `revision` and L2-normalized 1024-dim
  vectors. A replica refuses to return any vector whose length is not 1
  (500 `invalid_model_output`), so a faulted backend cannot write all-zero
  vectors into the index.
- A backend failure while embedding (for example a DirectML device fault,
  whose localized message once surfaced as a text-decoding error) answers 500
  `backend_failed`, never 400: clients treat 400 as a bad input. The replica
  then drops the model and reloads it on its next reconcile (about 9 s),
  reporting `reloading` meanwhile.
- Errors: 401, 400, 413, and 503 `no_replica_available`.
- `GET /health` (no auth) reports `ready`, `state`, model, revision and
  device.

## Shared GPU

The GPU replica loads only while the coordinator holds a committed reservation
for consumer `qwen06-cuda-mrpucchi-20261121`. The reservation is model
`mycellios-qwen3-embedding-0.6b-mrpucchi`, 1024 MiB, with a GPU-vs-CPU canary
receipt. The native replica placement broker
(`specs/on-demand-replica-placement`) grants it. The replica unloads within
about 10 s when the reservation goes away, so the safe GPU budget is never
exceeded. When that happens, the forwarder fails over to the CPU replica.

## Files

- `python/distributed_runtime/qwen06_embedding_service.py`: the replica.
- `python/distributed_runtime/qwen06_embedding_forwarder.py`: the failover entry.
- Tests: `python/tests/test_qwen06_embedding_service.py` and
  `python/tests/test_qwen06_embedding_forwarder.py`.

## Operations

- Model weights live outside the node cache
  (`C:\ProgramData\Mycellios\Qwen06\model`). Writing them under
  `C:\ProgramData\Mycellios\Cache` trips the node's disk limit and pauses its
  contribution; this happened once on 2026-11-21.
- The token is stored in `C:\ProgramData\Mycellios\Qwen06\token` (SYSTEM and
  Administrators only) and in the client's credential store.
- Rollback:
  - stop the client backfill and leave search on its previous vector; the 4B
    and Gemini columns are untouched;
  - stop `MycelliosQwen06`;
  - remove its replica from the broker configuration.

## Native replica (coordinator path)

Status: implemented. Production contribution requires a physically qualified
paired node through the coordinator.

The replica is admitted through the coordinator like the 4B embedding
replica: a worker with the `embedding` adapter, a pinned deployment, native
qualification receipts and placement by the broker. The public model is
`mycellios-qwen3-embedding-0.6b`. Code: `src/contracts/memory-embedding.ts`,
`src/adapters/memory-embedding.ts`, and the `native` listener in
`qwen06_embedding_service.py`. Tests: `tests/memory-embedding.test.ts` and
the native cases in `python/tests/test_qwen06_embedding_service.py`.

### Runtime and adapter

- With a `native` section (`{"port": 18497, "activationId": "..."}`) the
  replica process also listens on loopback without a token, sharing the model
  it already loaded for the forwarder. It refuses requests with an `Origin`
  header, so a web page cannot use it.
- It starts the listener only after it has hashed every pinned file
  (`config.json`, `generation_config.json`, `merges.txt`,
  `model.safetensors`, `tokenizer.json`, `tokenizer_config.json`,
  `vocab.json`) at the pinned revision. The artifact identity is
  `sha256("mycellios-memory-embedding/1", revision, "name:sha256"...)`,
  computed the same way in TypeScript and Python, and both test suites pin it.
- Approved executions are single-stage: CUDA fp16, MPS fp16 and DirectML
  fp32 (measured at cosine ≥ 0.999996 against CPU fp32), and CPU fp32, which
  is the reference itself. The device type must match the backend (`cpu` for
  CPU, `gpu` otherwise). DirectML fp16 (0.987) and CPU bfloat16 are refused by
  the worker configuration, the deployment schema, the adapter and the
  runtime. A CPU replica qualifies with the same canary gate as a GPU one.
- `GET /health` reports `status`, model, upstream model, revision, artifact
  identity, activation, runtime, dimensions, limits, device and dtype. The
  adapter is ready only when every field matches its configuration. A GPU
  replica without a committed reservation reports `waiting_reservation`, and
  a hot one reports `cooling`, so the worker reads as not ready in both cases.
- `POST /embed` takes the request envelope plus the worker lease
  (`jobId`, `id`, `deadline`, `activationId`). It rejects a stale lease or
  one for another activation with 409. The response is
  `{"schema":"mycellios-memory-embeddings/1","result":{object, model, revision, data, usage}}`.
  The existing unit-length guard applies here too.

### Request contract

- `POST /v1/chat/completions` with `model: "mycellios-qwen3-embedding-0.6b"`,
  `max_tokens: 1`, `stream: false` and one user message whose content is
  `{"schema":"mycellios-memory-embeddings/1","input":[...],"input_type":"document"|"query"}`
  (1..64 non-blank texts of at most 32,768 characters; `input_type` defaults to
  `document`). The runtime applies the query instruction; clients never add it.
- The answer's message content is the result envelope above. The coordinator
  rejects a completion unless it has one 1024-dimensional unit vector per input,
  in order, with the pinned revision and matching usage. The limit is
  1,900,000 response bytes, which fits 64 full vectors. The deadline is 300 s.
- Requests for this model are served **only** by replicas with fresh native
  qualification for the current worker, session, build and activation. If a
  replica is connected but not qualified, the answer is 503
  `native_qualification_unavailable`. With no replica at all, it is the usual
  503 `no_capacity`. Only the internal, identity-pinned qualification probe
  can reach an unqualified replica.
- **Owner-scoped placement.** Requests for this model carry private memory
  text, so the coordinator places them only on nodes whose active ownership
  (a paired device, or an enrolled standalone replica cell) belongs to the
  requesting API account (`src/coordinator/memory-embedding-owner-scope.ts`).
  The rule is bound to the model on the coordinator. It applies to planning,
  the dispatch-time recheck, standby retries, capacity checks and every piece
  of a split request. A request without an authenticated account gets 403
  `memory_embedding_owner_required` before any work is created. When the
  caller's own nodes have no replica, the answer is the usual `no_capacity`,
  so other accounts' replicas are never revealed. No public `privacy` field is
  involved. The only exemption is the internal, identity-pinned qualification
  probe, which carries only the fixed public canary query. Tests:
  `tests/memory-embedding-owner-scope.test.ts`.
- Each worker has one slot (`maxConcurrency: 1`), so a busy replica takes
  no further work. A non-streaming request is split across the idle replicas
  (see "Splitting across replicas"), so one request already uses the whole
  network. The client should keep one or two requests in flight and retry
  503 with backoff, as the backfill already does.

### Splitting across replicas

Code: `src/coordinator/memory-embedding-split.ts`. Tests:
`tests/memory-embedding-split.test.ts`.

- **When.** A non-streaming `/v1/chat/completions` request with at least two
  texts, when at least two idle, freshly qualified replicas would share it.
  Otherwise the request runs on one replica as before. Contribution-funded,
  streaming, dispersion-grouped and qualification requests are never split.
- **Sizing.** Each text is estimated at about four characters per token
  (capped at 8,192). Texts go largest first to the replica that would finish
  them soonest, counting a fixed 750 ms per piece. A fast GPU gets most of
  the texts; a slow CPU only gets a text when it finishes no later than a
  faster replica would, so it never lengthens the request.
- **Speed.** A replica starts from the measured prior of its execution (CUDA
  and MPS fp16 380 tokens/s, DirectML fp32 114, CPU fp32 7). After each
  validated batch the coordinator records the estimated tokens over the wall
  time it observed (minus the fixed overhead, counting at least half of the
  raw time), averaged with weight 0.5 and kept for six hours. A device that
  throttles gets smaller pieces on the next request; unsplit requests feed
  the same measurement.
- **Pieces.** Each piece is an ordinary job pinned to one worker, so it keeps
  the per-piece checks (count, order, 1024 dimensions, unit length, revision,
  usage). The coordinator reassembles the vectors in the original order,
  checks the whole batch again, and reports usage as the exact sum of the
  pieces. Each piece gets its own signed receipt and its own settlement; the
  response lists them in `x_network.pieces` (request id, input tokens,
  receipt id). The parent request has no single route, so it has no receipt.
- **Failures.** A piece may use three times its predicted time plus 10 s
  (at least 15 s, never past the request deadline). A piece that fails or
  runs out of time runs once more on a different idle replica that can
  finish it in time; a second failure fails the request. A replica taken by
  another request before the offer does not count as an attempt. Re-running
  is safe because embeddings are deterministic and read-only, and a failed
  attempt is never billed: usage and settlement come only from validated
  pieces. Paid (contribution-funded) requests are not split, so the rule that
  an uncertain paid request is never replayed is unchanged.
- **Deadline.** The whole request ends at its deadline (300 s by default). At
  that point the coordinator cancels the running pieces and answers
  `deadline_exceeded` (job status `expired`). Cancelling the request
  cancels every piece.
- **CPU replicas and payment.** Unfunded requests may use qualified CPU
  replicas. Economic settlement verifies GPU stages only, so a CPU piece
  earns no contribution credit yet, and contribution-funded requests skip CPU
  replicas (`requireGpuStages`) instead of failing settlement after the work.

Measured versus tested: the speeds above were measured on 2026-11-21/22 on
the forwarder path. Splitting, re-dispatch, deadlines and the speed feedback
are covered by unit and in-memory coordinator tests only; they have not yet
run against physical replicas through the coordinator.

### Deployment entry (worker configuration)

A standalone worker on the replica's PC, enrolled through
`MYCELLIOS_WORKER_ENROLLMENT_PATH` like other standalone replicas:

```json
{
  "region": "eu-west", "capacityScope": "cell", "offeredVramMb": 1024,
  "limits": { "maxConcurrency": 1 },
  "adapter": { "kind": "embedding", "model": "mycellios-qwen3-embedding-0.6b",
               "baseUrl": "http://127.0.0.1:18497/" },
  "deployment": {
    "modelDigest": "sha256:7ced807793a552878c586b4fc420c5f9edef134abe30e4202b9f2022487cdd55",
    "activationId": "<same value as the runtime's native.activationId>",
    "contextLimit": 524288,
    "execution": { "deviceType": "gpu", "backend": "cuda", "deviceName": "<GPU>",
      "precision": "float16", "fallback": false,
      "stages": [{ "nodeId": "<node id>", "stageIndex": 0, "layerStart": 0, "layerEnd": 28,
        "deviceType": "gpu", "backend": "cuda", "deviceName": "<GPU>",
        "precision": "float16", "fallback": false }] }
  }
}
```

The broker configuration keeps the existing reservation for consumer
`qwen06-cuda-mrpucchi-20261121` and lists
`"requestModels": ["mycellios-qwen3-embedding-0.6b"]`, so coordinator demand
and busy slots count for placement. Placement follows coordinator demand.

### Qualification

`POST /internal/v1/native-replica-qualifications` (admin and network tokens)
runs three normal leases on the target deployment. Each one embeds the query
`What is the capital of Spain?`. Every sample must:

- meet the general native checks (one GPU stage, the right worker, deployment
  and node, zero output tokens, a signed receipt);
- reach a cosine ≥ 0.9995 against a pinned CPU fp32 reference vector
  (`memoryEmbeddingCanaryReference`).

The reference check proves the precision is within bounds and that the
runtime applied the query instruction. The evidence is stored with
`responseKind: "embedding"`. It lasts seven days and is bound to the worker
session and build, so a reconnect or new build needs a fresh run.

### API access

Sign in to the Mycellios account and open **API keys** (`/account?tab=api`).
Create a key for the client and save it in the client's credential store.
Send it as `Authorization: Bearer <key>` to the coordinator. The account can
revoke the key at any time. The coordinator still requires a paired, qualified
node owned by the caller for this embedding route.

- Operator-funded quota: add the key's ID to
  `MYCELLIOS_API_OPERATOR_QUOTA_MODELS_JSON`
  (`{"<apiKeyId>":["mycellios-qwen3-embedding-0.6b"]}`). These requests reserve
  and charge zero tokens and record `api_operator_funded_usage`. Rate and
  concurrency limits still apply (default 30/min, 2 concurrent). Raise them
  only through an approved `api-account-limits.json` override.

### Migration and rollback

1. Deploy the coordinator and qualify a paired Mycellios node. Retain the
   receipt for that node, build, model and activation.
2. Configure the client's API key and run a public canary through the
   coordinator. Require the pinned revision and compatible vectors before
   reusing the stored generation.
3. Verify semantic search from the client and qualify additional devices
   through the same coordinator route.

On rollback, keep the direct device route and its reservation disabled.
Preserve the vector generation and let the client use text recall until a qualified
native route is available again.

## Automatic node replicas

Status: implemented and unit-tested. Off until the operator configures it
(see "Enabling"). Not yet run on a physical node through the coordinator.

An idle paired native node (Mycellios Desktop or the headless native node)
starts, serves and qualifies this replica by itself while its owner account
has demand. There is no per-device pairing bundle and nothing to click. The
standalone worker path above still works unchanged.

### Coordinator

- **Demand.** Every memory embedding request reports its owner account with
  the `demand` event, including requests that found only unqualified
  replicas. `MemoryEmbeddingOwnerDemand` (`src/coordinator/node-replica-demand.ts`)
  keeps the last request time per approved account, in memory.
- **Desired state.** `GET /internal/v1/nodes/<nodeId>/replicas` answers only
  the node's own device session (the same authentication as node commands)
  with `mycellios-node-replicas/1` (`src/contracts/node-replicas.ts`).
  `desired` is true only while the node's owner is listed in
  `MYCELLIOS_MEMORY_EMBEDDING_NODE_REPLICA_ACCOUNTS` and that same account made a
  request within the last 10 minutes (the placement idle window). A node never
  learns about another account's traffic. Older nodes never call the route,
  and a node treats a 404 from an older coordinator as "not desired".
- **Qualification.** The qualification watch accepts a model-bound policy
  next to its explicit `targets` (`src/coordinator/native-qualification-watch.ts`):

  ```json
  { "targets": [],
    "memoryEmbedding": {
      "model": "mycellios-qwen3-embedding-0.6b",
      "modelDigest": "sha256:7ced807793a552878c586b4fc420c5f9edef134abe30e4202b9f2022487cdd55",
      "ownerAccountId": "<operator account id>",
      "buildSourceIds": ["sha256:<approved node build source>"],
      "executions": [{ "backend": "cuda", "precision": "float16" }, { "backend": "mps", "precision": "float16" },
                     { "backend": "directml", "precision": "float32" }, { "backend": "cpu", "precision": "float32" }],
      "maxWorkers": 8 } }
  ```

  The model and artifact identity are literals, so a new artifact is never
  approved implicitly. Every pair must be one of the measured pairs.
  Build sources are explicit, so source drift (a new node build) still needs
  an operator to add its `buildSourceId`. Worker, activation and physical
  node ids are not listed: they are read from the current snapshot, and only
  connected, online workers owned by `ownerAccountId` qualify. The snapshot
  (`/internal/v1/workers`, network token) now includes each worker's
  `ownerAccountId`. Every candidate still runs the same three-sample canary
  (cosine ≥ 0.9995), with the existing three-attempts-a-day cap and backoff.

### Node

Code: `src/node/memory-embedding-replica.ts`, `src/node/memory-embedding-artifact.ts`,
the `nativeReplica` slot of `WorkerAgent` (`src/worker/native-replica-slot.ts`)
and the node-managed mode of `qwen06_embedding_service.py`. Tests:
`tests/memory-embedding-node-replica.test.ts`, the replica case in
`tests/worker-hardening.test.ts` and `NodeManagedTests` in the Python suite.

- **Identity.** The node's own `WorkerAgent` advertises the deployment next to
  its executor and routes only that deployment's leases to the replica adapter.
  The replica therefore uses the node's device identity, owner, sealed
  leases, session and build identity, and its qualification binds to them.
  One activation id is created per start, and the deployment has one slot.
- **Device.** Chosen from the accelerator the node already verified:
  - CUDA → fp16;
  - DirectML → fp32 with 1024-token micro-batches, eager attention and
    `no_grad`;
  - Apple Silicon → MPS fp16;
  - everything else (including ROCm and XPU, which have no measured pair) →
    CPU fp32.
  A GPU choice that does not fit the owner's VRAM offer uses the CPU. A GPU
  backend that fails to load twice falls back to the CPU on that node.
- **Files.** Only the seven pinned files, from the pinned revision, over HTTPS.
  Each file is installed only after its exact size and sha256 match. Partial
  files resume with range requests. The runtime re-hashes all files before
  it listens. The files (1.12 GiB) live under
  `<cache>/memory-embedding/<identity>`, so the owner's disk limit measures
  them. Nothing is downloaded unless the measured cache plus the missing bytes
  stays at least 256 MiB below `maxDiskMiB` and 1 GiB of disk stays free. This
  prevents a repeat of the 2026-11-21 incident. Other identities are evicted.
- **Owner limits.**
  - The replica starts only while contribution is enabled, the node is not
    draining and the owner's work policy admits the model.
  - It needs room within the owner's RAM limit (node RSS plus 2–3.5 GiB,
    depending on the device) and enough free memory. Free memory is not
    checked on macOS, which reports cache as used.
  - Its thread count is the owner's CPU share.
  - It runs below normal priority (Windows priority class, `nice` elsewhere),
    inside the Windows kill-on-close Job when the node has the broker.
  - CUDA pauses at the owner's temperature limit minus 4 °C and resumes at
    minus 9 °C.
  - It runs offline from Hugging Face (`HF_HUB_OFFLINE`).
  - It stops at once when the owner pauses or drains, when the policy or
    limits change, and before the node prepares or starts a distributed stage
    (stages have priority). It does not restart while a stage runs.
- **Unload.** The coordinator keeps the replica desired for 10 minutes after
  the owner's last request. After that, the node stops it once it is idle and
  has run for at least 3 minutes (the placement minimum residency).
- **Python runtime.** A configuration without `tokenFile`, `host` and
  `port` is node-managed. It serves only the native loopback listener;
  there is no bearer-token listener. `qwen06_embedding_service` is now part of
  the shipped Python product (`scripts/native-python-product-policy.mjs`).

### Enabling

1. Coordinator: set `MYCELLIOS_MEMORY_EMBEDDING_NODE_REPLICA_ACCOUNTS=<operator account id>`.
2. Qualification watch: add the `memoryEmbedding` policy above, with the
   build source of the node release that carries this code.
3. The client calls the coordinator with the operator’s API key, as described
   in "API access". The first request answers 503 while
   nodes download and load; the client retries with backoff.

Rollback: unset the variable and restart the coordinator through Nucleus
(nodes stop their replica within about a minute), then remove the policy. The standalone and forwarder paths are
unchanged.

### Release path

Node code ships only in a new native node build:
- `node-build.yml` and `installer-release.yml` build the installers;
- Desktop embeds the pinned runtime MSI.
Nodes do not update their JavaScript by themselves. A paired node gets it
when its owner installs the new release, or when the operator sends an
`update` node command for a published, signed component. That command
updates only `python-product`, so it cannot deliver this change alone.
Desktop preview upgrades stay manual while Windows packages are unsigned.

### Measured versus tested

- **Measured** (2026-11-21/22, forwarder path): the device pairs and their
  speeds.
- **Unit and in-memory tests only:**
  - owner-scoped placement, including split pieces;
  - the demand route;
  - the qualification policy binding;
  - device selection per hardware;
  - hash-checked download, resume and disk budget;
  - the replica lifecycle and gates;
  - lease routing in `WorkerAgent`;
  - the node-managed Python mode.
- **Not yet run:** a real node downloading the files and qualifying through
  the coordinator, and the DirectML pack's `transformers` version against the
  qualified PC replica (4.57.1). The canary gate refuses drift in both cases.

## Phone replicas (Android)

Status: phone-side safety pieces merged, disabled. No phone advertises or
serves this model.

### How phones contribute today

The Android app (`src/agent/apps/android`) is a WebView host. Phones contribute
through the browser worker (`src/mobile/runtime.ts`, `MobileComputeHub`,
`/mobile/v1`): matrix checks, browser expert stages and the GPT-2 text pilot on
WASM/WebGPU. That path is not a native worker. It cannot hold the native
qualification this model requires, and its registration schema is strict, so a
new capability needs a coordinator change that this work does not make.

### Runtime and quality

ONNX Runtime cannot read the pinned safetensors, so a phone uses the ONNX export
`onnx-community/Qwen3-Embedding-0.6B-ONNX` at revision
`c25a394dd583836952667c12f008335071b3f43d`. Its `tokenizer.json` is byte-equal
to the pinned one. Measured on 2026-11-22 with ONNX Runtime 1.22.0 CPU on an x86
laptop (Zen 5, 4 threads), using the pinned tokenizer, left padding, last-token
pooling and the query instruction:

| Export | Canary cosine | Document cosine vs fp16 (min) | Tokens/s | Peak memory |
|---|---|---|---|---|
| `model_fp16.onnx` (fp16 weights) | 0.9999988 | — | 34 | 2.7 GB resident, 3.7 GB committed |
| `model_int8.onnx` (dynamic int8) | 0.905 | 0.848 | 98 | not measured |
| `model_q4.onnx` (4-bit weights) | 0.943 | 0.923 | 35 | not measured |

- Quantization fails the canary gate (≥ 0.9995) by a wide margin, so the int8
  and q4 exports must never be offered. Only the fp16 export is pinned
  (`MEMORY_EMBEDDING_PHONE_FILES`, 1.21 GB).
- The fp16 pass was measured on x86, where ONNX Runtime upcasts to fp32. Arm CPUs
  can run fp16 arithmetic natively, and DirectML fp16 already drifted to 0.987,
  so an Arm result is unknown until it is measured on a phone.
- Throughput and memory on a phone are **not measured**. Scaling the x86 figure
  to phone cores suggests roughly 10-20 tokens/s and more than 2 GB of RAM, which
  is below the 100 tokens/s bar used for CPU backups above and heavy for a
  background app. No ONNX Runtime dependency ships in the APK until a phone
  measurement justifies it.

### What the Android host contains

Package `com.mycellios.android.embedding`, not wired into the app:

- `MemoryEmbeddingPins`: a copy of the contract. `tests/memory-embedding-phone.test.ts`
  fails if it drifts. `PHONE_EXECUTION_ADMITTED` is `false`, matching the empty
  `MEMORY_EMBEDDING_PHONE_EXECUTIONS`.
- `EmbeddingSafetyGate`: work is allowed only when every condition holds, and
  each check fails closed:
  - the owner opted in (off by default);
  - a phone execution is admitted;
  - the phone is charging and at least 50 % full;
  - the battery is below 36.0 °C to start, and work stops at 38.0 °C;
  - the Android thermal status is at most light;
  - power saving is off;
  - the network is validated and unmetered.
  The phone advertises the model only when this gate, a hash-verified artifact
  and an on-device canary (≥ 0.9995) all pass.
- `MemoryEmbeddingRunner`:
  - applies the query instruction;
  - splits work into sub-batches of 2,048 padded tokens, using the replica's
    planning rule, and rechecks the gate before each one;
  - rejects a wrong count or dimension, non-finite values and near-zero vectors;
  - returns L2-normalized vectors.
  Request text stays in memory and errors carry fixed codes only.
- `PinnedArtifactStore`:
  - downloads only the pinned files from the pinned revision into no-backup
    app storage;
  - installs a file only after its exact size and sha256 match;
  - resumes partial downloads and stops between 1 MiB chunks when the gate
    closes;
  - caps the artifact at 1.4 GiB and keeps 2 GiB of free space;
  - re-hashes every file before a load;
  - evicts other identities, artifacts idle for 14 days, and everything when
    the owner opts out.
- `AndroidMemoryEmbedding`: reads battery, thermal, power and network state,
  keeps the opt-in and fetches files over HTTPS. The manifest gains
  `ACCESS_NETWORK_STATE`.
- JVM tests cover the gate, artifact identity and hashes, downloads and
  eviction, sub-batch stopping, output validation and the canary.

### To enable phones

1. Measure the fp16 export on physical Arm phones: canary and document cosine
   against CPU fp32, tokens/s, peak memory and battery temperature while
   charging.
2. If it passes, add the measured pair to `MEMORY_EMBEDDING_PHONE_EXECUTIONS`
   and set `PHONE_EXECUTION_ADMITTED`, then ship the runtime dependency.
3. Add coordinator admission for phone workers, with native-equivalent
   qualification bound to the phone session and build, and an owner opt-in
   control in the app.

## Follow-ups

- Physically qualify the native replica (see "Migration and rollback").
- Run an automatic node replica on a physical paired node through the
  coordinator, after a node release carries it (see "Automatic node replicas").
- Measure the phone path on a physical Android phone (see "Phone replicas").
- Let economic settlement verify CPU stages, so CPU pieces can earn credit.
- Add more CPU backups once nodes have spare RAM (the MSI GE60 has about
  3 GB free while it runs its 4B stage).

## Operating limits measured on 2026-11-21

- MRPUCCHI's cooling is the throughput limit. After hours of load the RTX
  2060 idles near 78-80 °C. Unbounded work peaked at 87 °C and repeatedly
  paused the node (limit 85 °C). The replica pauses at 82 °C and resumes at
  79 °C. The GPU clock is locked with `nvidia-smi -lgc 300,900` (reset with
  `-rgc`; a reboot clears it). At that clock it stays at 79-81 °C, about 70 %
  busy, and the node stays ready. The client receives about 150 chunks per minute.
- The MSI GE60 (i5-4210H) measured 7 tokens/s in bfloat16, which is too slow
  to help, so its replica is installed but disabled. The HP ProBook replica is
  added once its model download finishes, and only if it beats 100 tokens/s.
- The retired 4B CUDA runner (`MycelliosEmbeddingGPU`) was restarting every
  few seconds without a reservation, which added load and heat. It is
  disabled.
- Abandoned requests are cancelled. The entry closes the replica connection
  when the client goes away, and the replica stops between micro-batches. A
  started request waits through a thermal pause instead of failing.

- The HP ProBook CPU replica measured 20 tokens/s (fp32, cosine 0.999998
  against the GPU). It is registered as a backup replica (`"backup": true`).
  The entry first holds up to `holdSeconds` for a regular replica that is
  only cooling, and uses backups only if none returns, so the network keeps
  answering when MRPUCCHI is down without slowing the normal path. Without
  administrator access it runs as a user process, started at logon from the
  user's Startup folder, not as a service.
- The temporary artifact server and its NetBird policy were removed after the
  replicas downloaded the model.

- On 2026-11-21 a MacBook Air M1 (8 GB) joined as a regular replica on the
  Apple GPU (MPS, fp16, weight 2). It measured 380 tokens/s with 64-text
  batches and a minimum cosine of 0.999996 against MRPUCCHI's vectors for
  documents and queries. It runs from `~/Mycellios/qwen06` with its own Python
  3.12 venv (torch 2.13.0, transformers 5.14.1, tokenizers 0.22.2, the same
  pins as the HP) and the hash-verified model. It starts as the user
  LaunchAgent `io.mycellios.qwen06`, so it serves only while the user is
  logged in and the Mac is awake. The forwarder fails over when it sleeps. Its
  peer is in the `mycellios-embedding-replicas` NetBird group. Roll back by
  removing it from the forwarder configuration
  (`config.json.before-macbook-20261121`) and running
  `launchctl bootout gui/$(id -u)/io.mycellios.qwen06`.

- On 2026-11-22 the maintainer's PC (Radeon 890M) joined as a regular replica on
  DirectML (weight 1). It runs `device: "directml"` in float32 with
  1024-token micro-batches: float16 on DirectML gave a minimum cosine of 0.987
  against CPU fp32, and larger micro-batches or the fused SDPA kernel fail on
  this driver. It measured 114 tokens/s (CPU fp32 on the same PC: 117) and a
  minimum cosine of 0.999996 against MRPUCCHI for documents and queries. Once,
  right after a restart, it answered with all-zero vectors; the unit-length
  check above now rejects such output. It runs from `%USERPROFILE%/Mycellios/qwen06`
  (Python 3.12 venv: torch 2.4.1, torch-directml 0.2.5.dev240914,
  transformers 4.57.1) at below-normal priority, started from the user's
  Startup folder, so it serves only while its owner is logged in. Its peer is in
  `mycellios-embedding-replicas`; Windows Firewall already admits the
  NetBird interface. Roll back with the forwarder's
  `config.json.before-pcdani-20261122` and by deleting the Startup entry.
