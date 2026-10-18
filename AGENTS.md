# Mycellios repository rules

These rules apply to the complete repository.

## Product direction

- Mycellios is an independent distributed inference runtime.
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
