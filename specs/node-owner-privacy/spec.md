# Privacy from node owners

Status: phase 0 (this spec) opened 2026-11-21. No phase is in production yet.

## Goal

Every request runs on the global network of user PCs. The owner of a PC that
processes a request may be able to see the piece it processes, but must not
know whose it is and must not be able to choose or predict which piece it gets.

## Threat model

**Adversary: the owner of a contributing PC.** They have administrator rights
on their machine, can read its memory, disk and traffic, can run a modified
build of the open-source worker, can run many nodes under several accounts and
IPs, and can read every public endpoint (`/public/v1/snapshot` lists every
worker and the last 100 jobs with their worker, model and timestamps).

**Out of scope, by decision.** The operator's own infrastructure (coordinator,
Agent servers, Cloudflare, which terminates TLS in front of the coordinator)
and external providers (OpenRouter, Groq, AntSeed sellers) may see content.

**Fixed constraints.**

- One global network. No normal/secret tiers and no "trusted machines": that
  does not scale to thousands of contributors.
- Any operating system, no reboot and no special hardware. TEEs, sealed or
  measured boot and attestation hardware are out.
- No slowdown. MPC, FHE and puzzle-style splitting of hidden states (Ritual
  Cascade) are out.

## Principles

1. **Anonymity.** A job reaches a node without account, IP, API key or any
   stable identifier of the user.
2. **Random, non-steerable assignment.** A node cannot request, predict or
   steer which job it receives, or from whom.
3. **Chunk dispersion.** Long audio (and later video) is cut into chunks of
   about 24-30 s. Each chunk goes to a different node and never two chunks of
   one recording to the same node (or owner). Chunks run in parallel, which
   also makes long recordings faster.
4. **Sealed leases.** Content is encrypted from the coordinator to the worker
   process with keys that exist only in that process's memory.
5. **Metadata stripping.** EXIF, filenames and identifiers are removed before
   anything is sent.
6. **No trace on the worker.** Content lives only in memory, never in disk,
   logs or telemetry. Reasonable anti-tampering, never sold as a guarantee.
7. **Deterrence.** Per-node deposit, bait content with unique phrases and
   tripwires to find who keeps or leaks content, expulsion with loss of the
   deposit, and Sybil resistance.

## Limits (state them plainly wherever this feature is described)

- **An expert owner can see the piece their node processes.** Without a TEE,
  nothing stops an administrator from reading process memory or running a
  modified worker. Sealing and anti-tampering only stop casual inspection.
- **Text and single images are not split.** The node that runs a chat turn
  sees the whole prompt, including the earlier turns that the request carries.
  Session affinity keeps a conversation on one node, which is the smallest
  exposure for multi-turn text: without affinity, every turn would show the
  whole history to another node. The first assignment is still random.
- **Content that identifies the user weakens anonymity.** Names, addresses,
  faces or a recognizable voice inside the content identify the user no matter
  what the protocol strips. Voice is biometric.
- **Collusion and Sybils.** One person running many nodes under different
  accounts and networks can still collect several chunks of one recording.
  Dispersion by owner and network raises the cost; deposits make it expensive;
  neither makes it impossible.
- **Deterrence only catches leaks that surface.** Bait and tripwires detect
  content that is used or published. Silent retention is not detectable.
- **Pipelines across PCs.** The root stage of a multi-PC pipeline sees the
  whole prompt; downstream stages see activations, which are partly
  invertible.
- **The operator and providers still see content** (see the threat model).

## Current state and gaps

Audited on `main` at 6ac9194f. Paths are relative to the repository root.

### 1. Anonymity

Exists:

- `lease.offer` carries `{jobId, leaseId, modelDigest, deadlineAt, request}`
  (`src/coordinator/mesh-service.ts:364-371`). `jobId` and `leaseId` are
  random UUIDs (`src/core/ids.ts:3-5`).
- The request is reduced by `generationOnlyRequest`
  (`mesh-service.ts:993-1012`). No account id, API key id, email, IP,
  user-agent, Space or Mico id reaches the worker. `preferred_region`,
  `workload_class` and `deadline_ms` are dropped.

Missing:

