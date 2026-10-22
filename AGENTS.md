# Mycellios repository rules

These rules apply to the complete repository.

## Product direction

- Mycellios is an independent distributed inference runtime.
- The network vision includes phones, laptops, desktop PCs and servers as
  contributing compute nodes. Illustrations must reflect that role; distinguish
  the intended network from verified hardware and runtime support.
- Network overview illustrations use a distributed peer mesh, with mixed device
  types and multiple connections per node, rather than a fixed device sequence.
- The immediate product gate is a reproducible native route across two physical
  computers. Prefer fixes that unblock or measure that route over new surfaces.
- Do not present simulation, loopback or single-host execution as multi-host
  evidence.

## Repository structure

- npm is the only supported JavaScript package manager. Commit
  `package-lock.json`; do not add pnpm or Yarn workspace/lock files.
- Keep current code inside its owned top-level area. Do not add a new top-level
  directory when an existing area is appropriate.
- Shared protocol and API contracts belong under `src/contracts`. Product
  surfaces consume contracts; contracts must not import a product surface.
- The Python data plane belongs under `python/distributed_runtime`. TypeScript
  launch/orchestration code belongs under `src/distribution`.
- Generated output, model caches and runtime state are not source.

## Documentation

- `README.md` is the entry point and `docs/README.md` is the documentation map.
- README artwork belongs under `assets/readme/`. Keep brand illustrations and
  conceptual diagrams distinct from screenshots or measured runtime evidence.
- Capability claims live only in `docs/STATUS_AND_EVIDENCE.md`.
- Keep active documentation within the canonical set enforced by
  `npm run verify:structure`; update that gate intentionally when adding a
  durable document.
- Dated investigations, handoffs and completed specs are not active docs.

## Changes and verification

- Preserve unrelated worktree changes.
- Use a spec for medium or large cross-area changes; fold durable outcomes into
  canonical docs when complete.
- Run `npm run verify:structure`, relevant focused tests and `npm run typecheck`.
- Run `npm run verify:architecture` when changing imports, source areas or a
  module tracked by the size ratchet.
- Physical tests that cannot run must be reported as skipped or unavailable,
  never as passing.
- Do not commit or push unless the user explicitly requests it.

## Optional speech replicas

- Kokoro uses an explicit native replica adapter, not the Transformers layer planner.
- Its loopback runtime owns model loading; the existing worker owns admission and leases.
- Speech bytes are bounded independently from max_tokens and never counted as output text tokens.
- Speech defaults to English/af_heart, with explicit Spanish support, allowlisted voices and speed 0.5..2; include controls in request identity and validate returned controls.
- Input usage is the cl100k_base count of the synthesized text. Set AntSeed speech pricing explicitly; never bill audio bytes as output tokens.
- Test with tests/kokoro.test.ts and tests/kokoro-network.test.ts; real model tests are opt-in.
- Standalone replicas redeem account-confirmed bundles through MYCELLIOS_WORKER_ENROLLMENT_PATH.
- The worker owns the shared enrollment bootstrap; the native node keeps a compatibility re-export.

- Operator-funded quota is opt-in per API key ID and model; preserve limits and persisted usage accounting.

## Experimental native decision graphs

- `python/distributed_runtime/decision_graph.py` partitions serialized ggmlc graphs
  without executing or dequantizing weights. Preserve every live dependency and
  require source and shard hashes. Verify with `python -I -S -B -m unittest
  discover -s python/tests -p 'test_decision_*pure.py'`.
- `decision_stage.cpp` is a bounded Windows stdio QA primitive linked against the
  pinned external ggmlc runtime. It grants no network or public job admission.
  The parent owns authenticated transport, artifact verification and owner limits.
- Its native invocation requires the actual actor PID and a 1..240000 ms wall
  budget after `shard cpu threads mmap`. A child-owned Job handle alone does not
  stop work when Python dies. Preserve the independent parent-process handle and
  deadline watcher. Validate new binaries on Windows with
  `python/tests/check_decision_owner_windows.py`; this probe loads no model.
- Never describe independent decisions or single-host partition tests as execution
  of one distributed model. Keep AntSeed offers gated on physical and buyer proof.
- `decision_reverse.py` is CPU-only private qualification transport. Its tickets
  grant no public admission or GPU reservation. Retain pinned TLS, distinct node
  credentials, distinct physical identities, bounded frames/deadlines, an explicit
  qualification expiry and idempotent result redelivery, including native failures.
- Native qualification deadlines must also end at the fixed qualification expiry;
  stop the private listeners at expiry instead of silently extending their scope.

- Correct Kev preprocessing requires the pinned original HF tokenizer and tokenizers
  0.22.2. Reject the mislabeled Gemma GGUF preprocessing; approximate GPT-2 regex
  tokenization is not a replacement. Preserve the embedded, already-baked temperature.
- Native decision serving uses `decision_gateway.py`, `decision_broker.py` and
  `decision_actor.py`: a source-bound physical activation receipt, authenticated
  loopback worker token file, parent native leases, short monotonic remote permits,
  and local owner/resource guards are required. Qualification mode cannot accept
  public leases. The pilot admits one question, 256 tokens, batch/concurrency 1.
- `scripts/antseed-jev-provider.mjs` is optional and requires the official AntSeed
  SDK at `ANTSEED_PROOF_MODULES` (as for speech proofs). Importing it must not
  announce a seller. Its isolated probe is `node scripts/check-antseed-jev-provider.mjs`;
  this verifies SDK transport/free configuration only, never real buyer delivery.
- Optional private AntSeed ingress uses `MYCELLIOS_PRIVATE_BASE_URL` and the
  same authenticated API/key limits. It binds loopback only, accepts only `jev`,
  and retries only explicit account-concurrency rejection for at most 30 seconds.
  Verify with `node scripts/check-antseed-jev-bridge.mjs`. Never retry failed
  model execution or broaden an account's concurrency to make a canary pass.
- Native CPU observations preserve the existing units and owner limits. Use at least
  five seconds per CPU sample, coalesce overlapping observations and reset the
  startup baseline only when monitoring begins. Keep thermal/RAM/disk checks and
  snapshot reconciliation ordering intact.
