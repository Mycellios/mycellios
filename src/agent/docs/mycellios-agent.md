# Mycellios Agent development integration

This fork keeps the upstream agent runtime, authorization, persistence and tool
approval boundaries. Its web product is Mycellios Agent, with Mico as its mascot and Micos as the name of user agents. Internal spending units are Credits (Créditos); paid top-ups use 1 USD = 1 Credit. Spore is the separate official token name. Preserve funding-source separation, existing balances and token launch gates.
Apache-2.0 licensing and upstream legal notices are retained.

## Required outcome

- A simple, responsive branded conversation surface with history, model choice,
  clear connection state and an authoritative Mycellios credit balance.
- A working conversation through Mycellios, including a real tool round trip,
  cancellation and bounded streaming. An offline emulator is test evidence only.
- Credit accrual must follow verified contribution receipts. Reserve, settle and
  refund consumption idempotently; do not turn provider USD balances into MYC or
  grant spendable credit based on browser-reported activity.
- Keep server credentials out of browser bundles. Preserve per-account isolation.
- Optional browser speech must have a visible stop control and a text fallback.
- Run all changes and test accounts in isolation. Do not change production,
  restart existing engines, or perform model inference on the developer PC.

## Product direction

Reuse the existing React application, shared UI components, agent execution loop,
thread events and persistence. Mycellios is selected through the existing
OpenAI-compatible connection contract. Advanced integrations and computers remain
available through settings instead of being shown on the primary conversation.

The visual palette is forest, warm paper, ivory, sage and bronze, matching the
Mycellios brand. Semantic colors live in `packages/ui-tokens/src/index.ts` and
generate the shared CSS. Avoid gradients, decorative status cards and duplicate
navigation. Mico is an original generated asset in `apps/web/public/mycellios`.

## Verification gates

1. Focused provider/credit tests cover failures, duplicate receipts, concurrent
   spending, cancellation, unauthorized accounts and unsupported capabilities.
2. A real isolated database verifies persistence and balance reconciliation.
3. Browser tests verify a conversation and tool result, saved history, model
   selection, insufficient balance, keyboard/mobile layout and speech controls.
4. Type checking, build and visual review pass for the affected packages.
5. A separately recorded real Mycellios inference proves the connected route;
   neither mocked transport nor screenshots establish this gate.

Production publication, real-balance migration and native app packaging are not
part of this development deployment. Any isolated starter balance is visibly
identified as a test balance and has no value in production.

## Model connection and account boundary

Reuse the saved OpenAI-compatible connection with the canonical API root
`https://www.mycellios.com/v1`. Its personal credential stays encrypted on the
server. The account RPC resolves the current user's default connection and
owned secret; the browser cannot choose a different account or send an arbitrary
credit endpoint. Only canonical HTTPS origins supply a MYC balance.

`GET /v1/account/economy` supplies the authoritative contribution balance. The
adapter validates asset and safe integer amounts, bounds response size and time,
refuses redirects, and hides upstream diagnostic bodies. No balance is cached as
a local spendable allowance. Mycellios owns contribution accrual and consumption;
the fork must not add an independent debit or mint credits on message completion.
The optional upstream hosted-provider balance remains explicitly labelled USD.
The contribution balance uses the user's owned canonical Mycellios connection
even when another chat provider is selected. AntSeed model charges and MYC
contribution credits remain separate amounts.

When the authority advertises `contributionFundingSupported`, connecting the
account saves the explicit `x-mycellios-funding: contribution-credits` mode in
the encrypted connection. The authority reserves the maximum, settles observed
usage and refunds unused or failed work. The indicator displays available MYC
after holds. A legacy authority without that capability keeps its existing
funding behavior; a balance read alone does not establish paid MYC inference.

Without a configured computer host, thread snapshots report `kind: none` with
screen, terminal and update controls disabled. Conversation history remains
available. Computer tools still require an authorized, provisioned host.

Manual read aloud can use an installed device voice when no server voice is
configured. It never falls back automatically to an online browser voice and
includes cancellation. Absence of a local voice preserves the text reply.

### Optional computer and voice configuration

Configure `SANDBOX_PROVIDER=docker` and the authenticated sandbox supervisor to
enable a real computer. Run the API as an unprivileged user; only the supervisor
needs the Docker socket. Keep the shared data directory writable by that user,
and set explicit computer memory, CPU and concurrency limits. Persist agent homes
across stop/start. Screen and terminal access must retain their control leases and
revocable capabilities; provisioning a host does not bypass those checks.

Enable `PHONE_CALLS_ENABLED=true` to expose the voice controls. In the existing
OpenAI-compatible voice connection, configure a server that implements speech
and transcription, its model identifiers, and a voice matching the language.
When that connection supports transcription, dictation and calls prefer it over
the browser's speech service. Keep browser recognition available when no server
transcriber is configured. Microphone permission remains a browser decision.

