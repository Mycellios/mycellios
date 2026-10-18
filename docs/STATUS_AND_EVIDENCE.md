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
