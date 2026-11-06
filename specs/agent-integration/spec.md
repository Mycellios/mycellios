# Agent integration into the canonical Mycellios repository

## Objective

### Account-owned Desktop execution

Desktop owns the agent inference/tool loop for its authenticated account while it
is online and the existing native computer consent is valid. Cloud remains the
authority for accounts, Spaces, models, conversations, execution leases, approval
effects and accounting; no database or account is copied to the PC. Web and mobile
send to the same conversations. The cloud worker dispatches a bounded, ephemeral
runtime request to the capability-advertising Desktop and awaits its events.
Producer-side accounting, credential renewal, tool authorization, checkpoints and
steering remain awaited callbacks to the existing scoped worker. Provider keys,
OAuth access/refresh tokens, connection endpoints and credit observers stay in
cloud. Desktop receives model metadata and a scoped inference stream, not those
credentials. Genuine usage is accounted producer-side before the stream closes;
native-client usage/cost claims are not billing evidence. The approval judge stays
on the server so concurrent Desktop tasks cannot starve their own authorization.

Reuse the authenticated account Desktop transport and its ownership/generation
fences. Old Desktop clients do not advertise agent execution and retain their old
behavior. Once a run is dispatched to Desktop it must never fall back or replay
in cloud after a timeout, connection loss, Stop or update. Version the capability,
bound frames/callbacks and preserve cancellation, completion and uncertain-effect
semantics. Startup must not silently swallow an unavailable native executor.

Qualification requires callback/accounting/credential and cancellation tests,
old-client compatibility, remote and native builds, and a real existing-account
turn initiated outside Desktop. A synthetic runtime is not physical acceptance.

Maintain Agent changes in `Mycellios/mycellios`, alongside the distributed
runtime, while retaining separate builds and avoiding an accidental replacement
of either production service. The existing standalone clone is recovery evidence,
not the source for future releases.

## Captured source

- Canonical main baseline: `1a45f32d6deb5149fb8f7490c918b8285a622d4b`.
- Imported Agent baseline: `2150350db0c90a99871884c1ad8ebdf6ee6156d5`.
- Agent lives under `src/agent`, with its Apache-2.0 notices retained.
- Imported adaptations include first-party login, Micos, AntSeed, execution logs,
  the developer-mode preference and client-side filtering of loaded logs.
- No private laboratory configuration, credentials, database, model cache,
  node_modules, generated bundle or repository metadata is imported.

## Connection and model selection

Provider forms connect accounts and keys without selecting the running model.
The main and fallback role pickers own model selection. Connecting from an empty
main slot also preserves that slot until the user explicitly chooses a model.

Compatible catalogs are discovered when the role picker opens, with an owned
credential ID and endpoint. Cache entries remain scoped to user, Space and
connection. API keys stay on the server. Discovery never enables or selects a
model, and a catalog may exceed the bounded persisted enabled-model list.

Choosing an unenabled compatible model first adds only that model through the
existing connection API with `makeDefault: false`, preserving the endpoint,
credential and runtime limits, then saves the intended role. Failure of the first
step must leave the role unchanged. No models are silently evicted to make room.
The legacy connection API still requires a bootstrap model ID; the first discovered
ID supplies this connection metadata, without assigning it to any role.

## Linked integration account identities

The selected integration detail uses a separate authenticated `connections.accounts`
read, scoped to the actor's user and Space and the chosen connector/provider.
It returns a public identity label alongside the existing connection DTO.
The editable local alias remains separate from the provider identity.

The managed adapter resolves only the exact owned active authorization. Composio
lookup uses its published current-user GET endpoint and exact connected-account
ID, with a bounded deadline and a short owner/Space/authorization-scoped cache.
Only public profile labels or the documented provider displayName are projected;
credentials, arbitrary provider payloads and aliases are never identity evidence.
Legacy slug-only records and unavailable profiles remain explicitly unidentified.
Always send the acting application user ID alongside the exact authorization on
profile proxy requests. Composio projects enforcing owner verification reject an
unscoped request even when the account is active. The pinned core SDK's high-level
proxy drops that field; use its public API client with `user_id` and
`connected_account_id`, retaining cancellation and zero automatic retries.
An offline wire regression must inspect the installed client's serialized body,
not just a mock of the high-level helper. Configured provider wrappers must
forward the identity operation through their normal credential resolver and
observe credential rotation, returning null when unsupported or unconfigured.