Validate recording, cancel/restart, transcription into chat, read aloud and a
complete voice turn with synthetic audio before testing a real microphone.
Validate computer file transfer, stop/start persistence, shell/browser tools and
interactive terminal effects separately. Do not treat a provisioned status or a
signed URL alone as evidence that those workflows completed.

The web fork does not link to upstream native installers; branded native
packaging requires its own qualification. Internal protocol and storage names
remain compatible with upstream.

## First connection

The first-run form selects Mycellios and its canonical endpoint. Its account key
is a required, visible password field before model discovery. Endpoint editing
remains available through the ordinary compatible-provider option. Other model
providers remain selectable, and changing providers clears the typed credential.
The preset uses the same saved connection and model-discovery contracts; it does
not create a second provider implementation or replace Mycellios authentication.

The browser never issues contribution credits. The economic authority currently
requires attributable, verified physical GPU execution. CPU-only development
inference proves the agent integration, but cannot establish contribution accrual
or the complete earn-and-spend lifecycle.

## Development delivery boundaries

The manual development connection uses an encrypted Mycellios API key. The
isolated preview also supports the OIDC account connection described below;
that qualification does not configure the production dashboard's sign-in.
Neither path bypasses account ownership or creates a production credential.
Hosted USD funding remains a separate option.

The MYC indicator reads the authoritative account endpoint. It does not implement
a second ledger, mint credits, or establish that a contribution was rewarded.
Economic accrual and charging must be qualified on Mycellios itself before
advertising a complete contribute-and-spend experience.

For isolated first-connection browser tests, set `AGENT_CONNECTED_E2E=1` and
`PLAYWRIGHT_BASE_URL` to the private development origin, then run
`pnpm --filter @rakazo/web e2e mycellios-onboarding.spec.ts --workers=1`.
The optional real model-discovery case requires `AGENT_E2E_API_KEY_FILE` pointing
to a private development account key file. Never use a production key, enable
traces/videos for that case, or include the key file in delivery artifacts.

## Initial private qualification

The isolated development composition has completed a real authenticated browser
conversation through the native CUDA authority, with model discovery, persistent
history and contribution-funded settlement. The account first earned credits
from verified physical work; the subsequent agent request reserved and settled
credits with no remaining hold. These are private test-ledger credits, not a
production balance or a public release. Qualification used one physical GPU,
not a model distributed across multiple physical computers.

The native development candidate also fixes prompt prefill chunking so that
long agent instructions respect the configured activation budget. The agent
requires a nonempty completion and reports empty provider responses as errors.
Completed conversations survive reload; the narrow-screen layout and speech
generation/playback have separate browser checks.

The private preview uses a disposable sign-in, separate database and native
ledger, and loopback-only SSH transport. That initial qualification preceded
the OIDC account connection below. No computer sandbox was provisioned.
The initial qualification used expiring transports. The subsequent private
composition supports supervised restart without an operational session deadline.
This is still a private preview, not a permanent public hosted deployment.
Stop only the dedicated preview processes and containers to revert;
no production service or database migration is needed for that rollback.
## Mycellios account sign-in and publication

The account connection uses the existing OIDC client, including PKCE, nonce,
verified ID tokens and issuer-bound subject identity. It does not link accounts
by email. The explicit account button resolves the signed-in user's linked
issuer and provisions a native model key on that user's account. Model and OAuth
tokens are never returned by the account-connect RPC. Public HTTP token-export
routes are blocked; the server can still refresh the linked token internally.
Credential creation is audited without storing credential values in the event.

The native authority must explicitly trust this OAuth client ID. OAuth app tokens
never inherit network administration roles. Native account keys remain revocable
in Mycellios. Failure during discovery revokes the newly created unused key;
creating a connection does not run inference or spend MYC. Contribution funding
is required for this automatic path; an older authority is not silently used in
operator-funded mode. Other manual compatible connections retain their behavior.

Publication configuration, prepared but not applied to production:

