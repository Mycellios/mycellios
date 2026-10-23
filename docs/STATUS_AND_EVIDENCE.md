# Status and evidence

Updated: 2026-09-25 (economic and token status).

## Implemented and connected

- model profiling, certified adapters and contiguous range planning;
- deterministic runtime manifests and launch descriptions;
- local and authenticated HTTP launch agents;
- staged startup, readiness, canary, registration and cleanup;
- streaming API and persistent runtime transport;
- direct-channel selection with bounded relay fallback;
- recovery orchestration and execution traces;
- commit-first activation-integrity sketches with a Torch-free control-plane
  verifier and optional binding inside signed physical receipts;
- physical campaign, evidence import and gate-report tooling.

## Verified in automated or single-host runs

- selective Llama and Qwen-family pipelines;
- real subprocesses and sockets on one host;
- CPU pipeline parity and greedy kill-and-resume recovery;
- local direct/relay transport behavior and rejection paths;
- tensor/expert cell contracts and supported CPU fixtures;
- coordinator, worker, activation, security and packaging policies.

The normal test suite validates software behavior. Opt-in physical tests are
skipped when their required model, GPU or host environment is unavailable.

## Economic and token status

The source includes usage-based pricing and an internal ledger that allocates
contributor credits from execution and contribution evidence. Each settlement
is balanced and produces a signed receipt bound to its job, pricing policy and
evidence. The readiness contract defines internal compute credits as
non-monetary, non-transferable and non-withdrawable.

The public-token readiness state is disabled and has no network selected. It
allows only `no_go` or `eligible_for_spec`; no public Mycellios token or
on-chain contributor settlement is active. Optional stablecoin billing
adapters are a separate inbound-payment path and do not change this boundary.

Any future token decision remains gated on demonstrated need and evidence for
legal, accounting, security, governance, smart-contract and liquidity readiness.
The repository does not commit to a chain, token supply or launch date.

The local development gate enrolls signed workers in its temporary coordinator
database. Its two workers are logical processes on one computer. Cleanup
deadlines remain active until completion and cleanup failures return nonzero.

Activation checkpoint capture/restore retains an owner-only Unix socket on
POSIX. The local candidate adds authenticated loopback control on Windows,
using a signed endpoint descriptor and a per-launch secret. Focused Windows
tests exercised a real TypeScript/Python capture/restore round trip. This
establishes the local control path, not remote recovery after losing a machine.
Windows configuration writes flush the payload before atomic rename;
directory fsync is available only on POSIX.

## Public-quality validation

These changes were validated locally against public main `0e3347f`. Publishing
the source does not establish deployment or physical-host evidence. The
comparison and improvement plan are in
[`ROADMAP.md`](ROADMAP.md), with exact external revisions and source provenance
in [`THIRD_PARTY.md`](../THIRD_PARTY.md).

The changes prevent cross-account session access and retain retry protection
for new and pre-update requests. They cancel work while waiting for capacity or
reading an SSE stream, reject late worker starts and prevent activation during
shutdown. The interface retains drafts and partial
answers, distinguishes intentional stop from failure, preserves selected models
when availability changes, and keeps coordinator connectivity separate from
inference capacity. Studio draft persistence, publication versioning, hot reload
and narrow-screen layout have regression coverage.

The strict Python suite passes: 1079 tests run, 1061 passed, 18 skipped, no
failures or errors. Rank entrypoints no longer import the dense model loader
solely for type annotations. Checkpoint requests still queued after timeout,
disconnect or shutdown cannot mutate stage state later. The CPU collective
fixture keeps its rendezvous port bound throughout process startup, removing
the observed Windows address-in-use race without relaxing parity or timeouts.
An additional Unix-only transport case is skipped on Windows; the original
platform/model prerequisite skips remain separate from passing evidence.
An additional focused checkpoint run passes 16 cases with one Unix-only skip.
It reproduces and fixes slow fragmented input monopolizing the serial control
listener: one 30-second deadline starts at accept and includes framing, queueing
and response. Both unauthenticated slow headers and authenticated slow payloads
expire, after which the same server accepts a legitimate capture.

The complete JavaScript suite passes: 274 test files and 1872 tests passed, with
6 files and 20 tests skipped for their declared prerequisites. The final run
includes the launcher and legacy-idempotency changes. Subsequent package
corrections pass six release-policy tests and ten registry/catalog tests.

