# Managed Mycellios provider

Local development, opt-in only. No upstream spend or production activation is
authorized by implementing this spec. Mycellios is the first-party billing and
support provider; externally processed models must retain external processing
metadata, rather than claiming physical distributed inference.

## Billing and identity

- Native model IDs, prices, receipts and contributor rewards remain unchanged.
  The catalog publishes current native route price upper bounds separately,
  without the external markup; an unpriced route is not presented as free.
- Explicit `mycellios/managed/<upstream-model>` IDs select managed external text.
  Native failures never select these models automatically. BYOK is independent.
- Mycellios is optional for the customer. Connecting it preserves an existing
  main provider/model; each Mico can keep using an owned API/OAuth connection.
  Credits are a Mycellios balance, not a transferable balance in a customer's
  OpenRouter or AntSeed account. Operator keys pay upstream; never take BYOK keys
  as the managed service's funding source. Managed Apps identify Credit usage
  explicitly; a chat's BYOK selection does not silently reroute App billing.
- One paid USD corresponds to one Credit. External usage costs the actual
  upstream USD cost including effective supplier funding fees, plus a 400 basis-point markup. This is a markup on cost,
  not a 4 percent share of the final price. Publish final token prices including
  the markup. Parse decimal costs exactly and round positive request costs up to
  the wallet's microcredit precision; exact-zero costs stay zero. Never round
  individual tokens to microcredits or silently treat a positive cost as free.
- Reserve the accepted maximum from the same contribution/promotional wallet
  as native inference. Keep external receipts distinct from native economic
  settlements and physical contribution evidence. No contributor is fabricated.
- Existing paid token grants are **not** automatically converted into wallet
  Credits. New wallet checkouts use `mycellios-wallet-v1`: one USD funds one
  Credit after a verified paid event. The 4 percent applies to external usage,
  not to loading the wallet. Reusing an old payment would double fund it.
- Signed short-lived quotes bind account, immutable request and maximum. The
  standard compatible chat route also accepts explicit model selection under
  Credit funding, constrained by operator and optional user request budgets.
- Account/request idempotency persists. Claim submission before a paid POST.
  A timeout, interruption or missing actual-cost receipt keeps a reservation
  pending; it does not authorize another inference or an unverified refund.
  A stored receipt can finish interrupted billing without another inference.
- Enforce a persisted global daily operator budget including all unresolved
  reservations from earlier days. Request/concurrency limits remain enforced.
- Disabling new managed requests must not restore previously spent funds or
  expired promotions. Rollback disables admission while preserving accounting.

## Operator setup, private storage and transport

The migration owner applies `managedPurchasesSchemaSql` followed by
`managedPurchasesAccessSchemaSql(existingNativeRole)` from
`src/economy/managed-purchases.ts`, alongside the existing wallet schema.
The runtime verifies this schema and RLS; it never executes DDL. Keep the native
role's accounting access after disabling admission. Browser roles cannot read
results or receipts. Do not grant browser access to funding or hold tables.
Wallet checkout additionally requires `walletTopupsSchemaSql` followed by
`walletTopupsAccessSchemaSql(existingNativeRole)`. The purchase schema includes
private `remote_job_json` for recovery. The wallet recognizes existing paid
top-ups even when admitting new top-ups is disabled.

Configuration requires all of these server-only values:

