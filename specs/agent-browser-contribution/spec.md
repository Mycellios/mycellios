# Inline browser contribution

## Scope

The Agent sidebar activates and pauses the existing signed browser worker in
place. Keep native Desktop contribution and its admission/control flow intact.
Load the browser engine only after the user activates it. Do not open a page,
window or iframe, forward account credentials, or create a second compute engine.

## Lifecycle

- Reuse src/mobile/runtime, including WebGPU/CPU validation, identity persistence,
  device-signed registration, visibility suspension and bounded work cancellation.
- Embedded initialization disables standalone update reloads and automatic resume.
- Stop on unmount or account change. Late module loading must not start compute
  after the owning control has been closed or cancelled.
- Show contribution as active only after the coordinator confirms the connection.
  Connection failure stays visible and can be retried without navigation.
- Preserve pause during preparation and prevent overlapping activation requests.

## Transport and credits

Production uses same-origin /mobile/v1 and /browser/ort/ routes. The Dev proxy
accepts only the Mycellios origin or loopback, and strips Agent cookies. An
optional src/agent/.cache/browser-coordinator-url selects a private local
coordinator for serve mode; never read that profile into production builds.

A verified browser matrix task is compute evidence, not evidence of a credit
award or multi-host AI inference. Keep credit amounts sourced from the existing
account wallet; never generate balances from worker counters or timers.

## Account-funded browser expert inference

`MYCELLIOS_BROWSER_INFERENCE_ENABLED` is a separate, explicit coordinator opt-in.
Its operator configuration pins approved expert artifact revisions, row limits,
integer microcredit prices and a daily budget. It is disabled by default. This
route executes bounded SwiGLU model-expert stages, not a complete chat model or
an automatic listing of every model in the network. The original two-browser
consensus and native physical-GPU settlement routes remain unchanged.

The linked Mycellios session binds a live worker token and its server-verified
admission fingerprint to the payout account. Account IDs are never accepted from
the browser. A different account cannot claim an already bound session. Native
device ownership is not fabricated for a browser.

Buyers accept a short-lived, account/request/revision-bound price quote and use
an idempotency key. Existing ManagedPurchases admission reserves their credits
before dispatch, counts request/concurrency and budget limits, and separates
these purchases from native physical evidence. The price is approved work cost
plus the existing 4 percent service fee, rounded with integer/decimal arithmetic.
There is no external supplier, blockchain transfer or gas in this route.

Before accepting a dynamic result, the coordinator independently computes the
entire bounded expert output from SHA-256-pinned weights. A public canary or
two agreeing browser reports cannot authorize a payment. Reference work is
limited to 20 million multiply/accumulate projections and 64 MiB of weights;
this intentionally does not claim efficient or qualified serving of large models.

Persist the verified receipt before settling. Debit, contributor credit, response
and API completion commit in one PostgreSQL transaction. Replays and receipt
recovery do not execute or pay again. Benchmarks, failed verification, unowned
workers and paused/unavailable workers do not mint credits. Expired local leases
without verified receipts release their holds; never discard a saved receipt.
The owner migration must apply `browserInferenceCreditsSchemaSql` and its native
role policy alongside the existing managed-purchase/wallet schema. Runtime does
no DDL. Browser/authenticated roles have no direct table access.

The wallet includes these settled earnings with six-decimal precision and keeps
promotions distinct. `inference.settled` requests an authoritative, bounded wallet
refresh; it never supplies a client-calculated amount. Agent sends its linked
SSO token only server-to-server to the canonical coordinator. The worker's
connection proof is never included in public snapshots or logs.

Local qualification uses separate fictional accounts and a disposable PostgreSQL
cluster. The e2e fixture is explicitly labelled test-only; it must never populate
a real user's sidebar with a fictitious balance. Local SSO linking does not grant
the Dev OAuth client admission to the production wallet or enable paid traffic.

## Qualification

Run BrowserContributionControl, SidebarContribution and MycelliosCredits tests,
Agent web types/build and native mobile backend/hub tests. Separately exercise
the real browser's signed admission, a verified WebGPU/CPU task, pause and
disconnection against an isolated loopback coordinator. Do not use paid supplier
requests or customer ledger entries for this qualification. Record omitted checks.

## Complete pretrained text model pilot

The opt-in also accepts `kind: "text"` offers for the revision-pinned GPT-2 124M
int8 ONNX decoder in `src/contracts/browser-text.ts`. Its GPT-2 byte-level BPE,
all transformer layers, language head and greedy generation execute in the
contributor's browser using one CPU/WASM thread. This is a complete pretrained
model, not synthetic weights, an expert-only stage, a supplier call or WebGPU
text acceleration. It is a small completion model, not a tools-capable agent.
Both generation and coordinator verification run in isolated workers. Pause or
cancellation terminates in-flight WASM without blocking the UI or event loop.
The browser module uses external, lockfile-pinned ORT assets rather than embedding
a large WASM copy inside the worker bundle. Limits are 128 input tokens, 32
generated tokens and one complete-model verification
at a time per coordinator. Do not select it automatically for agent tool workloads.

Prepare public MIT model assets explicitly using
`node --import tsx scripts/prepare-browser-text-model.mts` through the scheduler.
Downloads use the fixed HF commit and validate exact sizes and SHA-256 hashes.
Set `textModelsPath` in the existing operator configuration to that prepared
root. Each text offer includes the pinned graph `artifactId`, a positive integer
`costMicrounitsPerToken` and `maxOutputTokens`. Starting/importing source does not
activate offers or apply financial DDL. Browser assets require a live signed
worker; only five installed lockfile-pinned runtime files are served publicly.

Before any generation, reserve input tokens plus the requested maximum output at
the approved compensation rate plus 4 percent. Independently regenerate the full
response on trusted coordinator CPU/WASM and require exact token-ID agreement,
current ownership/session, visible connectivity and a fixed 110-second deadline.
Only trusted tokenization and verified actual generated token counts determine
the final debit and worker earnings. Release the unused maximum; failed,
paused, disconnected, forged or expired work earns nothing. CPU verification
doubles inference work and is a conservative pilot gate, not a scale-efficiency
claim. No replica-only/public-canary result or worker-supplied price can pay out.

Enabled text offers appear in the optional Mycellios `/v1/models` catalog with
Credit prices and explicit limits. `/v1/chat/completions` intercepts only their
model namespace and requires an authenticated account, explicit contribution-credit
funding and a stable idempotency key. Unsupported tools/sampling are rejected.
Streaming returns only verified, settled text, never speculative paid tokens.
Replay/status recovery works after offers close and never starts a second job.
No native/supplier fallback or second provider connection is created.

Qualification uses the real browser and downloaded pretrained weights, but an
isolated fictional buyer and contributor ledger. This proves local generation,
verification, settlement and replay, not cash earnings or production account
eligibility. The dedicated Dev OAuth client remains outside production wallet
trust; preserve that boundary until a separately authorized environment change.
Focused tests include `browser-text-decoder`, `browser-text-assets` and the
expanded browser-inference PostgreSQL suite. The manual loopback harness is
`scripts/qualify-browser-inference-local.mts`; the optional native reference
qualification is `scripts/qualify-browser-text-reference.mts`. Neither calls a
paid provider or changes customer balances.