- **`session_id` reaches the node.** It is client-chosen and stable for a
  whole conversation, and the coordinator stores it against the user in
  `api_usage` (`src/coordinator/api-access.ts:330-337`). The pipeline adapter
  forwards it to the local runtime as `x-session-id`
  (`src/adapters/mycellios-pipeline.ts:106-122`), which uses it only as an
  in-memory key for cached state between turns
  (`python/distributed_runtime/server.py:686`). Some callers add revealing
  prefixes: `support-` (`src/coordinator/server.ts:3974`) and `benchmark-`
  (`src/benchlab/coordinator-suite.ts:563`).
- **`privacy` reaches the node**, including `pinned_identity_ids`
  (`mesh-service.ts:1005-1010`). The worker never reads it.
- **`messages[].name` reaches the node.** Only the pipeline adapter forwards
  it, and `server.py` discards it (`server.py:669-679`).
- `seed` reaches the node. It is needed for reproducible output and is kept.

### 2. Random, non-steerable assignment

Exists: there is no pull API. A node only receives `lease.offer`,
`task.cancel`, `evidence.challenge`, `contribution.set` and `runtime.*`
(`src/worker/agent.ts:244-310`).

Missing:

- **Selection is a deterministic argmin.** The lowest score wins and ties go
  to the lowest candidate id (`src/distribution/execution-route-policy.ts:106-167`).
- **The score runs on numbers the node reports itself:** `tokensPerSecond`
  and `ttftMs` for every adapter except `mycellios-pipeline`
  (`src/coordinator/evidence-authority.ts:12-27`), `maxConcurrency` (up to
  1024), `coordinatorRttMs` and `region` (`src/scheduler/scheduler.ts:264-308`).
  A node that inflates them wins every offer until its slots fill.
  `workers.reliability` is never updated after registration.
- **Read, then decline.** The full request arrives before the node accepts
  (`agent.ts:2259-2319`). The node can send `lease.reject` with any reason;
  the coordinator fails over without any penalty (`mesh-service.ts:430-434`).
  The node has already seen the content. The owner's work policy (schedule,
  model allowlist) is only enforced this way (`agent.ts:2268-2271`).
- **The per-request trust policy is a "trusted machines" tier.**
  `privacy.trust`, `boundary` and `pinned_identity_ids`
  (`src/contracts/schemas.ts:112-123`) feed `routeOptionsForRequest`
  (`mesh-service.ts:925-937`) and `routePolicyRejections`
  (`scheduler.ts:705-756`). "Trusted" only means "has a signed identity", and
  every remote worker has one. Agent speech and dictation pin their requests
  to `MYCELLIOS_NETWORK_SPEECH_IDENTITIES` and
  `MYCELLIOS_NETWORK_TRANSCRIPTION_IDENTITIES`
  (`src/agent/apps/api/src/mycellios-network-speech.ts:44-52`,
  `mycellios-network-transcription.ts:28-33`). Native qualification pins to
  the worker under test (`src/coordinator/native-replica-qualification.ts:118`).
  This policy is replaced by the universal protections in this spec, not
  extended.
- **Pre-existing weakness in pin matching (F0).** The pin check compares
  identities less strictly than admission keys them (`scheduler.ts:730-734`).
  Phase 1 makes both agree. Details stay out of this public document until
  the fix is deployed.

### 3. Chunk dispersion

Exists: `deploy/transcription-openai-bridge/bridge.py` converts audio with
ffmpeg and cuts it into segments of at most 24 s (`SEGMENT_SECONDS`) so each
fits the coordinator's 1 MiB body limit. Speakr transcribes through it today.

Missing:

- Segments are sent one after another (`transcribe_upload`), with no link
  between them, so the scheduler sends all of them to its single best node.
  Today there is only one `mycellios-whisper-small` replica (MRPUCCHI), so
  every chunk of every recording reaches the same PC.
- There is no way to tell the coordinator that several requests are pieces of
  one recording without also telling the node.

### 4. Sealed leases

Exists:

- Remote workers refuse non-loopback `ws`/`http` coordinators
  (`agent.ts:2588-2601`), so the socket is TLS up to Cloudflare.
- Worker keys exist but only sign: Ed25519 for Desktop and cells
  (`src/worker/admission-credential.ts:31-43`), ECDSA P-256 for browsers.
  They are long-lived.
- `mycellios-direct/1` encrypts worker-to-worker frames with AES-256-GCM from
  a coordinator-issued pre-shared secret (`src/transport/direct-secure-channel.ts`).

Missing:

