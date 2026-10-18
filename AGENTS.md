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

## Archived Apple Silicon client release

- `.github/workflows/macos-client95.yml` builds the existing authenticated public
  client95 archive in a separate subdirectory. The orchestration Git revision and
  archived payload source identity are distinct; never relabel the checkout's
  package version or publish a replacement source ZIP through this workflow.
- Archive verification uses `scripts/verify-macos95-source.py` and the exact
  `config/macos95-source-allowlist.json`; installer lifecycle evidence is produced
  by `scripts/macos95-install-canary.mjs` on a hosted arm64 Mac, without production
  enrollment. Hosted service restart does not prove a physical reboot or GUI pairing.
- Mac-only client95 repairs are sealed by `config/macos95-mac-patch.json` and
  `scripts/derive-macos95-source.py` with their own source identity. Preserve the
  original archive and Windows95 identity; installer evidence must name the
  derived payload and distinguish the ephemeral client95 API from production.