A second scoped database read drops revoked grants and prevents an old identity
from being attached to a reconnected authorization. No migration or account
mutation is needed to view the detail.

Confirmed accounts and pending authorizations render separately. Users can
disconnect one account without removing the others, cancel an unfinished attempt,
or disconnect all explicitly. The dialogue fits its content and safe viewport;
all new copy and the update announcement use the thirteen existing catalogs.

Qualify the provider/ownership races with offline tests and the actual production
React component at phone, tablet and desktop widths. Fixtures do not prove live
provider identity resolution. Publication requires both API and web artifacts;
retain the existing external-browser OAuth completion and native-host boundaries.

## Remaining migration gates

Desktop update continuity uses the canonical npm workspace and lock, rather than
the standalone clone or saved candidate. Both ordinary and unified packaging run
the shared beforePack gate in apps/desktop/scripts/verify-release.cjs. Builds write
source/version/output receipts for the native host, bundled web UI and local API;
missing, changed or stale inputs stop packaging. This includes dirty canonical
source files without replacing concurrent edits. The per-user app ID and legacy
userData directory remain stable. Upgrade fixtures exercise remembered account
permission, existing PROJECT.md notes and expiry of an older local UI override.
Public installer publication and a physical OS upgrade require separate evidence.
Desktop builds use the --desktop web variant: root assets for the managed local
stack and a separate first-party bundle for /agent. After an older profile override
expires, the official Agent selects that packaged bundle. Auth/API/RPC traffic
continues to its original server/session, and self-hosted servers retain their UI.

The additive technical-logs API release is qualified separately from the full
Agent migration. Its receipt is under
`src/agent/outputs/logs-api-release-20261030/deployment.json`: the published
`2150350d` API base plus the immutable `0a5510d3` logs patch, with canonical main
`1a45f32d` synchronized immediately before promotion. Only the API was replaced;
the existing web, worker, authentication, credentials and persistent storage were
retained. Qualification includes 24 local image tests, focused incremental
typecheck, an isolated database-snapshot check and an authenticated HTTP 200 with
diagnostic details in the loopback production preview. This does not qualify or
publish the remaining imported Agent UI changes or the native runtime.

1. Resolve and lock the nested npm workspace without changing the root runtime's
   dependency graph. Preserve dependency overrides and qualify the existing
   desktop packaging patch before any native Agent release.
2. Replace executable pnpm assumptions in launch/build/lifecycle commands with
   npm equivalents; upstream documentation alone is not a working launcher.
3. Run Agent focused tests, incremental typechecks and web build from this path.
   Earlier checks of the standalone clone do not qualify this new layout.
4. Verify root structure, architecture and typecheck after isolation changes.
5. Finish the shared selector styling and browser QA in the canonical source.
   Developer logs remain off by default under General/Advanced.
6. Promote only a verified artifact built from this repository. Switch the private
   preview launcher first, with a backup and an exact served-build check. Preserve
   production until its separate promotion gates are met.

## Data and worker isolation

A local UI that uses real account data must call the authorized production API.
Development workers must not be connected to the production database. Browser
developer mode is a display preference and never grants extra server permission.

## Current evidence boundary

The source is integrated in the canonical layout with an owned npm lock. Active
launchers and application/updater/supervisor Dockerfiles use npm and the canonical
repository build context. API, worker, web and Desktop have passed local scoped
types; API/worker and both web variants have built locally. Native architecture
and release provenance follow the separate compiler boundary, while the component
gate still checks both workspaces. The integrated release candidate preserves
source recovered from actual production overlays and concurrent account-computer
changes. Final full-suite, immutable artifact and production promotion evidence
remain separate release gates; source integration alone is not deployment.

