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

- Reusable web controls live in `landing/src/ui`. Use the production kit in every
  surface and import the same components in Storybook; do not add parallel demo
  implementations or native controls outside the kit. Run `npm run verify:ui-kit`.
- Primary action buttons use flat colors without decorative borders or shadows.
  Segmented controls may use the subtle selection shadow from the Agent reference.
  Control variants, heights, radii and keyboard focus belong to
  `landing/src/ui/ui.css`. Preserve
  native form behavior, refs, disabled states and accessible names.
- The default Agent profile uses Geist Variable and the Agent paper/stone palette
  through `landing/src/ui/agent-style.css`: warm off-white canvas, pale stone cards,
  subtle warm edges and deep moss actions, with a neutral gray dark mode. The previous
  Graphite/amber design remains available as the classic profile. Keep both
  profiles scoped separately and selectable in Storybook.
- Agent component colors and interaction states belong to
  `landing/src/ui/agent-components.css`, using the semantic tokens in
  `agent-style.css`. Keep legacy page colors out of this profile; ordinary
  icons are neutral and status indicators retain semantic success/warning/error.
- Agent spacing, surface radii and motion belong to `agent-style.css`. Native
  disclosures animate their real height; preserve reduced-motion preferences and
  the sidebar's geometry transitions when adding control transitions.
- Overview shows one network summary and active models. Keep setup, device tables,
  topology, runtime telemetry and activity in closed detail groups; use
  `landing/src/overview.css` and the production Overview stories for this layout.
- The panel has no built-in chat. Mycellios Agent owns the conversation UI; keep
  legacy `view=chat` and `view=inference` links mapped to Overview, without removing
  the coordinator API used by Agent and other clients.
- `ReferenceLanding` is the default network-first marketing page: a centered
  introduction, a large computing-fabric illustration and API/device entry points
  in the network chapter. `NetworkPrint` applies a bounded WebGL print treatment
  with a plain image fallback and reduced-motion support. It follows the supplied
  Compute/Antseed/Rakazo references with Geist and the shared UI kit. Keep the
  artwork centered in normal document flow, without scroll-driven panning or
  scaling; connection content follows below it. Its artwork and Agent workspace
  are concepts and local examples, never telemetry or real tool execution.
  Storybook imports those same production components.
  Use the mushroom artwork by default, without an artwork selector. `?art=fabric`
  restores the exact original asset; both variants share the renderer and layout.
  Keep Agent, Create, Earn, Token (Staking, Treasure, Data), Live network,
  GitHub/X/Telegram and Login accessible in desktop and mobile navigation, using
  the production controls. Docs remains available in the page and footer.
  Preserve the rejected `AssemblageLanding`
  with `?landing=assemblage` and the
  previous `RootedLanding` with `?landing=rooted`, `ModernLanding` with
  `?landing=saved` and the earlier complete page with `?landing=previous` (and
  optional `&hero=dark`). Only the earlier page preloads the WebGL mushroom
  renderer. Keep reference-specific styles within `mycellios-reference`.
- Other panel screens use `landing/src/panel-minimal.css`, the shared SummaryStrip
  and single-title PanelDisclosure. Keep secondary tables/filters behind disclosures
  and preserve visible actionable errors, authorization and payment safeguards.
- Use flat fills across themes, including decorative CSS, SVG and canvas artwork.
  Do not introduce gradients; `verify:ui-kit` enforces this rule in web sources.
- Run `npm run storybook` for the local catalog and `npm run storybook:build`
  when changing shared components. Config lives in `landing/.storybook`.

- Preserve unrelated worktree changes.
- Use a spec for medium or large cross-area changes; fold durable outcomes into
  canonical docs when complete.
- Run `npm run verify:structure`, relevant focused tests and `npm run typecheck`.
- Run `npm run verify:architecture` when changing imports, source areas or a
  module tracked by the size ratchet.
- Physical tests that cannot run must be reported as skipped or unavailable,
  never as passing.
- Do not commit or push unless the user explicitly requests it.

## Execution route admission

- Session affinity must be revalidated and rescored from current worker capacity,
  exact deployments and measured forward/return links. Cached scores are not
  current capacity evidence. Respect disabled pipeline dispatch on cached routes.
- Evaluate bounded complete pipeline alternatives including the return path before
  applying route policy. Recheck the exact immutable request immediately before
  offering a lease; use only compatible preplanned standbys if eligibility changed.
