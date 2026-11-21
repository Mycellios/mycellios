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
| CPU replica (fp32, backup) | HP ProBook `100.102.123.237:18495` |
| Failover entry | control server `10.48.0.10:18495`, systemd `mycellios-qwen06-forwarder` |
| Client | Jarvis API on prod-apps-01 (`10.48.0.6`) |

- **GPU vs CPU vectors.** A canary on four cases gave a minimum cosine of
  0.999997 between the GPU (fp16) and the CPU (fp32) vectors, so the CPU
  backup produces interchangeable vectors.
- **Access control.** NetBird policy `mycellios-memory-embeddings` allows
  only the control server to reach port 18495 on the replica group. Windows
  Firewall on each PC admits only `100.102.50.179`. The forwarder admits only
  Jarvis and loopback. Requests carry a bearer token.

## Contract

- `POST /v1/embeddings` with
  `{"model":"Qwen/Qwen3-Embedding-0.6B","input":[...],"input_type":"document"|"query"}`
  (1..64 inputs, truncated at 8192 tokens).
- `query` makes the server apply Qwen's official query instruction; clients
  never add it.
- The response is OpenAI-shaped, with `revision` and L2-normalized 1024-dim
  vectors.
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
- Jarvis side: nodecodex-org/jarvis PR #451, which adds migration 0232, the
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