Release staging exposed requirements for two optional service files absent from
the public checkout. It now requires the two repository-owned native policies,
and tests copy the real deployment files instead of inventing empty fixtures.
The storage policy now uses the node-update directory variable consumed by the
runtime. Installed adapter metadata resolves from the package, independently
of an external importer's entrypoint or working directory. Optional Content Hub
and Supabase configuration remain available through their existing settings.
No deployed configuration or stored data was migrated during these checks.

The final production build and sealed coordinator staging pass. Fresh child
processes resolve only staged dependencies, serve the staged landing/mobile
assets, expose loopback health with the matching build identity, and exit with
their listeners closed. Both the server library and actual coordinator CLI
entrypoint are exercised. On Windows the CLI check invokes its installed
SIGTERM handler; it does not claim a physical operating-system signal test.

The native development gate completed real CPU inference through two signed
logical workers and two stages on this computer, with matching canary/routed
output and drained resources. Browser checks covered home, chat and Studio at
desktop/narrow widths, including light/dark cancellation, partial errors,
unavailable capacity and draft persistence against an isolated API fixture.
Neither the fixture nor the native local run is evidence of two physical hosts.
The complete npm dependency audit reported zero known vulnerabilities.

## Not yet demonstrated by committed evidence

- one inference route spanning two physical computers;
- a model that requires the combined memory of several hosts;
- GPU tensor or expert parallelism across machines;
- remote recovery after physically losing a stage;
- P50/P95 latency and sustained throughput on residential LAN/WAN;
- a reproducible comparison showing that Mycellios outperforms another system.
- activation-integrity enforcement using a distinct trusted recompute stage on
  a physical route (the contract exists, but no such receipt is committed).

## Evidence policy

A physical claim is accepted only when the artifact records at least:

- commit/build and model artifact identities;
- distinct machine identities and assigned layer ranges;
- transport mode and directed link measurements;
- exact canary/parity result;
- TTFT, TPOT, tokens per second and peak memory;
- process cleanup, plus the outcome of an intentional failure when recovery is
  claimed.

Existing files in `benchmarks/` are retained local/loopback evidence. They are
useful regression baselines, but none proves a two-computer route.

## Benchmark taxonomy

Physical reports separate control overhead, process startup, model loading,
activation transfer, TTFT, TPOT, sustained tokens/s, peak memory, cleanup and
recovery. Every result is bound to an exact source/build, operating systems,
hardware and drivers, model revision, assigned ranges, topology and transport.
An optimization comparison uses the same model and topology on both sides and
must retain output parity; loopback measurements cannot establish a multi-host
performance claim.

## Next gate

Run the native contiguous pipeline on two computers using
[`TWO_HOST_QUICKSTART.md`](TWO_HOST_QUICKSTART.md). Do not add a new engine or a
new product surface before that run identifies a concrete missing capability.

## Optional speech replicas

The implementation adds a native Kokoro replica adapter to the existing Mycellios
worker/scheduler/chat route. Its artifact-pinned loopback runtime returns bounded
PCM16 WAV in a versioned JSON chat-content envelope. Input usage is a real
cl100k_base text count; audio bytes are not billed as output text tokens.

An isolated Linux CPU run produced real speech through an authenticated
Mycellios worker and the unmodified AntSeed openai provider and secure P2P SDK
(@antseed/node 0.2.147, provider-openai 0.2.52). One sample delivered 3.85 seconds
of audio in 2312 ms, with 17 input tokens and zero output tokens. The receipt and
audio are local runtime artifacts, not committed physical-network evidence.

The coordinator was subsequently promoted from the exact verified immutable
image eb595a4bf825427e1acc0c0edc06317a4f65c7f0f21e5c4c58ca9c4547b15506,
serving revision 54506128fc3bac6137ed17a8add164f8ba56f359 as version 0.2.120.
Its operator overlay retained 321 unrelated production JavaScript modules byte
for byte; the existing physical node connections and persistence were checked.
The exact image also passed isolated real Kokoro delivery through AntSeed.

On 2026-10-18, three owned Windows PCs redeemed separate account-confirmed
one-shot grants and connected their speech replicas. Their LocalService services
use the existing CPU interpreter plus isolated optional dependencies, two CPU
threads and one concurrent request per replica. Each produced real loopback WAV;
the production coordinator then completed three concurrent speech API requests.
All three replicas had completed production jobs and remained connected.

The standalone CLI release is based on integrated main
e010d317cd462057791c10e2cae9b7ada8fe4677, with worker version 0.2.121 and
source ID e5069c8f5e4acbbc8e7a2949e51b0a8b09707a067cd5123178182b220ced0a8c.
Its operator artifact retained 327 unrelated JavaScript modules; the exact
compiled CLI passed account enrollment and completion against the preserved
production admission boundary before promotion.