- Job content travels as plaintext JSON inside the TLS socket. Whoever
  controls the PC can read it without touching the worker: a local TLS proxy
  with its own root certificate, Node's `--tls-keylog`, or any capture tool.
- No key exchange exists between coordinator and worker process.
- The pipeline root's chat request crosses the coordinator's stream tunnel as
  raw HTTP bytes (`src/worker/runtime-stream-tunnel.ts:594-630`).

### 5. Metadata stripping

Exists:

- Transcription audio must be canonical mono 16 kHz PCM WAV with a fixed
  44-byte header (`src/contracts/transcription.ts:21-35`), so no LIST/INFO or
  other chunk can pass; the worker checks it again
  (`src/adapters/transcription.ts:51`). The bridge rebuilds the header itself
  after ffmpeg. The original filename only goes to its optional fallback
  provider.
- Native content is text only (`schemas.ts:94`); the Agent adapter rejects
  non-text parts (`src/agent/packages/adapters/src/mycellios-chat.ts:55-59`).
  No image, video or file bytes reach a node.

Missing (identifiers inside the prompt text that the Agent adds when the model
runs on the Mycellios network):

- The user's IANA time zone on every turn (`src/agent/packages/adapters/src/current-time.ts:19`).
- Attachment filenames, MIME types and sizes
  (`src/agent/packages/core/src/attachments.ts:124-148`), and handoff bot ids.
- The team workspace path, which contains `bot.id`, and teammate bot names.
- Studio adds knowledge source names and per-subject memory facts
  (`src/coordinator/studio-agent-runtime.ts:51-71`).

### 6. No trace on the worker

Exists:

- Kokoro and transcription engines keep audio in memory, disable access logs
  and reduce errors to fixed codes (`python/distributed_runtime/kokoro_engine.py`,
  `transcription_engine.py`). `server.py` disables request logging.
- Serving code writes no temporary files; stage processes get a per-process
  `TMP` deleted on exit (`src/distribution/launch-supervisor.ts:700-793`).
- The worker writes no content files (`src/worker`).

Missing:

- **Failure lines can carry content into a log file on the PC.**
  `agent.ts:2412` logs `Inference job <jobId> failed: <message>` (up to 300
  characters) and sends the same text in `task.fail`. On Node 24 a
  `JSON.parse` error quotes the first characters of its input, and the
  pipeline adapter appends up to 300 characters of the runtime's error body
  (`mycellios-pipeline.ts:127-131`). The Windows service writes stdout to
  `C:\ProgramData\Mycellios\Logs` (`src/node/service-registration.ts:84-96`);
  Kokoro and transcription replicas write `Logs\worker.*.log`.
- **The decision gateway writes one file per job** (`{jobId}.json`, with an
  unsalted SHA-256 of the input and the output logits)
  (`python/distributed_runtime/decision_gateway.py:136-203`).
- **Kokoro's phonemizer prints input words to stdout**, which the launcher
  wrote to `Logs\engine.stdout.log`. Checked against the published wheels:
  kokoro 0.9.4 disables its own loguru logs on import (`logger.disable("kokoro")`,
  which covers its phoneme warnings), but misaki 0.9.4, the minimum it
  requires, prints `TODO:NUM` words with their currency (`misaki/en.py:440`).
- No process hardening: crash dumps and debugger attach follow OS defaults.
- The CUDA embedding runtime on the operator's PC is not in this repository
  and has not been audited.

### 7. Deterrence

Exists:

- Owner and operator revocation of credentials, which disconnects the worker
  and bumps `node_ownership.generation` (`server.ts:3239-3267, 4605-4665`).
- `seller_earning_reversals` with reason `fraud` and `seller_debts`
  (`src/coordinator/seller-earnings.ts:24-47`). Node payouts are disabled
  (`payout_enabled: false`, `server.ts:3436-3441`).

Missing:

- No deposit, bond or slashing for nodes.
- No worker quarantine or ban that survives a new key or identity.
- No Sybil limit: identity ids are self-chosen, there is no cap of nodes per
  account, and physical identity hashes are self-declared.
- No synthetic traffic that looks like user traffic. Every existing check can
  be told apart: deployment canaries use `evidence.challenge`; native
  qualification uses fixed content, `temperature: 0`, `max_tokens: 1` and a
  `privacy` pin to the node itself; benchmarks use `benchmark-` sessions and
  seed 10000.