- Verify with `npx vitest run tests/capacity-dispatch-hardening.test.ts
  tests/scheduler.test.ts tests/mesh-failover.test.ts tests/kokoro-network.test.ts`.

## Optional speech replicas

- Keep worker heartbeats bounded independently of adapter and hardware probes.
  Missing adapter observations close admission without cancelling active leases;
  do not reuse late readiness or launch duplicate probes while one is pending.
- Native embedding/speech qualification requires both operator credentials, three
  normal completed leases, validated outputs and current session/build/activation
  binding. Preserve zero generated-text tokens and strip worker-declared evidence.
- Per-worker maintenance blocks new lease offers at dispatch while keeping active
  work and heartbeats. Release it without overriding an owner's pause state.
- Worker maintenance does not close HTTP job admission. An empty jobs query is
  not a global drain; coordinator replacement requires a common admission
  barrier and a handoff that preserves active calls and original deadlines.
- Native requalification may refresh only explicitly approved worker/build/model/
  activation/node tuples. Keep the three-attempt daily cap and uncertain-request
  backoff; source drift requires operator approval, not a widened allowlist.

- Kokoro uses an explicit native replica adapter, not the Transformers layer planner.
- Its loopback runtime owns model loading; the existing worker owns admission and leases.
- Speech bytes are bounded independently from max_tokens and never counted as output text tokens.
- Speech defaults to English/af_heart, with explicit Spanish support, allowlisted voices and speed 0.5..2; include controls in request identity and validate returned controls.
- Input usage is the cl100k_base count of the synthesized text. Set AntSeed speech pricing explicitly; never bill audio bytes as output tokens.
- Test with tests/kokoro.test.ts and tests/kokoro-network.test.ts; real model tests are opt-in.
- Standalone replicas redeem account-confirmed bundles through MYCELLIOS_WORKER_ENROLLMENT_PATH.
- The worker owns the shared enrollment bootstrap; the native node keeps a compatibility re-export.

- Operator-funded quota is opt-in per API key ID and model; preserve limits and persisted usage accounting.
- Startup settles zero-token restart reservations only after interrupted jobs are
  marked failed and before public admission. Preserve account state and live,
  completed, unlinked or refund-bearing reservations.

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
- Pinned AntSeed gateway calls for `jev` must select
  `X-Antseed-Provider: mycellios-decisions`. On a seller with several providers,
  omitting this selector can attribute another provider's price to the response.
  Verify a real successful buyer receipt with `served_free=1`; never rewrite an
  earlier receipt to make that gate pass.
- Select seller providers explicitly when an upstream is unavailable; preserve
  original configuration, identity and remaining prices. Passing an existing
  buyer request does not establish discovery while the official gas guard pauses
  announcements. Never bypass that guard or infer permission to fund a wallet.
- Runtime descriptors may contain credentials in argument arrays. Read only
  allowlisted fields; never print complete descriptors, environment or vault
  exports. Rotate exposed credentials in the canonical vault and all consumers,
  then verify new acceptance and old rejection without logging secret values.
- Decision actor control traffic may reuse authenticated TLS channels. Keep poll/
  result and active permit channels separate; authenticate each request and close
  invalid framing/authentication paths. Preserve all existing permit, deadline,
  owner, freshness and frame bounds; do not replay uncertain model execution.
  Preserve bounded owner-cancellation codes without logging request data.
  Authenticated health may include bounded executor observations; accept the
  optional field and reject stale, unavailable or duplicate stage observations.
  Full-context AntSeed qualification uses SSE and must reach the successful final
  result/usage and terminal event. Preserve absolute native leases and bounded
  local HTTP responses; do not increase shared provider/buyer timeouts.
- Native CPU observations preserve the existing units and owner limits. Use at least
  five seconds per CPU sample, coalesce overlapping observations and reset the
  startup baseline only when monitoring begins. Keep thermal/RAM/disk checks and
  snapshot reconciliation ordering intact.
- The managed CUDA embedding launcher is `scripts/embedding-gpu-bootstrap.py`.
  It uses normal process priority inside the existing Windows Job; preserve the
  pre-import barrier, owner CPU/memory quotas and kill-on-job-close behavior.
  Check the launcher with `python tests/embedding_gpu_bootstrap_test.py`.