The existing public AntSeed seller subsequently advertised mycellios-kokoro-es
through its unmodified openai provider, pointing to the authenticated public
Mycellios API. An actual AntSeed gateway request returned job
job_9be630d1ea5b4789844c705824279996, also recorded as completed by the production
coordinator on the physical HP replica. The verified WAV contained 4.125 seconds
of audio, delivered in 3706 ms, with 17 input tokens and zero output tokens;
SHA256 b35eb4ecd78629579fcae23bcff254d52368be1f069903674808b87adff58aee.
The seller identity and unrelated research/GPU service configuration were retained.
Receipts and audio are retained as operator artifacts rather than committed binaries.

The offer subsequently changed to USD 6 per million input tokens (cached input
also 6), with zero output price. An explicit operator-funded key/model quota
policy now prevents the dedicated Kokoro seller key from consuming the owner
account starter quota; authentication, revocation, rate/concurrency limits and
actual usage counters remain active. This is an operator-funded route, not an
automatic exemption for unrelated keys, models or third-party compute.

Coordinator 0.2.122 is deployed from main
67a72c97d283ec0c388e4e564c586cd6a1b93504, immutable image
18db4ed982f9a0ad36ca2b12c2a76f2494face114f463063d81c03c6b40208df,
source ID c6f74871605a7324e56e56ed1aa731ec358a02bf855745f7aa2c5f943f3752da.
The overlay retained 328 unrelated JavaScript modules. Its exact compiled code
passed a real admitted speech request with zero account quota before promotion.

Paid gateway request job_56eb18fe03784ad18d5db91fb9c40c40 completed on the
physical MRPUCCHI replica: 14 input tokens, zero output tokens, 4.125 seconds of
verified audio. The account balance remained 24876 before and after the request.
Its gross voice charge was 84 micro-USDC. The shared buyer channel also included
458 micro-USDC of research, so the combined 542 micro-USDC settled as 521 to the
seller and 21 protocol fee. Base transaction
0x5cd390fa90006ceb557619591bfe265b3e2a7a8f4e29a3bf1260464b03647eaa
succeeded at block 52772381; its USDC Transfer logs were independently checked.
The commission belongs to the combined channel, not an isolated voice payout.

This was a controlled test between operator-owned buyer/seller accounts, not
external customer revenue. ANTS rewards for this route remain unverified and
must not be inferred from USDC settlement or self-test traffic.

### Kokoro voice controls: source and isolated physical pilot (2026-10-18)

English is the default; Spanish is explicit via language=es. The request accepts the five documented voices and speed 0.5 through 2. Contract, coordinator dispatch, request identity and response checks have focused automated coverage. An isolated MSI CPU pilot generated English default, English male, slow, fast and Spanish audio: the same 14-token English text produced 6.5 seconds at 0.8 and 4.45 seconds at 1.2. No public-path deployment or OmniRoute/AntSeed control verification is claimed by this entry. Existing Kokoro pricing remains zero.
## Experimental Kev decision graphs