## Design

### D1. Worker view of a request (principles 1 and 5)

The coordinator sends each node a **worker view**, built in one function next
to `generationOnlyRequest`:

- `session_id` becomes a per-node pseudonym:
  `"s_" + base64url(HMAC-SHA256(key, workerId + "\n" + sessionId))[0..22]`.
  The key is random per coordinator process. The same node still sees the
  same pseudonym across turns, so KV-cache reuse keeps working, but the
  pseudonym cannot be linked to the stored session id or across nodes.
  Prefixes such as `support-` and `benchmark-` disappear. A coordinator
  restart changes every pseudonym, which only costs one cache miss per open
  conversation.
- `privacy` is dropped.
- `messages[].name` is dropped. The only runtime that receives it discards it.
- `seed` and sampling parameters stay.

The coordinator keeps the full request for admission, hashing, receipts and
recovery. Workers already treat these fields as optional, so old workers keep
working. Cost: nothing measurable.

### D2. Random selection within a service band (principle 2)

`decideExecutionRoute` keeps its eligibility rules and SLO check. Among
eligible candidates within 10 % of both the best score and the best estimated
service time, it picks one uniformly with `crypto.randomInt`. A healthy,
unsaturated session affinity still wins. Weighting by claimed capacity is not
used, since that would reward inflated claims again.

- Both limits are relative. An absolute score band was rejected after
  measuring: the score has fixed terms, so with 64 output tokens a 30 tok/s
  node scores within 12 % of a 50 tok/s node while being 65 % slower. The
  service-time limit keeps a clearly faster node winning, so spreading work
  never slows a request by more than the band.
- Identical or near-identical nodes share offers instead of the lowest id
  always winning. With one eligible node (Whisper and Kokoro today) nothing
  changes.
- **Measured rates (phase 2b).** Nodes report their own throughput and
  first-token time (every adapter except `mycellios-pipeline`). After each
  completed job the coordinator compares the attempt's real duration with what
  those claims predicted, sizing the output as the smaller of the node's token
  count and half the bytes it actually delivered. Once three recent jobs (six
  hours) exist, the median slowdown, between 1 and 20, scales the claims down
  for ranking. Claiming less than delivered gains nothing. The factor only
  ranks candidates: SLO eligibility keeps the claims, so a node whose work the
  claim model fits poorly is never shut out.

**Rejections after content.** A `lease.reject` arrives after the node has read
the request. The coordinator counts these per worker in a rolling hour, except
`duplicate_job`, and `deadline_exceeded` when the deadline really passed. At 3
or more rejections and over 20 % of offers it logs `lease_rejection_anomaly`.
Workers advertise no free slot for models their owner's policy excludes right
now (a paused or out-of-schedule worker already drains), so honest rejections
become rare races. Holding an anomalous worker back from new offers for an
hour is opt-in (`MYCELLIOS_LEASE_REJECTION_HOLD=1`) until workers with that
change are widely deployed; older workers still reject for their owner's
policy and must not be penalized.

### D3. Dispersion groups (principle 3)

**Coordinator.** A request may carry `dispersion: { group }` where `group` is
an opaque random string (16-64 URL-safe characters) chosen by the client for
one recording. The field is coordinator-only: it is never part of the worker
view, the input hash or stored conversations. The coordinator keeps, in
memory, per group, the exclusion keys of every node that has received one of
its chunks:

- worker id and identity id;
- owner account (from `node_ownership`) for device workers;
- the worker connection's network prefix (IPv4 /24, IPv6 /48), taken from the
  same trusted-proxy rule as rate limiting (`src/coordinator/rate-limit-key.ts`).

Candidates that share any key with the group are ineligible
(`candidate_dispersion_excluded`). If none is left, the request fails before
dispatch with `503 dispersion_exhausted`, distinct from `no_capacity`. Groups
expire one hour after their last chunk; the map is bounded and evicts the
oldest group. Failover and standby routes respect the same exclusions. A group
is scoped to the authenticated account so one user cannot exhaust another's.

**Bridge.** For each upload the bridge generates a group, sends up to
`TRANSCRIPTION_PARALLEL` chunks at a time (default 4, bounded by the account's
concurrency) and joins texts in order. On `dispersion_exhausted` it applies
`DISPERSION_POLICY`:

- `fallback` (proposed default): that chunk goes to the configured fallback
  provider (Groq today), which Daniel accepts seeing content;
- `fail`: the transcription fails.

There is no policy that reuses a node.

**Effect today.** With one Whisper replica, a 10-minute recording would send
one chunk to the network and 24 to the fallback. Dispersion only becomes cheap
once several nodes host Whisper; on-demand replica placement
(`specs/on-demand-replica-placement/spec.md`) and CPU replicas on laptops are
the route to that. Daniel decides the default before the bridge is deployed.

Speed: with N replicas a recording finishes in about 1/N of the serial time.

### D4. Sealed leases (principle 4)

- At each connection the worker generates an X25519 key pair in memory and
  sends the public key in `worker.hello` as `sealing: { version: 1, publicKey }`.
  It is never written to disk and is replaced on reconnect.
- For a worker that advertised sealing, `lease.offer` carries
  `sealed: { version, ephemeralPublicKey, nonce, ciphertext }` instead of
  `request`. The coordinator uses a fresh X25519 key per lease, derives an
  AES-256-GCM key with HKDF-SHA256 over the shared secret (info
  `mycellios-sealed-lease/1`, salt = leaseId) and binds
  `jobId|leaseId|modelDigest|deadlineAt` as associated data.
- The worker decrypts in memory and validates the inner request with the same
  schema. Old workers that do not advertise sealing keep receiving plaintext.
  Once enough workers seal, the coordinator can require it per model.
- Follow-ups: seal `task.token`/`task.complete` to a coordinator key, then the
  pipeline root's stream tunnel.

What it protects: content against local TLS interception, TLS key logging and
capture tools on the PC, with forward secrecy for past leases. It does not
protect against an owner who instruments or modifies the worker process.

The coordinator still decrypts and validates every request: it needs plaintext
for admission, WAV and token checks, billing and receipts, and the threat
model trusts the operator. Sealing from the client straight to the node would
need the route before the content (one more round trip) and is not planned.

Cost: one X25519 agreement and AES-GCM over at most 1 MiB, well under a
millisecond per lease.

### D5. Prompt identifier minimization (principle 5)

Deferred: today the Agent sends text only to managed models
(`mycellios/managed/...`), which external providers serve, never to
contributor nodes; dictation and speech carry no prompt context. When Agent
text starts running on contributor nodes, the Agent:

- sends the local date and time with its UTC offset, not the IANA zone name;
- labels attachments as `attachment 1 (application/pdf, 120 KB)` instead of
  their filename;
- omits workspace paths and bot ids from prompt context.

Mico names and instructions stay: they are the content the user chose.

### D6. Worker hardening (principle 6)

- The worker maps failures to fixed codes before logging or sending
  `task.fail`. Messages never include parser excerpts or runtime bodies.
- The Kokoro launcher discards the engine's stdout (readiness is checked over
  HTTP), so misaki's prints never reach disk. Checked on Windows PowerShell 5.1
  and 7 that `-RedirectStandardOutput 'NUL'` discards output and creates no
  file. Takes effect when the operator updates the launcher on the replica PC.
- Deferred, because the code is source-bound: the decision gateway writes a
  per-job receipt (unsalted input digest and output logits) in serving mode,
  but `decision_gateway.py` is part of the `sourceId` its physical activation
  receipt is bound to, and the transcription launcher pins its engine's
  SHA256. Changing either needs an operator-approved requalification on the
  physical PCs; do it with the next such requalification (serving receipts in
  memory only, digest salted).
- Best effort, documented as such: Python engines disable core dumps and
  same-user debugger attach where the OS allows it without privileges
  (`prctl(PR_SET_DUMPABLE, 0)` on Linux), buffers holding audio are zeroed
  after use, and Windows error reporting is told not to collect dumps for the
  engine processes. Swap, hibernation files and administrators remain out of
  reach.

### D7. Replacing the trust policy

- Fix F0 first: pin matching uses the same identity key as admission.
- Then, once D1-D4 are in production, the public API stops accepting
  `privacy.trust`/`boundary`. Pins remain only as an operator-only placement
  tool for native qualification, never as a privacy tier. Agent speech and
  dictation stop pinning and use the global pool with the protections above.

### D8. Deterrence (principle 7)

**Bait traffic.**