## Production API preview qualification

`scripts/production-preview.mjs` under the Agent workspace is a loopback-only,
fixed-upstream bridge prototype. It does not read database credentials or start
workers. Origin checks, fixed path translation, JSON URL translation and cookie
flag preservation have focused Node tests. Its temporary probe on port 5189
reaches the public production API; unauthenticated get-session returns null.

The active qualification URL is `http://localhost:5191`, leaving the original
5188 laboratory tunnel unchanged. The UI assets come from the existing private
preview through a separate 5187 tunnel. API and RPC requests use the public
production Agent endpoint; no development worker or database connection is
started. The distinct localhost hostname also separates its cookies from the
old 127.0.0.1 laboratory preview.

The local sign-in adapter keeps the original production OAuth client and
callback URI. It validates the production client/callback/scopes for pending
consent and accepts the provider's direct return for already-approved accounts.
Only the exact production callback is mapped back to this browser preview;
production retains authorization-code, state, PKCE and nonce checks. Passwords
and bearer tokens are never written to diagnostics or disk. The short-lived
retry token is held in bounded process memory, and MFA accounts fail closed.
Production login configuration and permissions are unchanged.

Qualification found two transport issues: Chromium form POSTs lost their Origin
under no-referrer, and previously-approved accounts returned a direct callback
instead of consent details. Both paths are corrected. Empty OAuth redirects
must bypass JSON parsing so Location and session cookies survive. Focused Node
tests cover path and cookie translation, foreign-origin rejection, the pinned
identity callback, direct approval and redirect response classification.

Browser qualification now confirms the real account, its three existing agents,
credit display, and the complete Film Studio history. Reload preserves the
authenticated session without another login. An existing 12-second 1920x1080
video attachment loaded with readyState 4 and no media error; no new generation
or charge was triggered. Seven focused local Node tests pass. Old/bookmarked
consent forms automatically restart sign-in instead of replaying consumed IDs.
Do not publish this bridge as a general-purpose reverse proxy. Screen/terminal
WebSockets are not enabled by this account-data bridge.

## Shared first-party login

First-party Mycellios login redirects automatically within the main window on
web and Desktop. It uses the existing Better Auth/OIDC redirect, callbacks and
persistent per-server Electron session. The intermediate sign-in launcher is
replaced by the existing branded loading view while navigation starts. A failed
or rejected attempt stays on the explicit retry screen instead of redirecting
again. Keep generic self-hosted SSO, model and MCP popup flows intact;
do not allow arbitrary identity origins in Desktop main-window navigation.

Managed app connections open an ordinary external browser target on Desktop.
Both the integration catalog and chat authorization cards retain server-owned
completion polling, so a missing popup handle does not abort authorization.

Qualification: affected local tests and incremental web/native types pass.
The compiled first-party flow was checked with an isolated identity fixture;
the installed Windows profile retained its real account after reload and full
application restart, with one window and no password submission. The same
immutable frontend was then verified from the public origin after removing the
local asset override. This is an existing-profile update, not a clean-OS
installation test. API, worker and history remain unchanged by the login patch.

## Sidebar contribution and Desktop

The web sidebar offers Desktop separately from browser contribution, using
`/downloads?product=desktop` so native-runtime packages are never labelled as the
Desktop application. Until a qualified Desktop release is published, that page
states its availability explicitly. Both web links preserve the current chat;
native Desktop retains its account-owned start/pause control. Browser contribution
continues through the existing worker page; opening the link is not proof of
connection, completed inference or an earned balance.

## Approval model default

An empty approval role inherits the effective main model and connection on each
resolution, respecting account versus Space scope. Never persist a copied main
model ID to represent inheritance or replace an existing explicit approval choice.
The web groups the complete approval section under one Advanced disclosure at
the bottom of model settings, after providers. Keep its information control next
to the approval title inside that group. Validate model changes, pinned credentials, scope isolation,
explicit overrides and reset in isolated local tests; do not change live settings
or deploy the backend to exercise this work.