Physical qualification and serving rollout, 22 October 2026. **Not yet a
validated public service.** The zero-price AntSeed offer was announced, but the
decision worker is held offline after the full-context buyer probe failed.
The requested `jev` alias identifies independent [Kev-4B](https://huggingface.co/jaredpalmer/kev-4b),
not TypeSafe Jev weights. It scores supplied choices and returns a choice, p(true)
(`noul`), or probability-weighted level (`score`); it generates no prose or output tokens.

### Pinned artifacts and preprocessing

The Apache-2.0 [Q8 graph](https://huggingface.co/mys/kev-4b-GGUF) revision is
`9e37a4eb7def2f73a1bd1301218b063a48ad12c9`, 4,498,493,152 bytes, SHA-256
`51c9353a5ff0b8e2f7cd7262359c0b26ea54b327214fe26a5da52b505b2978e8`.
It is a serialized ggmlc graph, not a llama.cpp file. The compiled artifact supports
2048 tokens and 16 options; this experimental serving contract admits **at most
256 input tokens, one question, batch 1 and one simultaneous whole-cell job**.
The embedded temperature is already baked into the head; applying another one is incorrect.

The community converter incorrectly labels this Qwen vocabulary as Gemma/Metaspace.
All 248,077 vocabulary IDs and 247,587 merges match the original Kev checkpoint
at `6cfce5c2fa4b4bd64026336ab649c5ca78857d52` exactly. Correct preprocessing uses
its NFC/Unicode Split/ByteLevel tokenizer, SHA-256
`06b9509352d2af50381ab2247e083b80d32d5c0aba91c272ca9ff729b6a0e523`,
and official tokenizers 0.22.2. Merely relabeling the approximate C++ tokenizer
as GPT-2 is insufficient: a hyphenated English fixture still tokenizes differently.
Actual input tokens are billed; padding to at least 64 positions is not billed.

### Physical execution and numerical checks

Each laptop holds only its required weights. The three stages cover blocks 0..7,
8..19 and 20..31 plus the decision head. Their shard SHA-256 values are respectively
`1ea5b923a3359eb3d6ecd683792b6723795c8d2fdf3d2a31d50219bf109dc325`,
`02df8d07f3d7c7e47829cbb55d73c4a18d39096a5ed030f97333be9c7a64a6a5`,
and `23fd6d438241135c4a23dab917dc81691d361ffca786aa84b7c1bc6dc23d6e35`.
Original source bytes reconstruct to the exact full-model hash. Live dependencies
crossing multiple stage boundaries are retained, rather than independently scoring
questions on separate computers.

With the correct original tokenizer, six complete decisions executed on three
distinct owned Windows laptops over NetBird Internet relay:

| Fixture | Actual tokens | Whole request |
| --- | ---: | ---: |
| Billing, English | 55 | 105.74 s |
| Billing, Spanish | 72 | 104.68 s |
| Explicit fact, English | 32 | 93.98 s |
| Explicit fact, Spanish | 37 | 88.28 s |
| Severity, English | 38 | 91.09 s |
| Severity, Spanish | 47 | 99.64 s |

These are six functional examples, not an accuracy benchmark or a latency SLA.
An unpartitioned run of the exact original Q8 artifact in an isolated, networkless
existing server container reproduced the English billing fixture's 16 logits
exactly: maximum difference zero. It selected billing with probability
0.9715933970626583. The reference had a different I/O/CPU budget, so its latency is
not comparable with the laptops.

The subsequent native sublease gateway also completed that fixture across all
three laptops in **90.63 s**, 55 actual input tokens, zero output tokens. Its
source identity is `a021aee22d58d74d3cc1bbfdfd21ec71e9ba1873a1e400c1a0313d8bad99d6b6`.
An activation receipt binds this route, exact source closure, tokenizer, physical
identities, input frame and full-model reference; its maximum logit difference is
zero. This is still private qualification, not account enrollment or public buyer proof.

### Resource and failure controls

The earlier mapped CPU executable SHA-256 was
`3b3c4e101b4aecc4dfa3e958e6c61522cb931f94fa6317359f438516f1a01b26`.
Each native child has a Windows Job limit of 2 GiB private commit, 20% CPU and a
1536 MiB working-set setting. Mapped weight pages and OS cache are not equivalent
to private commit; do not describe this as a hard total-machine 2 GiB RAM cap.
One measured 98-token run used roughly 120..145 MiB private process memory per
stage, with substantially larger mapped working sets. Its logits were bit-identical
to the unmapped route; wall time was 140.77 versus 149.19 s in that single comparison.

Local guards bind the existing native node and MachineGuid hash and honor pause,
drain, schedule, model allowlist, CPU/RAM limits and live memory headroom. Short
remote permits use monotonic elapsed time with the complete network round trip
subtracted, avoiding dependence on synchronized Windows clocks. Cancellation and
expired permits kill only the request's native child; failures are not reassigned
to a different physical stage. A missing-stage attempt failed and a new request
after recovery completed in 148.29 s on the older private transport. This does not
prove resumption of an interrupted request.

A later scheduler lifetime probe reproduced an orphan: after its controller
exited, the child remained alive despite its own nested Windows Job. That earlier
core is therefore not eligible for public serving. The corrected native core is
`6fbea65343c24216c5208230c8447187d1a7f25c6271efdda20ded5e19b0b429`.
It independently holds a handle to the actual actor and enforces a wall deadline,
even if Python crashes. No-model native probes passed on all three laptops:
parent death returned exit 125; a 1000 ms independent deadline returned 124 in
1.016..1.063 seconds; the old unguarded invocation was rejected. Old passing
graph results remain historical evidence, not evidence for this new lifetime guard.

The corrected core completed a new 55-token, three-laptop decision in 86.20 s,
again matching all 16 full-model reference logits exactly. Its runtime source
identity is `735596577208dcbc16e78e1a1fe17dd9e15f85519188f2b0efbfafa32bbf9220`.
Its subsequent 256-token boundary request passed on all three stages in 345.02 s
including HTTP overhead (344.996 s recorded inside the gateway), with zero output
tokens. These are single observed runs under the same resource caps, not a speed SLA.
The private broker now also clamps native deadlines to the fixed qualification
expiry, and its private listeners shut down at that expiry. No public admission
or AntSeed buyer delivery is implied by these qualification receipts.

No GPU inference is claimed. A Vulkan build enumerated adapters only. Existing
Kokoro/embedding reservations leave insufficient unreserved NVIDIA memory for
these current shard sizes; those services and reservations were not changed.
PC-DANI performed orchestration and artifact I/O only, never model inference.

### Legacy diagnostics and publication gates

Earlier six-fixture receipts used the incorrect community tokenizer. They remain
useful graph/transport diagnostics, not correct preprocessing evidence. In that
legacy comparison the raw-logit difference 0.01352954 failed an exploratory 0.001
gate; the failed receipt is retained. A same-host partition control was bitwise
identical, and the later original-tokenizer whole-model comparison above passed.
Do not silently overwrite failed comparisons or claim their exact cause is proven.

The latest preserved-production coordinator build and 125 focused tests pass
(one opt-in real Kokoro test skipped). The full production snapshot typecheck
reports the same 22 pre-existing errors as its unchanged baseline; it is not
reported as passing. The separate AntSeed provider SDK probe passed with zero
configured prices, one slot and a model-specific 555-second relay timeout. That
probe used synthetic responses, no wallet, real model or seller announcement.

The full-context API regression also exposed a coordinator admission error:
it estimated tokens from the serialized decision JSON and reserved text output,
rejecting a valid 256-token native request as if it were a generative prompt.
Decision admission now defers the exact input bound to the pinned native
tokenizer before physical dispatch; other model admission remains unchanged.
The retained failing protocol test and the passing stream/non-stream regressions
use the same synthetic 256-token fixture. They test API admission and accounting,
not an additional physical run or AntSeed delivery.

Private receipts live under `outputs/kev-distributed-20261021`; secrets, identities,
model weights and caches are excluded from source/public delivery. Remaining
publication gates already closed include source promotion through PRs #70–72
and account-confirmed independent cell admission. A real 55-token SDK call and
a real 55-token OmniRoute/AntSeed buyer call returned the correct decision;
the buyer call did not meet the free gate because its implicit provider selector
attributed another provider's pricing. An explicit
`X-Antseed-Provider: mycellios-decisions` schema-rejection probe subsequently
recorded `served_free=1`, but executed no model and is not buyer qualification.

The 256-token buyer attempt failed: OmniRoute retried after an executor
availability error, then a physical contributor's heartbeat expired. No complete
256-token buyer result is claimed. The native process remained alive; memory and
owner preflight later passed on all three hosts. The HP's existing nonblocking
hardware sampler and other installed native overlays were preserved. Proposed
The first TLS-reuse candidate passed 79 model-free tests and the public structure,
architecture and typecheck gates. Its source-bound, 55-token physical canary
completed in 102.80 s with all 16 reference logits bit-identical. A 256-token
private attempt failed after 9.47 s on an unavailable remote permit. These are
private qualification observations, not successful free buyer delivery.

Bounded idle transport probes isolated multi-second responses and timeouts on
one contributor while local owner checks were fast. Changing only that host's
NetBird home relay improved its next 12 idle probes without restarting voice or
embedding engines. A subsequent full-context private attempt still cancelled
after 22.50 s with generic native exit 125; the relay improvement alone did not
close the model gate. The current candidate preserves a bounded owner-cancellation
reason so that a policy-watcher kill is distinguishable from another native
failure. That changed source requires new physical qualification before serving.

A stale, zero-token API reservation for an already failed job was reconciled
with the normal failure-settlement method, without changing balances or limits.
The seller replacement also produced a recorded embedding connection-refused
request; this was not a zero-downtime rollout. A later interactive embedding
query returned a valid vector and `served_free=1`. These observations do not
establish global interactive latency or long-term stability.

The remaining gate is a complete real buyer request at the pilot context limit,
with verified usage and `served_free=1`, after source-bound physical qualification
of any changed native transport. Larger contexts, GPU execution and general task
quality require separate qualification.

On 23 October, two more zero-token embedding reservations survived coordinator
restart after their jobs had already failed. They were settled with the existing
failure-accounting method under transaction locks, preserving balances, counters,
limits and jobs. A subsequent provider receipt returned HTTP 200 and
`served_free=1`; the caller had already exhausted its deadline while waiting for
admission, so this is provider recovery only. Startup recovery now has a narrowly
scoped candidate that settles such terminal zero-token usage before admission;
its deployment and full caller recovery require separate verification.
