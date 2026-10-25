# Architecture

Mycellios combines a TypeScript control plane with Python model executors. The
control plane decides what should run and where; the data plane performs the
model computation and moves activations between assigned ranges.

## End-to-end flow

1. **Profile** — inspect model metadata and tensor headers without loading the
   complete checkpoint.
2. **Plan** — select compatible nodes and contiguous layer ranges using memory,
   compute and directed-link observations.
3. **Compile** — create a sealed runtime manifest and an exact Python launch
   description.
4. **Launch** — local or authenticated remote agents start only commands present
   in the allowlisted launch description.
5. **Activate** — the supervisor waits for every stage, checks health, runs a
   generation canary and publishes the route.
6. **Infer** — the coordinator admits requests; stages retain their local state
   and exchange activations through persistent direct or relayed channels.
7. **Recover or drain** — route failure is explicit. Recovery creates a sealed
   replacement route; shutdown verifies that supervised processes have ended.

## Main components

| Component | Responsibility |
| --- | --- |
| Coordinator | Public API, node registry, admission, route activation and model catalogue |
| Planner | Feasible placements, range boundaries and cost/risk evaluation |
| Launch supervisor | Ordered startup, readiness, canary, rollback and cleanup |
| Launch agent | Authenticated, allowlisted process lifecycle on a node |
| Runtime transport | Direct secure streams, multiplexing and bounded relay fallback |
| Python stage | Selective model loading, prefill/decode, local cache and downstream forwarding |
| Worker/node | Enrollment, capacity truth, tunnels, diagnostics and contribution controls |

## Runtime invariants

The React web and browser-worker surfaces compose `landing/src/ui` primitives
and patterns. Storybook under `landing/.storybook` consumes those same production
exports; it does not own an independent implementation. The UI kit depends on
React and presentation libraries, never on coordinator or inference internals.
`verify:ui-kit` enforces native-control ownership and catalog coverage.

- Unknown models and uncertified layouts fail closed before launch.
- A node receives an explicit range; it is not treated as a generic remote
  command runner.
- Artifact, build and route identities are checked across control and data
  planes.
- Activation-integrity evidence is accepted only when its committed seed,
  suspect/trusted sketches and recomputed verdict agree; an absent challenge is
  never inferred to have passed.
- A direct channel cannot silently downgrade after application bytes move.
- Model registration happens only after readiness and canary success.
- Stage checkpoint control is local to the supervised launch. Unix uses a
  workspace socket; Windows uses an authenticated loopback endpoint whose
  descriptor is signed with a per-launch secret. Capture and restore execute
  on the stage thread, and control requests retain bounded framing and timeout
  limits. Queued mutations are cancelled when the caller disconnects, times out
  or closes the launch. A mutation already executing remains stage-owned. The
  launcher owns the secret and endpoint lifecycle.
- Simulations and loopback measurements never count as multi-host evidence.

## Supported execution shapes

The mature path is a contiguous pipeline. The repository also contains native
tensor- and expert-parallel cells, speculative execution and recovery
machinery. Those capabilities remain conditional on their documented hardware
and evidence gates; they do not change the first milestone: prove the ordinary
pipeline across two physical machines.

## Optional speech controls

The chat contract carries Kokoro language (`en` by default, `es` optional),
allowlisted matching voices and speed 0.5..2. English defaults to `af_heart`;
Spanish defaults to `ef_dora`. The coordinator includes normalized controls in
request identity and forwards them through its generation checkpoint. The worker
passes them to a loopback runtime sharing one CPU model across both language
pipelines. The coordinator verifies returned language, voice and speed together
with the bounded WAV hash before accepting a completion. Audio is never output
text usage. AntSeed metadata declares `language`, `voice`, `speed`; end-to-end
support additionally requires the gateway to preserve those request fields.