- A coordinator component submits synthetic jobs through the normal path,
  funded by an operator account, with realistic content drawn from a curated
  corpus. Each dispatch embeds unique markers: a phrase, plus tripwires (a
  URL on a Mycellios domain and a fake API key in the `myc_` format, both
  registered and answering normally).
- The coordinator records `(marker, workerId, identity, owner, time)`. A hit
  on a tripwire URL or an attempt to use a fake key identifies the node that
  received it. Markers found in public sources point to the same record.
- Rate: about 1-2 % of jobs per model, with Poisson timing and parameters
  drawn from real traffic. After D1 removes `privacy` and session prefixes, a
  node cannot tell bait from user jobs. New nodes receive a higher share of
  bait during their first jobs (a ramp, not a trust tier).
- Audio bait is prerecorded speech containing tripwire phone numbers or
  emails.

**Deposit (bond).**

- A node must hold a bond before receiving work. To avoid an upfront payment,
  the bond fills from the node's own earnings, which are held until it is
  complete. Decided by Daniel on 2026-11-21: 10 Credits per node.
- A confirmed tripwire hit slashes the bond, revokes the credential and
  ownership, bans the owner account from enrolling nodes and records the
  physical identity hashes and network prefixes for review.
- This touches the ledger: isolated PostgreSQL tests and Daniel's approval
  before production.

**Sybil resistance.**

- Each node needs its own bond, so N nodes cost N bonds.
- Dispersion excludes by owner and network prefix, not only by worker.
- At most 5 nodes per owner account unless an operator raises it (decided by
  Daniel on 2026-11-21).

Node operators' terms must forbid keeping or using content and disclose that
bait traffic exists.

## Performance

| Change | Cost |
|---|---|
| D1 worker view | One HMAC per lease, negligible |
| D2 random band | At most 10 % on estimated service time per choice; none with one candidate |
| D3 dispersion | None in the coordinator; long recordings get faster with several replicas. With one replica, chunks go to the fallback or fail, per policy |
| D4 sealing | Under 1 ms per lease |
| D5 identifiers | None |
| D6 hardening | None |
| D8 bait | About 1-2 % of network capacity, paid by the operator |

## Phases

Each phase is a normal PR. Merging to `main` deploys the coordinator through
Nucleus, and worker changes reach PCs with the next Desktop release, so no PR
that changes behavior for users is merged without Daniel's explicit OK.

1. **Worker view, F0 and content-free failures** (D1, D7 F0 fix, first part
   of D6). Coordinator and worker. Highest protection for the lowest risk.
2. **Random band and rejection accounting** (D2), then **2b, measured rates**
   so self-reported throughput cannot win the band. Both are in `main`.
3. **Dispersion groups** (D3). Coordinator first, then the bridge. The bridge
   and parallel chunks are owned operationally by the session "Mycellios:
   huellas Qwen sin redistribución"; coordinate with it before deploying.
   Speakr must keep working: deploy only with Daniel's chosen policy.
4. **Sealed leases** (D4), negotiated per connection.
5. **Remaining hardening** (D6): content-free worker failures shipped in phase
   1, Kokoro stdout in phase 5; source-bound engines wait for their next
   requalification, and Agent identifiers (D5) for Agent text on nodes.
6. **Trust-policy removal** (D7), after 1-4 are in production.
7. **Deterrence** (D8): bait and tripwires first (no ledger change), then
   bond, expulsion and Sybil limits with isolated PostgreSQL tests.

## Verification

- Phase 1: a test that captures `lease.offer` and checks it carries no
  `privacy`, no `name` and only a pseudonymous session that differs between
  two workers and stays stable for one; the existing mesh/scheduler suites;
  a pin-matching test for F0; a worker test where a JSON
  parse failure leaves no content in the log line or `task.fail`.
- Phase 2: a statistical test that two equal candidates both receive offers;
  that a candidate outside the band never does; affinity still wins; the
  capacity-dispatch-hardening, scheduler, mesh-failover and Kokoro network
  suites.
- Phase 3: exclusion by worker, owner and prefix; `dispersion_exhausted`
  before dispatch; failover respecting exclusions; the bridge's unit tests for
  ordering, parallelism and both policies.
- Phase 4: round trip, tampered ciphertext, wrong associated data, an old
  worker without sealing, reconnect with a new key.
- Physical evidence: none of these phases proves anything about a run across
  two physical computers, and none should be described that way.