1. Deploy the native candidate with its ledger changes and `/oauth/consent` UI.
2. In the Mycellios Supabase Auth project, enable the OAuth server with asymmetric
   signing, set the consent path, and register a confidential Agent client with
   the exact HTTPS callback `/api/auth/callback/oidc` on the Agent's public origin.
   Keep dynamic registration disabled unless separately required. See the
   [Supabase OAuth setup](https://supabase.com/docs/guides/auth/oauth-server/getting-started).
3. Add that public client ID to `MYCELLIOS_SUPABASE_TRUSTED_OAUTH_CLIENT_IDS` on
   the native authority. Store the client secret only in the Agent server's
   existing OIDC secret configuration. Configure `OIDC_ISSUER`, `OIDC_CLIENT_ID`,
   `OIDC_CLIENT_SECRET`, `OIDC_NAME=Mycellios`, and `MYCELLIOS_SSO_ENABLED=true`.
   Keep `OIDC_ALLOW_SIGNUP_BYPASS=false`; preserve the existing signup policy.
4. Set the initial connection limits with `DEFAULT_MODEL_MAX_TOKENS` and
   `DEFAULT_MODEL_CONTEXT_WINDOW` based on the model and admitted hardware.
   Users can subsequently edit their saved connection through the existing UI.
5. Validate HTTPS login, denied/replayed callbacks, own-account balance and a
   funded completion on the actual deployment before opening public traffic.
   Private-instance qualification does not establish that a production OAuth
   client or redirect has been registered.

The private model qualification uses a pinned Qwen3-1.7B snapshot. Repacking its
exact tensors into separate safetensors files reduces the Windows startup memory
mapping peak; it is not quantization or a multi-host inference claim. The lab
keeps the existing speech and embedding reservations. Lab credentials and cookies
live outside source and Vite file-serving roots and must not be packaged.

For small-window non-reasoning compatible models, context admission remains in
the runtime. The SDK's raw stream then preserves the admitted output limit,
avoiding the simple wrapper's additional fixed 4096-token subtraction. Conversation
history retains actual user/assistant roles; historical text adds no new usage.
The offline SDK boundary test verifies both the output limit and those roles.

Native SSE responses translate real text, reasoning and tool argument deltas.
Final usage, a validated tool envelope and the terminal event are required before
a tool turn succeeds. JSON-only providers retain bounded buffering. A private
composition may set a per-request native deadline for long work without changing
shared gateway defaults. Saved output limits, model context and engine admission
must agree; increasing a frontend value alone does not increase engine capacity.
For non-reasoning models, local admission can reduce the output reservation for
one call when required input would otherwise exceed the window. The same smaller
limit is used by credit admission and the actual request. It never discards
protected input or changes the saved ceiling; input that still cannot fit fails
before inference or spend.

The API composition can set `authSessionDurationSeconds` to a rolling authenticated
device lifetime between one and ninety days; other deployments keep seven days.
The web client refreshes the session on focus and periodically while connected.
Inactivity expiry, explicit sign-out, revocation and fresh authentication for
sensitive account changes still apply. OAuth access-token expiry is unchanged.

The subsequent private OIDC run completed sign-in, automatic account connection,
a real Qwen3-1.7B CUDA conversation, an executed read-only fleet tool, persisted
history and narrow-screen layout. The same account earned MYC from physical work
and spent it through the agent. A stop during prefill released the entire observed
hold with unchanged balance and settled-job count. Speech generation and browser
playback also completed. These are isolated test accounts, not a verification of
the production OAuth configuration or a general model-quality benchmark.

Rollback of the new sign-in entry is disabling `MYCELLIOS_SSO_ENABLED`, while
retaining OIDC and existing accounts/keys until their users have migrated. Revoke
an unwanted model key through Mycellios; do not drop users, balances, ledger
history or signing keys as part of a UI rollback. The generic OIDC and manual
model connection routes remain available according to deployment policy.

## AntSeed gateway

Choose AntSeed in Models, paste the gateway URL from its console and its gateway
API key, then find and select a model. The server stores the key encrypted and
sends it as a bearer token. AntSeed is an independent provider entry; saving it
preserves the Mycellios connection. Model IDs, including peer-pinned IDs, remain
unchanged. AntSeed wallet budgets and usage are separate from Mycellios MYC.

The shared compatible transport retains endpoint-bound key reuse, bounded model
discovery, HTTPS for keyed public URLs, DNS checks and private-endpoint policy.
Public gateways require the operator's existing
`RAKAZO_OPENAI_COMPAT_ALLOW_PUBLIC=1` policy; connecting AntSeed does not override it.
A loopback gateway is local to the Agent server, not to a remote browser. Use an
HTTPS gateway reachable by that server, unless the operator has explicitly
configured private endpoint access. The interface does not install or expose a
local gateway automatically. A gateway model must support the chat/tool protocol
needed by the requested agent task.

Reference: https://antseed.com/docs/gateway/api/

## Cost per task

Each persisted assistant task can show one inference total beneath its last reply.
The server sums unique attributed model calls, including intermediate steps,
retries and descendant runs, scoped to the authenticated account and space.
Confirmed provider charges, catalog estimates, pending settlement and unavailable
cost are separate states. Partial totals are never presented as complete totals.
Small nonzero amounts must not round down to a displayed zero.

AntSeed calls carry an opaque per-call end-user value. Free gateway pricing
headers can confirm zero; other charges come from matching request receipts
through that same key's normal read-only console session. Keys/cookies stay on
the server. Do not use shared key balance deltas, create administrator tokens,
relax endpoint guards, or silently convert MYC to USD. Failed receipt reads leave
cost unavailable. Pending receipts may be reconciled when task totals refresh.
The total covers model inference, excluding chain gas and external tool services.