## Complete Agent web release

### Mico task and routine conversation boundaries

The shared web/PWA/Desktop renderer exposes conversations inside each existing
Mico. A tab creates a thread rather than another bot, provider connection or model.
The URL carries the task identity; optional `taskSpace` pins cross-Space links
until server admission. RPC clients, caches, review drafts and composer drafts
retain owner, Space, bot and thread through navigation and late responses. A
mismatching server snapshot fails closed rather than rendering the primary chat.

Cron, Test, webhook and GitHub entry points resolve one owned conversation per
routine when no explicit target exists. Existing group/direct targets and history
stay where they were. Matching unattempted timer backlog may be retained in its
original primary thread during adoption; attempted, manual, changed-model or
externally affected work is not folded or replayed. Each event routine gets its
own prompt and model pin. An additive receipt freezes the first recipient set,
and the scoped Run stores its external nonce. Clearing chat or adding another
routine cannot replay new routine deliveries. Deleted/disabled recipients never
redirect to the main chat. Raw webhooks retain earlier deduplication behavior;
erased pre-upgrade identities cannot be reconstructed. This is not a universal
exactly-once side-effect guarantee.

Routine runs exclude shared graphical/page controls, app launch and takeover.
Files, shell and connected applications retain existing OS/account permissions;
this is not a filesystem sandbox. Computer execution leases remain authoritative:
private chats do not establish four concurrent computer jobs per Mico. Private
live calls are disabled until their transport is scoped; dictation and reading
replies remain. Private push on the separate native client offers the exact web
task link until native task rendering is qualified, without forwarding tokens.

Native runtime discovery checks executable availability and rejects broken
overrides. Bounded provider diagnostics map to fixed actionable errors without
echoing raw payloads. Unknown CLI billing stays unknown, without fabricated costs.

Qualification uses focused tests and incremental types, real loopback PostgreSQL
migration/ownership/RLS/concurrency/replay acceptance and browser component checks
for task creation, selection and narrow/light/dark layouts. Component fixtures do
not establish end-to-end model, phone or installed-app acceptance. Promotion of
source and schema requires separate release qualification.

Frontend releases snapshot the complete canonical `apps/web` source/public assets
and shared browser packages, not selected UI fixes over an older application.
Keep explicit provenance for the source file hashes, extra dependency lock and
compiled public build ID. Verify frontend tests and incremental types locally;
confirm the immutable bundle with the constrained release compiler when local
RAM cannot support that build. Preserve startup font license notices.

The web-only 2026-10-30 receipt is recorded under
`src/agent/outputs/frontend-release-20261030/deployment.json`, with source and
artifact hashes in `qualified.json`. Worker/API images, process start times,
configuration and prior worker/logs overlays are retained. Previous hashed
assets remain available for already-open clients. No production schema migration
or replacement of the contribution ledger is part of this frontend deployment.
Verify real account re-entry, owned native credit and AntSeed conversations on
the published frontend; do not infer their success from a static build alone.
The separate real-model long-context failure is not repaired by a web release.


## Shared-web Android distribution

The Android APK packages the existing `apps/web` build at the existing first-party
HTTPS namespace. It owns only WebView navigation, foreground speech recognition,
Android permissions, file selection and a Dictate launcher shortcut. Account, Space,
Mico, model, conversation, draft and send behavior stay in the shared application.
`com.mycellios.android` is the signed distribution identity; preserve the legacy
Expo preview rather than replacing its different certificate or erasing its profile.
The release signer stays outside Git, with a recoverable private backup. Versioned
APK/source artifacts and their SHA-256/signing identity are published through an
independent Android catalog; existing Desktop/runtime catalogs remain intact.
Manual APK updates must preserve the same signer/package and increment versionCode.
No Play Store publication or unattended installation is included. Verify the exact
packaged candidate, native bridge boundaries, existing account login, physical
shortcut from Home/another app, real speech and explicit review/send separately.
