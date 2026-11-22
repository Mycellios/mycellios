# Operator memory embeddings: Qwen3-Embedding-0.6B

Status: in production (opened 2026-11-21).

## Decision

Jarvis memory (190,594 chunks, about 29M tokens) moves from
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
models are never mixed: Jarvis stores 0.6B vectors in their own column.

## Topology

| Piece | Where |
|---|---|
| GPU replica (fp16, primary) | MRPUCCHI `100.102.221.91:18495`, Windows service `MycelliosQwen06` |
| Apple GPU replica (MPS fp16, shares load) | MacBook Air M1 `100.102.252.212:18495`, user LaunchAgent `io.mycellios.qwen06` |
| DirectML replica (fp32, shares load) | PC-DANI Radeon 890M `100.102.1.112:18495`, user Startup entry `mycellios-qwen06.vbs` |
| CPU replicas (backup / disabled) | HP ProBook `100.102.123.237:18495`, MSI GE60 `100.102.242.239:18495` |
| Failover entry | control server `10.48.0.10:18495`, systemd `mycellios-qwen06-forwarder` |
| Client | Jarvis API on prod-apps-01 (`10.48.0.6`) |

- **GPU vs CPU vectors.** A canary on four cases gave a minimum cosine of
  0.999997 between the GPU (fp16) and the CPU (fp32) vectors, so the CPU
  backup produces interchangeable vectors.
- **Access control.** NetBird policy `mycellios-memory-embeddings` allows
  only the control server to reach port 18495 on the replica group. Windows
  Firewall on each PC admits only `100.102.50.179`. The forwarder admits only
  Jarvis and loopback. Requests carry a bearer token.

## Distribution

The failover entry spreads requests by weighted least load (active
connections per unit of weight: GPU 2, each CPU 1), so every ready replica in
the network takes part instead of the GPU alone. A GPU replica reports
`ready: false` (state `cooling`) while it is above its thermal pause
threshold (81 °C, resume 76 °C on MRPUCCHI), so new work goes to the other
replicas until it cools. Jarvis keeps four requests in flight with a
180 s timeout (`backfillConcurrency`, `requestTimeoutMs` in its state file)
so the slower CPU replicas stay busy too. Replicas fetch the pinned model
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
- Jarvis side: the private Jarvis repository, PR #451, which adds migration 0232, the
  client, the resumable backfill and the search switch.

## Operations

- Model weights live outside the node cache
  (`C:\ProgramData\Mycellios\Qwen06\model`). Writing them under
  `C:\ProgramData\Mycellios\Cache` trips the node's disk limit and pauses its
  contribution; this happened once on 2026-11-21.
- The token is stored in `C:\ProgramData\Mycellios\Qwen06\token` (SYSTEM and
  Administrators only) and in Jarvis state
  `secrets/memory-embedding-qwen06.json` (mode 600).
- Rollback:
  - stop the Jarvis backfill and leave search on its previous vector; the 4B
    and Gemini columns are untouched;
  - stop `MycelliosQwen06`;
  - remove its replica from the broker configuration.

## Follow-ups

- Admit this replica through the coordinator as a qualified native replica
  (adapter, deployments, receipts) instead of a direct private service.
- Add more CPU backups once nodes have spare RAM (the MSI GE60 has about
  3 GB free while it runs its 4B stage).

## Operating limits measured on 2026-11-21

- MRPUCCHI's cooling is the throughput limit. After hours of load the RTX
  2060 idles near 78-80 °C. Unbounded work peaked at 87 °C and repeatedly
  paused the node (limit 85 °C). The replica pauses at 82 °C and resumes at
  79 °C. The GPU clock is locked with `nvidia-smi -lgc 300,900` (reset with
  `-rgc`; a reboot clears it). At that clock it stays at 79-81 °C, about 70 %
  busy, and the node stays ready. Jarvis receives about 150 chunks per minute.
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