- `MYCELLIOS_MANAGED_PROVIDER_ENABLED=true`
- `MYCELLIOS_MANAGED_ANTSEED_CONTROL_SECRET` (the dedicated operator buyer's
  gateway control secret; never a customer's personal identity)
- `MYCELLIOS_MANAGED_REQUEST_LIMIT_MICROUNITS`
- `MYCELLIOS_MANAGED_DAILY_LIMIT_MICROUNITS`

The default managed upstream is now AntSeed. It uses a dedicated operator-owned
buyer sidecar at `http://127.0.0.1:8377`, on the coordinator host, not on a
customer's PC. The shared control secret authenticates per-request price caps
and attributed signed spend. The existing OpenRouter adapter requires explicit
`MYCELLIOS_MANAGED_UPSTREAM=openrouter` plus its operator key; the two are never
automatic fallbacks or mixed funding sources. Personal BYOK connections remain
independent. Enabling AntSeed does not start or fund a buyer, copy a user's
identity, or enable paid inference as part of local qualification.

An operator gateway API key has a different authentication and billing contract.
Select `MYCELLIOS_MANAGED_UPSTREAM=antseed-gateway`, set
`MYCELLIOS_MANAGED_ANTSEED_GATEWAY_KEY_FILE` to the private server secret file,
and `MYCELLIOS_MANAGED_ANTSEED_GATEWAY_BASE_URL` to its fixed HTTPS base (without
`/v1`; HTTP is allowed only on loopback). An in-process key is supported through
`MYCELLIOS_MANAGED_ANTSEED_GATEWAY_KEY`; specifying both sources is rejected.
Never put either credential in a browser provider, repository or receipt.

This adapter requires `MYCELLIOS_MANAGED_ANTSEED_GATEWAY_CONTRACT=deepseek-bounded-v1`.
This is an operator attestation, not a capability discovered from a model name:
before setting it, qualify the deployed gateway's bounded DeepSeek request guard,
0.5/0.5/1 USD-per-million input/cache/output caps, pinned 40-hex seller routing,
text-only input, explicit output limits, durable attributed spend and scoped ledger.
Stock gateways without this guard are not qualified. Unknown funding cost still
blocks all spend, including an advertised free offer whose price could change.
Paid gateway configuration additionally requires
`MYCELLIOS_MANAGED_TOTAL_LIMIT_MICROUNITS`, an audited lifetime envelope in
wallet microcredits, including funding costs and the 4 percent markup. This is
independent of the daily cap and includes all historical settled managed charges
and unresolved maximum holds. Midnight, process restarts and key rotation do not
reset it. Enforce a matching or narrower supplier-side total USD cap, allocated
only from verified prefunding; future deposits do not extend this authorization.
Other discovered models/modalities stay unavailable; catalog presence does not
authorize platform spend. The public price is a maximum, not the cheapest offer.

Gateway authentication opens a key-scoped console session using the operator key;
it never creates a management token or changes the existing key's policy. Persist
an opaque end-user nonce before the one inference POST, then its gateway tag and
compatible response. Recover with scoped ledger GETs only. Require exact key,
nonce, tag, model, seller, route and complete input/cache/output token coverage.
The gateway's `costPending=false` alone does not prove a complete invoice.
Missing responses/receipts, partial token coverage and ambiguous logs retain the
hold; an explicit verified free receipt bills zero. An invoice above the accepted
maximum persists a safety stop across accounts and restarts. This limits exposure;
it cannot guarantee that an upstream provider will never violate its contract.

`MYCELLIOS_MANAGED_MODEL_ALLOWLIST` is optional: default `["*"]` discovers the
current compatible selected-upstream chat catalog automatically. An explicit named
list (up to 100 IDs) restricts admission; mixing wildcard and names is rejected.
This does not enable the provider or remove key, budget, price or receipt gates.
Catalog responses remain bounded to 8 MiB/10,000 rows and expire in five minutes.
Initial metadata is warmed before serving the first account; metadata failure
does not disable native routes. Public Mycellios catalogs combine available
native models with these external entries rather than requiring another user
connection to AntSeed. The Agent keeps friendly names and prices when browsing
and displays the selected model's cost before Use.

The chat contract admits qualified text output and exact-zero prices, not mixed
image/audio/video output, batch variants, unverifiable prices or mandatory native
search. Other modalities require separately qualified Apps transports. Optional web-search prices do
not exclude ordinary chat models: requests disable the web plugin and admit only
client function tools, never paid server tools or caller-supplied plugins.
Operator defaults must not enforce unbudgeted plugins. Price upper bounds include
cache, reasoning and conditional token-rate overrides, with maximum estimates
identified in the catalog. Actual verified invoices determine the debit plus
4 percent. Free models and special billing require a separately qualified
contract; automatic discovery is not a claim of universal live compatibility.

AntSeed text models use `mycellios/managed/antseed/<model>` IDs. Each admitted
offer has explicit per-peer text capabilities, output/context limits, native
OpenAI chat protocol and known token/cache rates. Pin the seller, provider and
service; authenticate narrow per-request routing policies with maximum token
prices. Do not admit agent services, routers, unknown unit charges or unsupported
modalities under the text contract. The selected provider, rates and caps are
bound into quote acceptance. Catalog/receipt reads are bounded and use GET only.
Unknown effective supplier funding fees block paid models; zero must be an
explicit operator choice based on its actual funding arrangement, not the old
OpenRouter 550-basis-point fixture assumption.

Persist an AntSeed attribution tag, request ID and feed position before the one
inference POST; persist the compatible response before waiting for billing.
Only signed spend matching the buyer identity, request, tag and pinned seller
is billable. Token-bearing receipts must cover the returned input/output counts;
unrelated, partial, lost-history or mismatched receipts cannot settle a paid
request. Exact-zero offers enforce zero price caps and no paid fallback.
Late receipts retain the credit hold and can be reconciled with GET-only reads
after recreating the service. Never re-submit an uncertain request. Existing
purchase overcharge protection retains the receipt and stops further admission
if actual spend exceeds its accepted reservation. Recovery is account-scoped,
idempotent and uses the same promotional/earned/top-up wallet.

AntSeed image/audio/general video discovery is not qualified by this text
adapter. Reject `MYCELLIOS_MANAGED_MEDIA_ENABLED=true` with AntSeed rather than
silently forwarding those requests to OpenRouter. The separately gated AntSeed
video-edit transport keeps its own source, quote and signed-receipt checks.

Optional `MYCELLIOS_MANAGED_MEDIA_OFFERS` was the initial fixture offer format.
Nonempty lists are now rejected with `managed_media_cost_contract_not_qualified`:
an operator-written USD maximum does not constrain the upstream bill. Do not
enable these transports until bounded unit/endpoint cost contracts are implemented.
The standalone injected media adapter remains available for local fixture tests.
No fictional default models or prices are supplied.
Offers expire closed. `MYCELLIOS_WALLET_TOPUPS_ENABLED=true` additionally needs
the existing Stripe checkout settings and webhook secrets/livemode. Agent Apps
proxying is separately gated by `MYCELLIOS_MANAGED_APPS_ENABLED=true`. All gates
default off. No operator key or live gate was configured during local work.

The initial adapter pins OpenRouter's HTTPS API, forbids redirects, removes
unknown-price models, includes verified per-request charges, expires cached prices, bounds inputs/outputs and
does not retry paid requests or fall back to another payer. An external catalog
failure removes its offers without removing native models. SSE deltas can be
shown immediately, but success/DONE waits for an actual-cost receipt and atomic
wallet settlement. The Agent bypasses the native Qwen tool envelope for managed
IDs and supplies a conversation/request-bound purchase key on retries.

Text admission now goes through `ManagedTextRouter`, registered with the
OpenRouter adapter initially. Optional `MYCELLIOS_MANAGED_TEXT_ROUTES` maps
stable Mycellios model IDs to a registered adapter and that adapter's admitted
model ID, with an optional public model name. Without this mapping, existing
IDs stay unchanged. Example operator-only routing configuration (not a live
model recommendation or activation):

```json
[{"id":"mycellios/managed/assistant","backend":"openrouter","model":"mycellios/managed/vendor/text","name":"Assistant"}]
```

The public catalog/stream/result keep the Mycellios identity and alias. The
signed execution digest binds the private backend and selected model. The
purchase records its real backend for invoice uniqueness and reconciliation.
Registration rejects unknown adapters, duplicate routes and ambiguous model
names; unavailable upstreams never select another backend or payer implicitly.
Additional certified adapters can register through `managedTextBackend` without
changing the customer's Credit wallet, connection or UI. The initial factory
registers OpenRouter only: the mocked AntSeed text adapter in routing tests is
an extension test, not a working live AntSeed text integration. AntSeed video
editing remains its separately qualified adapter below.

API routes: `GET /v1/managed/models`, `POST /v1/managed/quote`,
`POST /v1/managed/execute`, `POST /v1/managed/reconcile`, plus managed model IDs
on `/v1/chat/completions` and `/v1/models`. Require authenticated accounts/API
keys, never the coordinator system token as a payer. Native session/privacy
constraints are not stripped to obtain external admission.

Media routes under `/v1/managed/media`: GET `models`; POST `quote`, `execute`,
`status`, `content`. Image, speech, WAV/MP3 transcription and asynchronous video
generation share signed quotes, account-owned purchases and the same wallet.
Actual upstream costs are mandatory for settlement. Persist video job IDs and
speech audio/receipt IDs before polling or invoice lookup. Recovery uses GETs,
never another create. Content is returned only for a settled, owned video.
Transport pins HTTPS endpoints, rejects redirects, bounds bytes and forbids
arbitrary result URLs. Failed/unknown outcomes remain reserved for review.

`POST /v1/wallet/checkout` creates a fixed 5/10/20/50 USD pack with a stable
Stripe idempotency key and server-owned amount/account metadata. Only the
signature- and livemode-checked `/webhooks/v1/wallet-stripe` grants Credits.
Browser redirects never fund accounts. Event/payment identities prevent double
funding. Cumulative partial/full refunds apply monotonically, including refunds
received before payment confirmation; they never mint legacy token quota.
Refunds after consumption may leave debt rather than fabricate balance.

Stored successful responses are private and support lost-response recovery.
Retention/deletion, automated reconciliation of submissions with no known
provider request ID, and a bounded operational review surface remain pending.

## Qualification and remaining capabilities

Focused tests: `tests/managed-provider.test.ts` and real isolated PostgreSQL via
`node scripts/test-referrals-postgres.mjs tests/managed-purchases.postgres.test.ts
tests/referrals.postgres.test.ts`. Agent tests cover live catalog parsing and
`mycellios-chat.test.ts`. Injected upstream fixtures are not paid inference proof.

Implemented transports are text, image generation, speech, transcription and
async video generation; the Apps UI previews a maximum and requires explicit
acceptance before consumption. Stored pending keys are scoped to the signed-in
viewer in session storage. Recharge creation is explicit and checkout is a
separate user action. Fixture validation does not establish paid compatibility.

Pending: real-provider and real-payment qualification; chargeback/dispute handling;
vision input; operational review of unknown/failed
jobs; result retention/deletion; production activation and schema application.
Disabling the whole managed factory also unmounts its webhook: retain it for reconciliation
before any production shutdown. Do not activate paid keys or advertise verified
live availability based on injected tests.

## AntSeed existing-clip editor and shared wallet

The private Desktop `media.video.edit` flow now uses native-owned authenticated
RPC (`models.mycelliosVideoEdit`) to fixed `/v1/managed/video-edit/` routes:
GET `info`, POST `quote`, `execute`, `status`, `content`. The renderer cannot
settle or release Credits. Native account/Space/server and PC access are rechecked
around RPC; the coordinator independently authenticates the payer. No arbitrary
buyer URL, operator secret, wallet amount or signed receipt comes from the UI.

Activation is opt-in, off by default: `MYCELLIOS_MANAGED_ANTSEED_EDIT_ENABLED`
and `MYCELLIOS_MANAGED_ANTSEED_CONTROL_SECRET` on the coordinator, plus the
existing managed-provider budgets and Agent managed-apps gate. This adapter
requires a **dedicated operator buyer** at loopback 127.0.0.1:8377, with persistent
attributed-spend history and the `video-budget` capability. Do not attach it to
a customer's USDC wallet or to a buyer shared with another gateway reader.
Installing/configuring/funding/starting that buyer is outside local fixture work.

Quotes contain only source digest, verified metadata and instructions. Choose
an advertised video-input offer with supported text inputs, protocol, duration,
resolution and exact unit prices. Restrict upstream cost to <= 1 USD and exact
USDC base-unit precision. Add 4 percent once with the existing exact wallet
arithmetic. The signed execution digest pins seller, provider, service, protocol,
resolution, duration and prompt. A change requires another quote.

After explicit confirmation, upload at most 24 MB to Mycellios; verify its hash
and server-side FFprobe metadata before reserving funds. The native runtime
persists submitting state and a stable account/Space/server/project key first.
The coordinator reserves the shared wallet, claims one create, records the buyer
feed baseline and opaque tag, then queues once. Fal uses `request_id` and string
duration; Venice uses `queue_id` and seconds-suffixed duration. Pin provider and
service as well as peer/model; supply the buyer's upstream USDC price cap.

Status polls hold a durable `poll_until` lease (applied by the migration owner
alongside `remote_job_json`, never DDL at startup). Persist returned MP4 bytes
before probing or looking up spend so late receipts/restarts do not redownload.
A completed edit requires a valid H.264 MP4 plus exact attributed spend matching
the stored tag, seller, default operator identity, feed identity/history and
quoted unit cost. Missing/foreign/partial/extra spend stays reserved for review.
Failed or missing jobs do not automatically release potentially charged funds.
No customer-visible balance is invented from a local counter or quoted price.

Settlement and 4 percent fee use the existing shared purchase ledger and private
RLS storage. Content is downloadable only by the settled purchase's account.
Native delivery verifies the artifact hash, probes it again and saves the final
local project with its charged Credits. Confirmed pre-submission balance/quote/
source rejections return an editable draft; ambiguous submissions are recovered
only through status, never another create. Existing injected legacy wallet tests
remain test adapters; the default installed host uses this server-owned flow.

Scope remains text-instructed video editing. Character swaps requiring reference
images and live provider/economic qualification require separate approval and
tests. Retention, disputes and unknown-job operational review remain outstanding.


## Complete discovery and safe price categories

Discover bounded metadata from `/models?output_modalities=all`, including text,
image, speech, transcription, video, embeddings, rerank, decisions and mixed
outputs. `/v1/managed/catalog` requires an authenticated account and reports
capabilities and qualification reasons. `/v1/models` also retains unqualified
inventory with `available:false` and `creditEligible:false`; only qualified
chat routes enter the Agent chat selector. Inventory never authorizes execution.
A moving `~vendor/latest` alias requires pinned resolution before admission.
Small contexts that cannot fit the conservative input bound remain unavailable.

Text supports explicit zero-cost prices, fixed per-request charges, token rates
and conservative maxima across cached/reasoning/tiered prices. Unknown pricing
components, mandatory paid search, batch/online variants and non-text outputs
stay closed until their own bounded execution/payment contract is qualified.
Ordinary text disables the web plugin and sends `provider.max_price` limits
(prompt/completion per million tokens, request per request, image zero), with
parameter support required and no paid fallback. Operator plugin defaults must
allow disabling paid plugins; a dedicated key must have no unbounded paid
extras, an upstream hard budget and no fallback to a personal BYOK balance.
Those settings require operator qualification before any live activation.

Actual zero incurs zero Credits and can complete without a positive wallet
balance. It still uses authenticated API admission, request/concurrency limits,
a zero-valued durable hold, idempotency and a real zero-cost receipt. A positive
receipt against a zero quote is not a free success. Do not synthesize a tiny
reservation or charge simply to fit the old positive-only hold schema.

`MYCELLIOS_MANAGED_FUNDING_COST_BASIS_POINTS` is the effective supplier funding
cost, applied before the 4 percent Mycellios markup. If absent, paid OpenRouter
admission is unavailable. It must cover the actual supplier funding method,
minimum fees and applicable overhead; never assume a blanket 550 bps covers a
small top-up. `effectiveFundingCostBasisPoints(paidUsd,creditedUsd)` derives a
conservative rate from real funding receipts. 550 bps in tests is a fixture,
not a verified operator policy. Processor fees, disputes, taxes and actual
commercial margins still require qualification before cash top-ups are enabled.
A nominal 4 percent does not by itself guarantee a profitable service.

Quotes sign the execution body and funding policy. The reservation persists the
policy; settlement cannot substitute a newly configured fee. Keep raw supplier
cost, funding cost, platform fee and final debit separately. The accepted raw
USD maximum and Credit hold both bound settlement. An over-limit supplier
receipt is preserved, the hold remains pending and a durable safety stop blocks
new purchases through that supplier across accounts/restarts. Such a stop
limits further exposure; it cannot undo an upstream charge already incurred.
An operator must reconcile the incident before clearing the stop.

The migration owner applies the revised managed schema separately: funding
columns, settlement timestamp, safety stop, updated total constraint and
nonnegative holds. Runtime only verifies schema presence. Native reservations
retain their existing positive-amount validation. Generic failed-usage startup
recovery must not release managed reservations. Global daily budgets include
settlements on their settlement date and all unresolved holds from prior days.
Async media recovery uses durable poll leases across coordinator instances.

Local tests use a disposable loopback PostgreSQL cluster, never the active Dev
or production database. On Windows `MYCELLIOS_TEST_POSTGRES_BIN` can name an
existing PostgreSQL binary directory; the runner initializes its own temporary
cluster and stops/removes only that cluster. No operator funding, upstream
inference, live DDL, production flags or deployment are part of fixture tests.


## Bounded managed media and special services

Media requires the independent server-only `MYCELLIOS_MANAGED_MEDIA_ENABLED`
opt-in and Agent Apps admission. Neither flag is enabled by source changes.
Legacy hand-written media maxima remain rejected. Derive contracts from bounded
metadata at the fixed supplier origin: the all-modality catalog, image endpoint
capabilities/prices and video model SKUs. Sign the source digest, unit components,
fixed controls and funding policy alongside the execution body. Unit arithmetic
uses exact decimals and conservative whole-microcredit rounding.

Qualified contracts cover one fixed-size image at a pinned endpoint; character
voice with MP3 delivery and an advertised voice; duration-priced transcription
from canonical mono 16 kHz PCM WAV of at most 30 seconds; fixed-duration/resolution
video without generated audio; text embeddings; rerank with the query counted
again for every document; at most eight bounded Chat Completions batch requests;
and a text-only Decisions question with bounded state. Decisions use
`/api/alpha/decisions`, separately from `/api/v1`; extraction-only entries,
paid web-search decisions and unknown units are not interchangeable routes.
Refusals remain refusals, never a fabricated negative answer. A returned
probability is an estimate, not a fact or authorization.

Input-token estimates dominate UTF-8 text plus bounded protocol overhead; output
caps and context windows are checked before a hold. Transcription token billing,
uncapped token-priced image/video output, output-second speech, unsupported PCM
voice delivery, moving aliases and reference-required models stay unavailable
until their distinct contracts are qualified. Do not treat the catalog as proof
that every advertised service is executable.

Persist the async job or delivered-result snapshot before fetching a delayed
invoice. Video and batch submission require a durable submission callback.
Recover through leased status GETs only. Batch results arrive inline in the
batch response, may be out of order and must match the submitted custom IDs;
aggregate actual cost includes partial failures. Failed/cancelled jobs require
an authoritative actual-cost receipt, including explicit zero, before settlement.
Missing/mismatched invoices retain the hold. Never repeat a paid POST to recover
an artifact or infer a refund from a terminal failure alone.

Agent RPC requires the same viewer for all credit-affecting/recovery operations.
UI keeps the current simple layout, adds controls only when needed, prepares
transcription audio on-device, quotes first, and waits for explicit confirmation
for both positive and exact-zero prices. A confirmed unsubmitted balance failure
can be retried under the same request key; an uncertain create uses status only.
Top-up checkout remains separate, signature-verified and unable to credit funds
from a browser redirect. All managed services and referral promotions use the
same authoritative wallet without manufacturing native inference evidence.

Primary protocol references:
- https://openrouter.ai/docs/guides/overview/multimodal/image-generation
- https://openrouter.ai/docs/guides/overview/multimodal/tts
- https://openrouter.ai/docs/guides/overview/multimodal/stt
- https://openrouter.ai/docs/guides/overview/multimodal/video-generation
- https://raw.githubusercontent.com/OpenRouterTeam/docs/main/batch-quickstart.mdx
- https://openrouter.ai/docs/guides/community/multimodal-decisions
