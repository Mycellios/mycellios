# Status and evidence

## Conversation responsiveness candidate — 2026-11-11

The candidate shows a local pending user message before send acknowledgement,
scoped to account/Space/thread. Exact client nonces and acknowledged message
sequences reconcile SSE-first and HTTP-first delivery; matching text is not used.
Rejected sends retain existing draft recovery. Message sequence identity remains
separate from the subscription's event cursor. Repeated Send presses are fenced
before React commits. Queue/steering, permissions and model selection are retained.

The authoritative snapshot still reduces every event immediately. Only repeated
progress presentation is coalesced into animation frames; first progress,
structural/terminal events, navigation and streaming preference changes flush
without waiting for a frame. Stable reply-jump callbacks preserve memoized history
rows. Short send/live-reply/control transitions respect reduced motion and do not
replay streamed text on completion or take scroll ownership from a history reader.

Local focused validation passed 259 tests. A browser fixture using the real
Composer and Transcript passes delayed acknowledgement, delivery ordering,
rejection, account/Space/thread isolation, mobile light/dark, reduced motion and
history-scroll checks with synthetic events. In one Windows development-browser
comparison over 123 identical events, immediate presentation requested 123 paints
and frame presentation 55; React profiler render totals were approximately 605 ms
and 429 ms. These are controlled UI measurements, not live model latency,
production timing guarantees or installed Desktop qualification. Full suites
remain paused. Remote validation and publication require separate evidence.

The review compared [Rakazo conversation synchronization](https://github.com/elie222/rakazo/tree/v0.9.0/apps/web/src/pages/shell)
and [OpenBot conversation UI](https://github.com/nightly-labs/openbot/tree/v0.67.1/packages/ui/src/features/conversation).
The implementation uses existing Mycellios components without a new dependency,
copied OpenBot implementation or an artificial typewriter backlog. See
`specs/chat-fluidity/spec.md` and `scripts/verify-chat-fluidity.mjs` in the Agent workspace.

## Connector and approval hardening — upstream review, 2026-11-11

The candidate collects explicitly named credentials in local MCP launch arguments
(flags, headers, environment assignments and URL passwords/query tokens) without
changing the arguments passed to the process. These values join existing output,
error and log redaction. Credential-bearing tool names/schemas are omitted;
descriptions are redacted without rewriting schema keywords. This is explicit
credential detection, not arbitrary program or credential-file analysis.

Auto Review accepts one complete flat `pass`/`ask` verdict, optionally JSON-fenced.
Duplicate keys, unknown fields, surrounding text, malformed fields and oversized
replies follow the existing owner-approval fallback. MCP browser authorization
accepts URLs up to 16,384 characters, including appended parameters; resource URL
limits, origin validation and private-network authorization remain unchanged.

Local focused validation passes 224 tests in launch credential, MCP connector,
OAuth, Auto Review and reviewer-factory suites. The regression fixtures cover
launch/discovery/call failures, model-visible outputs and credential-bearing
schemas. They do not qualify a live provider login or installed Desktop update.
Remote typing, integration and publication need their own exact-revision evidence;
full suites remain paused. These independently implemented changes were selected
after reviewing [Rakazo 0.9.0](https://github.com/elie222/rakazo/releases/tag/v0.9.0)
and [OpenBot 0.67.1](https://github.com/nightly-labs/openbot/releases/tag/v0.67.1).
Existing ZIP import already accepts missing Unix file types while rejecting links
and devices; no OpenBot implementation was copied.

Publication is independently recorded for main
`02daa6c03690843fd519f47e9b62e6e8d1f689e7` (PR #222), source tree
`929bb5877f55cbed6380d25728a58ad1b90002b7`. PR run `42996170124` passed
web/API/worker/Desktop typing and 2,436 related tests (308 skipped), plus 142 changed
tests; these sets overlap. Workspace/browser and Windows acceptance passed in
run `42996169567`; post-merge run `42996886076` also passed. The remote Linux
release built API/worker and verified compiled startup. Its archive SHA-256 is
`b77f3a5146a5991602c6766be842e0febe4c18f1203d127311acd66a67840650`.
Production mounts serve the corresponding verified bundles and public readiness
is healthy. Existing environments, frontend and gateway were preserved; gateway
provenance remains its separately qualified earlier revision. No database
migrations were added. The database backup and prior containers are retained
for rollback. This server publication does not update the installed Desktop
or qualify a live provider OAuth login.

## Tailscale private MCP connections — server release, 2026-11-11

Conexiones has personal and company tailnet enrollment, explicit per-Mico network
grants and an MCP network selector. Each user/Space/network uses a separate
userspace device in an optional private Linux gateway. Existing MCP/tool grants
are retained. Discovery, cached-session execution and every private HTTP request
revalidate owner, current membership, network policy and the saved MCP binding.
Company policy cannot be bypassed by labeling its known tailnet personal.
Separate private OAuth origins need explicit per-MCP authorization. Disconnect
closes admission before device cleanup; the gateway never retries uncertain calls.

The source incorporates main `fd83aa53ed7567c0918cd7a90f1f9b2946876d7e`, preserving
its floating-chat, spoken-reply and translation changes. Local focused validation
passes 302 tests across contracts, transport, MCP/OAuth, authenticated API and
deployment settings, plus three gateway protocol tests. Incremental API, worker
and web typing passes. An isolated loopback PostgreSQL instance passes the actual
additive migration, legacy MCP compatibility, network FK and owner/Space RLS
checks. The real network/MCP components pass synthetic browser interactions at
desktop and 390px widths. Synthetic RPCs and MCP emulation are not a live tailnet.

  The Linux gateway Docker build and unprivileged native startup passed in hosted
  CI. Run `42985962400` enrolled two real userspace Tailscale clients in a disposable
  Headscale 0.29.6 network, verified encrypted peer reachability and executed the
  private MCP through the actual Mico connector and isolated PostgreSQL. Network,
  MCP and tool grants, owner/Space isolation, cached-session revocation and company
  policy revocation passed. Both clients ran in separate containers on one hosted
  runner; this is not physical two-host evidence. The migration history applied
  successfully, separately from the focused PostgreSQL RLS qualification.

  Native startup obtained a real official Tailscale device-consent URL. Completed
  Tailscale SaaS browser consent, a full LLM-driven Mico run and a new packaged
  Desktop release are NOT QUALIFIED by these checks. Production publication needs
  its own exact-revision build, deployment/rollback receipts and health checks.
  Full suites remain paused. The older general Compose environment audit reports
missing pre-existing non-Tailscale settings; the focused Tailscale comparison
passes and does not enable global private egress. No release or production
  capability follows from validation alone. See `DEVELOPMENT.md` and
  `specs/tailscale-connections/spec.md`.

Server publication is independently recorded for main
`c63f0aad06f41ba372a2de8281a6c470a0ddcf08` (PR #219), source tree
`45626642bcbcf511c30a5fa3843e11c033d1a3e8`. API, worker and web were built from
that integrated revision; web build `20261111083935` is publicly served. The
private gateway is active without privileges or published ports, with the exact
same source tree as its qualified CI image. Production runtime probes verified
API/worker gateway configuration and access to the new tables with their existing
database role. The additive migration, database backup, retained prior containers,
backend/frontend deployment receipts and health checks passed. The final live
permission matrix is run `42986840658`, including another actual member in the
same Space, no upstream requests on denial and real device logout on revocation.
This server release does not imply an updated installed Desktop renderer; Windows
packaging/publication has its own revision-bound qualification and catalog.
Enrollment uses official device login. It does not implement Grok Bot's
[OAuth Apps onboarding](https://tailscale.com/blog/oauth-apps-ga), which requires
a separately registered Mycellios OAuth App, or its app-specific posture policy.

## Desktop-owned Mico execution candidate - 2026-11-07

The local candidate adds account-scoped Desktop execution of the existing Mico
runtime through the authenticated outbound Desktop transport. Account data,
conversations, model credentials, authorization and provider accounting remain
server-owned. Older Desktop clients keep their existing route; a remembered local
executor that goes offline fails explicitly instead of replaying work elsewhere.

Remote focused tests cover the real Pi engine against a fixture provider, the
authenticated API/native-client/host path without a renderer, cancellation,
concurrency, account isolation and restart replay fences. An isolated PostgreSQL
test applies the additive migration and verifies Prisma, tenant RLS and membership
deletion. Agent API, worker, shared web and native Desktop bundles build remotely;
structure, architecture, boundaries and affected incremental types pass.

This is not a deployment or installed-Windows acceptance result. Production has
not received this migration or runtime, and the current account/mobile-to-PC flow
still requires qualification after an authorized release. Full suites and physical
cross-device acceptance have not been run for this candidate.

## Agent production and Windows Desktop 0.3.18 - 2026-11-06

[Desktop 0.3.18](https://github.com/Mycellios/mycellios/releases/tag/desktop-v0.3.18-windows-preview)
is published in all three official desktop catalogs. Production web, API and worker
serve main `a3171d9f348874eaba65d7a9747b42e7e69fa7b9`, tree
`ae6c938c028e83d23ee80eebed564dd4fabacaf6`. The qualified build candidate
`d2d170075fe2d8689db03a80e9e73b1ef9a004e6` has the identical integrated tree.
Public web build `20261106172524` passes readiness and an anonymous
browser check with a working sign-in control. Prior services, downloads and a
database backup are retained; this release adds no database migration.

Windows checks and stages verified updates in the background. Installation still
requires explicit confirmation; the unsigned automatic-install channel stays disabled.
Restart now can checkpoint and requeue the same owned Run without waiting for all
native tasks to finish. Saved drafts and fresh owner/session-bound PC grants survive;
uncertain commands require receipt inspection before further mutations. Both direct
and relayed native interruption/reconnect tests retain a real command's receipt
without executing it twice. Windows receipt replacement retries transient sharing
locks within a fixed budget and reports completion only after persistence.

[Proportional CI](https://github.com/Mycellios/mycellios/actions/runs/42261241991),
[Windows/workspace acceptance](https://github.com/Mycellios/mycellios/actions/runs/42261241999),
and the [Windows package/startup qualification](https://github.com/Mycellios/mycellios/actions/runs/42261233374)
passed. The unchanged journal implementation also passed 1,000 concurrent synthetic
Windows admissions in [the isolated probe](https://github.com/Mycellios/mycellios/actions/runs/42257229307).
The public installer and source were downloaded completely and match their hashes;
both catalog and published-release selection offer 0.3.18. Installer SHA-256:
`7fef0fcca53bcb24e883058826d9aff95b31450ecfd21a7a0aeb9fa88e432797`.
Other platform descriptors and previous packages are preserved. Manu's pending
integration PR remains separate from this release.

Qualification did not update the user's existing installed profile, authenticate a
real account, run physical microphone/model inference, validate live OAuth/provider
quota or execute the full suites. A legacy installed updater may still require an
initial official installer before the new native restart control is available.

## Agent workspace reconciliation — source candidate, 2026-11-06

The retained workspace screens are integrated on the current canonical Agent
source: rail/pins, unified Marketplace, routine diagram, workflow canvas, task
inbox, schedule and usage. Existing project conversations, Mico task ownership,
searchable settings, private Apps admission and released Video Studio remain.
Inbox metadata refers to the existing task threads and execution services. Chat
cards retain the paper/stone palette. Production and Desktop qualification is recorded above; the fixture checks below
do not by themselves establish deployment or installation.

Remote Linux qualification passed incremental web/API/worker/Desktop types,
focused tests, web/API builds and an isolated PostgreSQL acceptance: additive
migration, duplicate-start identity, independent tasks, existing task-tab visibility,
archive/send guards, owner/Space isolation and database row-level security.
Real browser controls passed with synthetic RPC fixtures, including workflow
condition saving, stable pin menus, retained task draft, routine canvas, calendar,
usage, Marketplace and help. Desktop and mobile light/dark captures were reviewed.
The browser fixture does not prove full authenticated Shell navigation or real
agent execution. No production database, account or model was used by these checks.

Continuous voice is connected to the owned chat client, existing browser/provider
speech and optional pinned native engines. Real microphone/audio/model inference,
packaged native voice, platform installers, live OAuth/provider quota and full
CI suites are not qualified by this integration. Native release acceptance and
actual publication remain separate gates.

## Apps and private Video Studio — local candidate, 2026-11-05

The owner authorized production availability for the qualified fixed Video Studio.
Its released switch is separate from private-preview admission: unpublished app
bundles remain closed in production, while the built-in retains native account,
Space, PC consent and revision checks. Operator off switches remain available.
The release candidate also retains the concurrent shutdown and isolated-profile
startup-preference repairs. Deployment evidence is distinct from this source state.

The Shell sidebar opens Apps without sending or replacing its chat draft. The
first fixed `mycellios.app/1` bundle is `io.mycellios.video-studio@1.0.0`, admitted
with definition hash `97f5250383f548773a690f72232333c9a324655f6155f165ed3fb499b6b0a293`.
The native driver retains Mycellios account/Space/PC consent and private local
project/media files. Script edits invalidate voice, frames and review; rendering
requires the current revision. Missing tools fail explicitly. Completed script
output is reconciled before resubmission and interrupted work is not replayed.

Local qualification: 71 focused tests and incremental web/Desktop typechecks
pass. Definition/bundle validation passes. Real browser acceptance generated a
six-scene script with the PC's Codex account, six Windows Spanish narrations and
a 720×1280 H264/AAC MP4 lasting 39.691882 seconds (541260 bytes). FFprobe, a full
FFmpeg decode and browser playback passed. A second acceptance used a manually
entered script and checked the corrected desktop width, 390px layout, audio,
video download and project recovery after reload. Synthetic acceptance approval
is not a recorded human artistic/commercial approval. Provider tokens are used
only when actually reported; external provider cost remains unmeasured.

The targeted preview/driver build passes. The private overlay is installed in the
ordinary Windows Desktop 0.3.13, preserving 6991 other packaged files and the host
renderer. The actual account/Space admitted a private test project, generated six
scenes through the PC's Codex session, six narrations and a 37.992698-second
720×1280 H264/AAC MP4 (521842 bytes; SHA-256
`e5dd092d6454739d43e445352824369ddef882b86549cfa69e7158a6608f2fa5`).
Native FFprobe/full-decode validation passed and the installed player advanced.
This was a technical test approval, not human artistic/commercial approval.
The addon browser smoke checks menu/catalog/close and retained draft text against
the preserved host styles. It caught and verified a fix for an unbound development
`process` reference and now asserts that the popup clears the native drag strip,
so its header controls remain reachable. Windows redirected the initial new asset folder into Codex's
private cache; a same-user non-virtualized copy restored the admitted profile path.
The installer now rejects such redirection before replacing the native package.
Local archive, renderer and draft-store backups are retained. The earlier
enterprise-App check used an organization-only endpoint and returned HTTP 404.
Subsequent readback confirms that Mycellios is a personal GitHub account, outside
the enterprise installer, and that the existing Mycellios CLI session already has
repository admin/write access. No new App installation, credential change or
permission expansion is needed. Publication is tracked separately from these
local acceptance results.
Full CI, platform installers, Cloud execution, public catalog/votes, shared project
sync, generated illustrations/music and social publishing were NOT RUN or are
not implemented in this first private version.

Updated: 2026-11-05 (projects and parallel conversations candidate; local verification, no publication).


<!-- Local evidence does not by itself promote a public installer or backend. -->

## Projects with parallel conversations — local candidate

Based on `6420234cb718fa3db56b082cbc5bd8cbe5829562`. The shared Agent sidebar
can group several independent task conversations under an optional project,
using existing Micos. Ordinary chats, model credentials and credit balances are
unchanged. The existing transcript, composer and adjacent review panel are reused.
Project names are owner/Space scoped; repository choices remain native-only.

Native admission prepares one detached Git worktree per conversation, preserving
the source repository and its dirty files. Team Desktop project runs use distinct
conversation lease keys only after proving the owned native binding; each single
conversation retains its execution fence. Shared screen/browser tools are blocked.
Stop and crash cleanup retain the exact project/run destination. Preview startup
keeps its task route and does not reassign the whole Mico to a different computer.

Demonstrated locally: 50 focused tests across 11 files, followed by 21 preview and
auxiliary-preparation tests and 24 worker/native teardown/wakeup tests. Counts
overlap and must not be added together. Real Git worktrees preserve dirty source
files; native command fixtures exercise independent folders and targeted Stop.
The browser fixture passed creation, two conversations on one Mico, draft
separation, ordinary-chat return, light/dark and desktop/mobile overflow checks.
Incremental web/API/Desktop/adapters typechecks passed, including the final
cleanup and preview-route refinements. A deterministic two-process fixture
confirmed targeted Stop while the other process continued, and real worktree
checkout/read passed with a deeply nested tracked file on Windows.

An isolated PostgreSQL fixture passed the actual additive project migration,
concurrent/idempotent thread creation, two accepted task runs, original-chat
preservation, API ownership denial and real non-superuser RLS read/write denial.
The extended per-conversation worker-lease acceptance also passed: distinct
conversations acquire independent leases, a competing run in the same
conversation is refused, and releasing one preserves the other's fence.
The final root architecture check passed. Repository
structure reports a pre-existing canonical-doc mismatch: `docs/images` is tracked
in the base but omitted from the canonical directory list; it was not deleted or
hidden to make this candidate pass.

The subsequent opt-in Electron qualification passed with the real remote
`openai-codex/gpt-6.1-sol` model on 2026-11-05. One Mico's two project conversations
modified `add.mjs` and `tidy.mjs` in distinct native Git worktrees. Both unchanged
Node tests exited 0. Independent test PIDs 40056 and 1640 reached a shared barrier
at 17:49:48.957 UTC, proving simultaneous test execution; this is not a throughput
benchmark. Both model runs completed, with observed provider usage. The source
repository, its uncommitted owner file and the other conversation's implementation
were preserved. The private database passed UTF8 storage and a Unicode round trip.

That qualification exposed and corrected a Windows output-pipe crash and the
ordinary Team `bots/<mico>` path prefix leaking into native project commands/files.
Output disconnection now leaves the durable command outcome unknown without
replaying it. The cold native connection resolves its provider read-only before
checking the exact owned worktree binding. Follow-up focused verification passed
12 command/journal/process tests (one platform-specific case skipped), then 16
path/isolation/admission tests, plus incremental adapters typing and a real native
Desktop bundle build. These counts exclude earlier overlapping suites.

Receipts, model messages, terminal events, separate test process timings and the
Desktop capture are retained under
`outputs/project-conversations-local-20261105/real-desktop-1850/` in the local
development repository. Usage prices there are catalog estimates, not a billed
charge. The model ran remotely through the existing subscription; no model
inference ran on PC-DANI. No production API/database, real customer account or
public installer was used or changed. Native consent was preauthorized only in
the isolated test profile, so its live permission dialog remains outside this
qualification. No commit, push or deployment was performed.

## Mico task and routine isolation candidate

The local candidate adds task tabs to the shared web/PWA/Desktop renderer with
separate RPC scope, caches and drafts. Routine cron, Test, webhook and GitHub paths
allocate owned private conversations by default and preserve explicit targets and
old history. Event fanout retains each routine's model. New routing receipts and
Run identities prevent new routine deliveries from replaying after clearing chat
or changing recipients. Raw webhooks retain their previous deduplication limits.

Focused local tests cover task transport, notifications, routine history and
scheduled/event execution. Incremental web/API/adapters/native-mobile typechecks
passed. `scripts/verify-routine-isolation-db.ts` passed nine real loopback PostgreSQL
checks, including the actual additive migration, concurrent preparation, event
replay, legacy history, timer adoption and RLS owner/Space read/write denial.
Its accounts and prompts are synthetic; no production database or model was used.

Routine screen exclusion is enforced in tool offering and execution, while actual
computer resource leases remain. Private voice calls are disabled until scoped.
Private-task push on the separate native client offers its exact web conversation;
it does not silently load the primary chat. Real phone and installed-app validation
have not run. Native executable discovery and safe provider refusal classification
have focused local tests; missing provider usage remains unknown.

The OpenBot v0.61.0 review covers all 119 supplied changelog entries against main
`dd91e477`. The baseline comparison found 14 present, 55 partial, 17 absent, 21
not applicable and 12 in other work in progress. Those counts do not include this
uncommitted candidate and do not mean complete OpenBot parity. Workflows and live
voice work owned by other agents were preserved. OpenBot's PolyForm Noncommercial
source was read as reference; this candidate contains independent implementations.
No new candidate, migration or installer has been published or deployed.

## Integration profile owner repair — 2026-11-04

A live, read-only diagnostic reproduced `ExternalProxy_UserIdRequired` while
the connection was active: the pinned high-level SDK omitted the acting user on
its profile proxy request. The same exact authorization returned a profile with
username/name when the public API client sent the matching owner. No credentials
or profile values were recorded, no account was reconnected and project owner
verification was retained.

The local repair uses the public client, forwards the server actor's user ID and
exact connection, and disables automatic retries. A regression observes the
actual installed SDK's serialized HTTP request, preserving the existing offline
ownership, cancellation, cache and safe projection checks. The configured-provider wrapper also forwards the new identity operation,
including credential rotation; the previous wrapper omitted it. The 118 affected
offline tests, application types, API/web builds and root
structure/documentation/format/architecture/boundary/type checks pass. A separate
read-only production-record probe confirmed exact ownership and a successful
profile response without recording the identity. An update announcement is
prepared; this repair still requires normal PR integration and release proof
before it is described as deployed.


## Durable Mico work and Windows command recovery - local candidate, 2026-11-04

The integrated `codex/resilient-work-release-20261104` candidate adds persistent parent/child
work, expected results, dependencies, scoped resource reservations and a durable return
to the parent Mico. Existing Micos, models and permissions remain the execution route.
Private delegated work and ownership transfers use separate task conversations; earlier
runs retain their original history. Revisioned pause/resume/reassignment and composer Stop
use a persistent exact-run teardown outbox before replacement work is admitted. Plans
and bounded continuation counters are stored under the active execution fence.

Native commands have stable identities and bounded, redacted receipts. An HTTP observer
disconnect does not relaunch the command. Recorded results can be read after reconnect or
host restart; a crashed host without an exit leaves an unknown outcome, never success.
Windows execution retains owned Job Objects, explicit cancellation and bounded deadlines.
This does not promise process survival through a PC reboot or automatic resolution of
every uncertain external effect. OpenBot d3ec956 is a behavior reference, not imported code.

Local qualification: 518 focused tests in 25 files pass; Prisma generation, incremental
adapter/API/worker typechecks and real API/worker/Desktop bundles pass. Synthetic local
PostgreSQL acceptance applies the additive migration and checks duplicate admission,
dependency/resource contention, missed publication and restart, parent return, scope/fence
refusal, persistent teardown and independent conversations after reassignment. Native
fixtures use real Windows processes, HTTP disconnect, host crash, timeout and exact-run
cancellation. No production database, live model provider, installed-app session or
multi-computer deployment was exercised. Full CI and installer packaging were not run
under the temporary agility policy. This is source qualification, not an installed or
deployed release.

Design: `specs/agent-resilient-work/spec.md`. Reproduce through the shared scheduler with
`src/agent/scripts/verify-resilient-work.ps1`; evidence is in the isolated workspace's
`src/agent/outputs/resilient-work/checks.json` and associated logs.
## Integration account identities — 2026-11-04

Local candidate starts from fetched canonical main
`7337e761ce16ccbf45ee38213092c9dea36c944e`. The selected integration detail
reads an exact owned active authorization's public profile label, separately from
its editable alias. Pending attempts have their own disclosure and cancellation;
individual disconnection preserves other accounts. Missing profile information
is shown as unavailable, never inferred from a generic provider name or another
account. The dialogue fits its content, respects safe viewport insets and uses the
existing thirteen translated catalogs. The update announcement is prepared.

The provider lookup is read-only, bounded and cached per user, Space and exact
authorization. Only public identity labels reach the client. The API re-reads the
owned records after lookup so a concurrent revoke/reconnect cannot resurrect or
mislabel a grant. The additive optional contract needs no database migration.

One hundred ten focused offline tests pass, including provider projection,
ownership, pagination/cache separation, revoke/reconnect races, catalog behavior,
chat cards and update announcements. Web/API/Desktop typechecks and web/API
builds pass. Four browser tests render the actual integration component and
Spanish catalog at 1440/768/390 pixels, covering external-browser authorization,
safe provider errors, separate account identities and pending cancellation.
Screenshots use invented fixture accounts, not production identities. Root
structure, documentation, format, UI-kit, component boundaries, architecture and
TypeScript checks pass. This is local evidence; no live provider authorization,
physical device acceptance, native installer or production deployment is claimed.
Standalone contracts/adapters typechecks additionally report errors in unchanged
test imports, mock types and the adapter rootDir boundary. Those wider checks
are not qualified by this change; the application and adapter-kit checks above
remain separate evidence.

Publication will require both API and web artifacts from the integrated main SHA.


- Agent contribution sidebar (local candidate): missing translated labels are
  present in all thirteen catalogs. An existing unreadable installation offers
  explicit verification; successful verification never starts compute, including
  when another process has already repaired its public descriptor. Retry refreshes
  observations instead of replaying rejected or uncertain commands. Fifty-five
  focused UI/catalog, announcement, native-runtime and account-adapter tests pass;
  web typecheck/build pass. Browser fixtures exercise the production component and
  compiled Spanish catalog without a real account or contribution activity. The
  companion Spanish patch still applies cleanly. The announcement is prepared for
  the next web build; this candidate has not been published.

## Local project preview and integrated release candidate — 2026-11-02

The generic Browser beside a chat now owns project Play/Stop, service profiles,
element selection and editable annotation drafts. First-time configuration uses
an auxiliary project preparation run; its instructions, narration and result do
not become main-chat messages. No Mycellios-specific development shortcut is used.

Installed Windows acceptance exercised Stop → Play twice with the local API,
PostgreSQL and Vite preview at `http://127.0.0.1:5192/app`. Registration, login,
space read/update, sign-out, anonymous rejection and persistence after restart
passed with a fixture account. Stop closed the owned API/readiness/Vite/database
ports and process tree while retaining an unrelated preview. The main chat's ten
user messages and raw sequence 33 were unchanged; the three auxiliary preparation
runs remained separate. Local data and credentials stay outside source control.
This demonstrates local application behavior, not live model/provider inference.

The production candidate integrates current canonical main, the published Apple
Silicon route, and recovered sources verified against the serving coordinator and
Agent bundles. Native PostgreSQL repairs, contribution funding, OAuth fences,
request deadlines, capacity reservations and heartbeat arrival handling are kept.
Native and Agent have separate npm graphs and compiler/release evidence. Focused
local types, native packaging and affected integration cases pass; full-suite,
artifact and deployment evidence must be recorded before calling this release live.


## Historical local Desktop development window — 2026-11-01

An earlier local Windows preview offered General / Advanced / Open development.
It opens a separate sandboxed window with a loopback Vite server, an explicit
development/real-account label and the existing account session for API requests.
No API, worker, database, new host grant or public release is started by this action.
Only UI source updates live; native host changes still require rebuilding/restarting.

Eleven focused cases passed locally (including the subsequently rechecked native
boundary/lifecycle cases), as did scoped incremental types and the stable frontend
build. Real installed checks opened both windows, recovered the account without
another login, closed development and observed its child server stop while stable
remained open. Reopening development worked without restarting stable. An actual
CSS change was then applied/reverted in the installed window through Vite HMR;
the renderer logged a CSS hot update without another document load. Temporary
probe code was removed. The initial stylesheet requires explicit `?direct` delivery
through the credential-free asset proxy. Evidence is under
`src/agent/outputs/desktop-development-20261101`.

This is a local installation only, with recoverable native/frontend predecessors.
The blockers recorded with that earlier checkout are superseded by the integrated
candidate checks above. This historical evidence does not qualify a public release.


## Shared Agent visual qualification — 2026-10-31

Local source corrections bound long select values and menus, prevent shared dialog
headings from overlapping their close controls, fit the sign-in heading on narrow
screens and retain technical computer setup under a closed disclosure. Artifact
cards now respect containers narrower than their preferred minimum.

Actual shared React components were rendered with offline account fixtures across
ten settings/integration surfaces at 360/768/1280 pixels, with additional 320-pixel,
keyboard, expanded-form, chat-card and locale/theme cases. The final browser run
passed 65 checks; 175 affected component tests, incremental TypeScript, the frontend
build and repository structure check passed locally. The source design detector
reported no findings on the changed UI files. Evidence and isolated dependency
mapping are in `src/agent/outputs/visual-audit-20261031`.

These are local Chrome/emulated viewport checks, not physical phone tests or a
live-account/backend qualification. No account mutations, inference, installer
update or production deployment was performed for this visual change.

## Simple Desktop startup and recovery candidate — 2026-10-31

Normal startup opens the existing Mycellios account route directly. A damaged
saved preference no longer opens server setup or starts a local stack. Explicit
valid self-hosted configurations retain their validation and ownership checks.
Connection failure shows a light recovery surface with Retry/Close; server
configuration stays folded under Advanced. Retry is restricted to the native-owned
failed target and does not save configuration, clear cookies or replay tasks.

Sixty affected tests passed locally; three filesystem tests were skipped on
Windows. Focused incremental native TypeScript checking passed after supplying
the actual workspace/dependency paths. Real Windows Electron fixtures qualified
offline recovery, duplicate retry coalescing, recovery after the service returned,
close while offline, preserved test-profile storage across reopening and the
normal first-party login in the same visible window. Local Geist loading was
verified under the recovery page's real CSP. These anonymous fixtures did not
sign into the user's account or perform inference.

The prepared native patch is
`4d9df5e23eb5ded8e2466bbc6fcec1ab1ae68360fd8a1d75853eee874003f23f`.
It changes only the native entry point and four setup assets, adding the
self-hosted font, while retaining the previous package and unrelated files.
After Windows was unlocked, the application was closed normally and this native
patch was applied locally. The real account and Micos returned directly, without
server setup or sign-in, including a second normal close/reopen. The displayed
balance remained 0.954188 Credits with Promo separately identified. Native caption
controls stayed visible. The profile, runtime and public services were preserved;
no inference was requested. This local native patch does not install the later
visual frontend candidate. Receipts are `local-update.json` and
`local-account-verified.json` in the qualification directory. Installer preparation
and its separate qualification receipts are under
`src/agent/outputs/desktop-startup-20261031`. No new installer is published by
this source/local preparation; the earlier public 0.3.9 downloads remain active.

The unsigned Windows 0.3.10 installer is prepared with SHA-256
`55615f70ebcd10b5adbb9bb5185d50d97937f7ad2605a423d8041f10dca9f38b`.
Its actual packaged executable passed the same startup/recovery/reopening cases;
payload checks matched all changed native assets, the pinned 0.2.95 runtime and
the already-qualified shared frontend. Its packaged ASAR is
`091ab23a5b09ffccafafc16a454fe905b56c41523edd393eb058272b18783014`.
This is packaging and packaged-executable proof, not a clean Windows installation,
an upgrade of the user's installation or a new Linux/macOS qualification.
Repository structure verification passed. No commit, push or publication occurred.

## Unified Agent typography — 2026-10-31

Agent body text, display headings, wordmarks, startup and first-party account
forms now share self-hosted Geist Variable. The login's Georgia shorthand and
the Agent's Fraunces/Georgia display override were removed. Registration and
sign-in retain their existing authentication JavaScript byte for byte; the
central login changes only its content-addressed stylesheet reference. Its CSP
adds same-origin fonts, retaining all other restrictions.

Frontend build `20261031130004`, immutable patch
`8484f35664205f67588fd3c4c65aab44ad9d67748aad3cc622ce56274d3a9a4f`,
was qualified against fetched main `1a45f32d6deb5149fb8f7490c918b8285a622d4b`
and the prior qualified source. Source snapshot SHA-256 is
`a2c18da382ce48fd011db1140480c1c59b5ebe0dbade93a5eb75b8cdc4574dd5`.
Twenty-three affected identity tests, scoped incremental types and the complete
frontend build passed locally. Isolated browser fixtures verified the actual
custom font used by Chromium, registration/sign-in switching and no overflow at
320, 390, 768 and 1440 pixels. Initial fixture failures involved its manifest,
deployment base and asset policy; they were corrected before qualification.

Private Nginx and public HTTPS checks verified immutable HTML/assets, font hashes,
unchanged identity JavaScript, retained legacy assets and PWA scope. The public
login was also visually inspected. API, workers, database, financial records and
model services were not replaced, restarted or invoked.

The local Windows native artifact remains
`1e4f0559a2fdc822e2913c4877817b5ebfa2afb9eaa7510050bdca8f1ac709bf`.
Its compact transparent caption overlay replaces the earlier full-width strip;
the shared frontend reserves space beside the sidebar actions. The real profile
initially failed startup with its local-renderer override enabled. Archiving
only that preference and using the identical published frontend allowed Desktop
to reopen its existing account, Micos and **0.954188 Credits** with separate Promo,
without a credential prompt. The local override remains disabled; its successful
anonymous loading probe is not proof of authenticated OAuth compatibility.
Public native installers were not replaced. Receipts and screenshots are under
`src/agent/outputs/typography-consistency-20261031`.

## Persistent Desktop control strip — 2026-10-31

The initially qualified local Windows Desktop 0.3.9 application used the requested red/yellow/green
controls without the Windows title bar. A sandboxed local WebContentsView owns
the strip independently of the navigable Agent/login page, with a separate
32-pixel layout area. Its IPC accepts only its own local main frame and the
three caption actions; no account, project, shell or runtime capabilities are
exposed by that view. Existing macOS traffic lights are retained by source.

Thirty-two focused tests and scoped incremental TypeScript passed. A real Windows
fixture qualified navigation, page DOM replacement, resizing, minimize,
maximize/restore and close. The installed executable then passed minimize,
maximize/restore and close on the actual first-party HTTPS login in a separate
anonymous profile. The initial test harness expected an intermediate login
button; it was corrected to accept the existing direct same-window OAuth route.
No product authentication behavior changed.

The regular real-account profile reopened without another credential prompt and
visibly retained its Micos and **0.954188 Credits** with separate Promo. No new
account sign-in was performed in the anonymous test profile. The runtime, user
profile and public services were not modified. That initial native artifact was
`e028a6ec1b1af3f78842bb1ea17da8a21e95b674af0c26ab82cb985e79724be6`;
5,616 existing package files are preserved, with one native entry-point change
and four new local strip assets. The public Windows/Linux installers remain
unchanged. Receipts and the native-window login screenshot are under
`src/agent/outputs/persistent-chrome-20261031`.

## Agent balance recovery and window controls — 2026-10-31

Production frontend build `20261031122612`, immutable patch
`8a495031a359a5eca67c4ecdcd1ad876b76766a725468887ef44dee40c3b8a5e`,
supersedes the terminology build below. Fetched main remained
`1a45f32d6deb5149fb8f7490c918b8285a622d4b`; the exact published source snapshot
is `7cc014f0b33e3e9f4cc9c8609a08b6533f81fe46a97d907dd2d26628aa30dea7`.
No commit, push, backend update or financial mutation occurred.

Credit reads now retry transient failures serially, retain an explicitly stale
last verified amount only for the same owner, and clear it on access/identity
changes or authoritative null. Local focused checks, scoped incremental types,
the full frontend build and responsive initial-failure-recovery fixtures passed.
Full-Shell transitive type errors were independently reproduced in the previous
published source and remain recorded, not claimed passing. Private Nginx and
public HTTPS checks verified exact application bytes, translated catalogs,
PWA scope, retained legacy assets, downloads and AntSeed authorization boundaries.
The API, workers, database and model services were not replaced or restarted.

The central login and Agent wordmark now display **Mycellios**. Login promotion
changes exactly the compiled brand text and its content-addressed asset reference;
authentication behavior and the existing assets are retained.

The real signed-in account recovered and displayed **0.954188 Credits**, with
separate Promo, in browser and installed Windows Desktop observations before this
frontend promotion. Post-promotion public bytes were checked; a fresh interactive
account check was not completed because computer control was stopped.

The initial Windows/Linux fallback retained native window frames across login
navigation and renderer failures; the custom strip above supersedes it. That
narrow local Windows 0.3.9 update changed only native window
options and its preload capability, retaining 5,615 other packaged files, profile
and runtime. Native caption controls and the existing account were visibly observed.
The final native close-click check was interrupted; it is not reported passing.
The public 0.3.9 installers have **not** been replaced with this native fix.

Receipts are under `src/agent/outputs/credit-balance-recovery-20261031` and
`src/agent/outputs/native-chrome-20261031`.

## Agent terminology publication — 2026-10-31

Production Agent build `20261031115929` uses Credits (Créditos in Spanish) for
the internal balance and Mico/Micos for user agents. Spore names the separate
official token; this release does not activate the token or change balances.
The paid-credit conversion remains 10 USD = 10 Credits, with integer micro-unit
precision and promotional attribution retained. There were no financial writes,
schema migrations, model calls or saved-history changes in this publication.

The immutable frontend patch is
`651ab5019b216f41ed2d0c832c4df68869c57467e19d8456141849bde3f38c7d`,
qualified against fetched main `1a45f32d6deb5149fb8f7490c918b8285a622d4b`
and the exact published frontend source. Sixty affected tests, scoped incremental
types, a local build, English/Spanish responsive fixtures and eight route-safety
tests passed. Private Nginx qualification and public HTTPS checks verified the
new HTML/assets, translated catalogs, legacy asset delivery, PWA scope, Desktop
downloads and unchanged AntSeed authorization requirements. The existing
Cloudflare analytics injection is retained.

Docker was unresponsive under host I/O pressure. The publication therefore uses
immutable files in the existing read-only frontend mount and a gracefully reloaded
Nginx configuration; the API, workers, database, old web service and model services
were not replaced or restarted. The active Nginx configuration and release receipt,
not the old web container label alone, identify the served frontend revision.

A real signed-in browser verified Créditos, Nuevo Mico and the Desktop link.
The account lookup currently returns unavailable, so the sidebar shows an em dash.
The numeric production balance was **not** reverified; no zero or cached amount
was substituted. Receipts and screenshots are under
`src/agent/outputs/credits-micos-release-20261031`.

## Desktop preview publication — 2026-10-31

Mycellios Desktop 0.3.9 is published for Windows x64 (EXE) and Debian/Ubuntu
x64 (DEB) at https://www.mycellios.com/downloads/desktop, with the bundled
runtime 0.2.95. The separate headless runtime catalog and platform downloads
remain unchanged. macOS Desktop is deferred. Preview upgrades are manual;
unsigned automatic updates are disabled.

The public files match the qualified installers. Windows clean installation
and removal were exercised in Windows Sandbox; the 0.3.8-to-0.3.9 upgrade
retained its profile and project fixture. Reinstalling the public 0.3.9 EXE
also retained the existing real account, preferences and native identity;
reloading and restarting Desktop required no new login. Linux install,
reinstall, removal and profile retention passed in an isolated Debian
container, with a later packaged GUI/session test using Xvfb and an isolated
identity fixture. This is not physical Linux GPU or production-account
sign-in evidence.

Publication identity:
`8cf6e5ab48eae736dace45d69e497038926c77c48e5430b3fc8fe17ba514a16d`.
The source archive records the canonical repository, source inputs and native
bundle reproduction against main `1a45f32d6deb5149fb8f7490c918b8285a622d4b`.
Local campaign receipts are under `outputs/desktop-publication-20261031`;
earlier installer and platform receipts are under
`src/agent/outputs/desktop-linux-20261030` and
`src/agent/outputs/desktop-platforms-20261031`.

Publication adds a read-only download service and narrowly scoped ingress
routes. Coordinator, Agent API/worker/frontend, AntSeed and GPU reservations
kept their running images and start times. PC-DANI ran no inference.

The subsequent download-page simplification uses publication
`3c8264913b971d1b3fe0e5719084fab6cbb811bc68923c119b1214d5f44f2b0d`,
with the same installer hashes and additive source/asset URLs. Local desktop,
320/390-pixel mobile, keyboard disclosure and error-retry checks passed;
receipts live under `outputs/desktop-downloads-simple-20261031`.

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

- Intel x64 and Apple Silicon arm64 Desktop 0.3.9 previews for macOS 13 or newer
  are published at [Desktop downloads](https://www.mycellios.com/downloads/desktop).
  The [native qualification](https://github.com/Mycellios/mycellios/actions/runs/41481786116)
  passes on both architectures: two launches, central sign-in UI, renderer
  isolation and strict deep signature verification inside the final read-only DMG.
  Native/source candidate: `553948e3bb169d041fb0e1ddd08b499e2a78b390`;
  download revision: `desktop-macs-3b26d8ddb81345db`, based on main
  `2e7e9205438ccf53e4bcc990afc7ae920b587c73`. Previous platform artifacts and
  Windows 0.3.10 remain available; no account service or database was replaced.
  Ad-hoc signatures establish integrity only: no Developer ID or notarization,
  manual first-open approval and updates. Browser-download acceptance and real
  account use on the owner's physical Mac remain unverified. Only Apple Silicon
  includes the existing 0.2.95 contribution runtime, installed in CI without
  enrolling an account. Intel contribution and physical Mac inference are not
  qualified. The default two-package catalog remains byte-identical; the legacy
  ARM opt-in and new all-Mac opt-in contain three and four packages respectively.
  Complete public HTTPS downloads of both DMGs and their corresponding source
  match the published SHA-256 values. The actual public page passes browser checks
  at 1280, 390 and 320 pixels, with folded installation details and all five
  platform links available.
- Fedora Desktop packaging has focused RPM integrity/dependency tests and
  isolated user-namespace tests of runtime extraction, enrollment invocation,
  hash rejection and preservation of existing installations. These tests use
  synthetic enrollment payloads; they do not establish real account enrollment
  or multi-host inference. See the Fedora build route in `DEVELOPMENT.md`.
- Fedora RPM revision 2 has isolated ASAR retention tests and window-option
  tests covering Linux native frames, packaged window icons and preservation
  of Windows/macOS options. These tests do not replace visual validation in
  a real desktop session after restarting the application.
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

Physical qualification and experimental serving rollout, 23 October 2026.
**A complete 256-token AntSeed streaming buyer request is verified at zero model
price.** The independently enrolled decision cell is online after repairing
executor availability, health compatibility and local HTTP deadline handling.
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

The 22 October 256-token buyer attempt failed: OmniRoute retried after an executor
availability error, then a physical contributor's heartbeat expired. No complete
256-token buyer result was claimed for that attempt. The native process remained alive; memory and
owner preflight later passed on all three hosts. The HP's existing nonblocking
hardware sampler and other installed native overlays were preserved.
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
failure. That changed source was physically qualified before serving on 23 October.

A stale, zero-token API reservation for an already failed job was reconciled
with the normal failure-settlement method, without changing balances or limits.
The seller replacement also produced a recorded embedding connection-refused
request; this was not a zero-downtime rollout. A later interactive embedding
query returned a valid vector and `served_free=1`. These observations do not
establish global interactive latency or long-term stability.

The full-context streaming buyer gate is closed by the 23 October evidence below.
Larger contexts, GPU execution and general task quality require separate qualification.

On 23 October, two more zero-token embedding reservations survived coordinator
restart after their jobs had already failed. They were settled with the existing
failure-accounting method under transaction locks, preserving balances, counters,
limits and jobs. A subsequent provider receipt returned HTTP 200 and
`served_free=1`; the caller had already exhausted its deadline while waiting for
admission, so this is provider recovery only. Startup recovery now has a narrowly
scoped candidate that settles such terminal zero-token usage before admission;
its deployment and full caller recovery require separate verification.

### Verified free AntSeed streaming buyer, 23 October 2026

The repaired native source
`ed0c9874176ef1dacf18b17d773e8ac71b91306c9bffc97e89491397b253ba3f`
passed a fresh 256-token private physical run in **329.27 s**, with all 16 logits
bit-identical to the prior whole-model-qualified reference. Its three distinct
physical contributors execute layers 0..7, 8..19 and 20..31/head over pinned TLS
through the Internet VPN route. PC-DANI executes no model inference.

A subsequent real buyer request through the AntSeed gateway, seller and
authenticated Mycellios API completed in **378.03 s** (**376.51 s native wall
time**). The successful final SSE decision and usage arrived with `[DONE]`;
the coordinator recorded completion and the gateway recorded HTTP 200,
**256 input tokens, zero output tokens and `served_free=1`**. The complete
envelope matches the pinned fixture, and all 16 native logits match the qualified
reference. Public, sanitized evidence is in
[`jev-public-buyer-evidence.json`](../tests/fixtures/jev-public-buyer-evidence.json).
This buyer used the existing gateway credential and explicit provider selector,
without OmniRoute's retry engine or automatic model retries.

The preceding non-streaming full-context attempt timed out at AntSeed's 300-second
initial-response deadline and cancelled the job. Long decisions therefore use the
existing SSE admission/heartbeat route; HTTP 200 or an early event alone is not
success. The bounded local HTTP adapter retains the nine-minute absolute native
lease, cancellation, no redirects and response-byte limits. Shared buyer/provider
timeouts, owner/resource limits and concurrency were not increased.

The native artifact is source-bound to commit `1f30878ccc1477488b4e167ceff3ca3ccba84d2b`;
the active worker adapter component is `e028e093b55eb2039614cc5a5016c9a53d4aea0e`
(artifact SHA-256 `5f23a2b5696873556a1da277e98ba2694bfa88d16138f7bbc0716ee3301877cb`).
Only the decision adapter and its map changed in the existing worker package;
the independent cell identity, permanent credentials, embedding repair and all
other worker modules were preserved. The coordinator's existing PostgreSQL,
capacity and heartbeat overlays and the seller's other providers/prices were
preserved. Kokoro and the GPU embedding engine were not restarted for this rollout.

These are individual experimental CPU observations, not a latency SLA, a measured
speedup, GPU qualification or a general decision-quality benchmark. Non-streaming
delivery at the 256-token boundary is not qualified. The pilot remains one
question, 256 input tokens, batch/concurrency one, and produces decisions rather
than generated prose.


### Windows Desktop caption publication (2026-10-31)

Preview 0.3.9 has a distinct `windows-x64-caption-fix.exe` installer in the
public Desktop catalog. SHA-256: `b138908982d036a9cf5cb566805304f257e6ce2a20cca82889988ffedc8ed02e`.
The extracted archive equals the visually qualified native package. Twenty-one
affected tests and scoped incremental types passed; a same-profile reinstall
retained three profile files and the bundled runtime, reopening the saved account
in one window without another login. Full public download and HTTP range 206
passed. This is not clean-OS or new inference evidence.

The immutable downloads artifact is `9e5e54a6c316200b476e6227abc835dc6b7c1c316032cc041f45a906f62ebee6`;
canonical main reviewed immediately before publication was
`2e7e9205438ccf53e4bcc990afc7ae920b587c73`. The runtime/API/worker were not
redeployed. The current download page, Linux/Fedora packages, headless catalog
and prior release URLs were preserved. Corresponding source includes the editable
Desktop sources and exact scoped compiled backport. Updates remain manual while
unsigned. Source changes remain uncommitted; this is an artifact backport, not a
merge of the integration checkout into main.

### Managed Desktop development copy (2026-11-01)

Development now prepares a private source copy and isolated npm tooling in the
device's local application data, preserving edits across reopening and stable
upgrades. The native bridge mounts that copy for individual development-chat
file tools and command working directories; model instructions do not choose its
root. The development window retains the owning stable account and Space while
Vite assets stay credential-free. There is no manual folder linking or database
project registration. Another PC starts its own copy.

Focused component and relay tests, incremental types, native/web builds and
Windows/Linux resource configuration passed locally. A real cold preparation
and CSS HMR check passed against the independent copy and dependencies; the
temporary edit was reverted. The final native bundle also passes node --check,
which now runs during build after an installed launch exposed a declaration
collision not detected by component tests.

The native candidate was installed locally with the original stable frontend
preserved, and the existing real-account chat reopened. Opening development
reaches the native computer-consent dialog; two-window acceptance of this
managed-copy revision remains pending the user's response. No agent work was
submitted for verification. This is not physical second-PC or clean-OS evidence.
Individual development chats are covered; group/scheduled execution and native
or backend hot reload are not qualified. No public installer, repository remote,
API/worker service or database was changed by this local activation.

After the user confirmed consent, a later launch used a connected web UI without
the settings launch button. A native File / Open development command and
Ctrl+Shift+D now provide entry independently of web release, through the same
permission/admission handlers. Eight affected tests, incremental types and the
final native bundle build/syntax check passed. This revision was installed and
the app reopened; Windows automation failed while selecting the new window, so
installed two-window acceptance still requires manual observation of the shortcut.

The missing settings button was subsequently traced to Windows package filesystem
virtualization: an ordinary same-user process saw no local renderer preference,
while the packaged tooling saw its virtualized copy. The native archive was
identical in both contexts. The previously qualified web artifact was installed
and activated in the ordinary Desktop profile, with no account/session files
copied. A separate ordinary process confirmed the preference and bundled source/npm
resources. The running window must restart to load it; visual installed acceptance
remains pending that restart. This replaces the remote stable frontend locally;
the earlier byte-preservation result applies to the native-only installation step.

### General project browser beside chat (2026-11-01)

The new local candidate supersedes the managed development launcher above. The
existing review panel opens HTTP(S) project URLs beside any chat, with tabs,
navigation and element selection. A comment, selector and cropped capture enter
the editable composer; the user still sends the message. Attachment refusal keeps
the selection and comment available for retry. The development settings action,
File menu launcher and Ctrl+Shift+D are removed from the active native/UI flow;
ordinary project selection and existing development copies are preserved.

Desktop pages run in sandboxed native views with separate ephemeral sessions,
without the application bridge or account cookies. Admission and capture are
bound to the owning account/chat/Space and navigation generation. Native pages
hide below application dialogs. Selection consumes its click; cross-origin frames
are selected as containers. The browser does not start project servers or grant
file access. Existing project servers retain their own hot reload. The web-only
iframe fallback still requires frameable, cooperating pages.

Eighty-three focused browser, inspector, session, preload, panel, attachment,
composer and concurrent language-entry tests passed locally, alongside scoped
incremental types, scoped Biome checks,
native build/syntax verification and a production web build. A real Electron
fixture verified isolated navigation, trusted selection and capture, no iframe
click-through, cookie-refresh continuity, stale-capture rejection, chat isolation
and Vite CSS hot reload without replacing the document. A separate fixture using
the actual React components verified selection into an editable unsent draft and
layouts at 1440 and 390 pixels. These fixtures use no real account or model calls.
The finish review's four behavioral findings were corrected and requalified.

The native candidate preserves the separately installed relay-recovery repair:
its source hash matches the repair's qualification, and the compiled relay class
differs only by audited bundler identifier renaming. Eighteen relay/host tests in
four suites passed again. The structure gate passes; the broad architecture gate
still reports pre-existing Agent integration dependency cycles and oversized
modules. No public release or backend/worker deployment was performed. The browser
candidate was subsequently installed locally; the saved real-account chat reopened
and the Browser panel was opened beside it, with its close control below Windows
caption controls. No agent message or real-account annotation was submitted.
Selection/capture/HMR evidence remains the anonymous fixture evidence above.

A concurrent setup-recovery repair then composed only dist/setup.css, setup.html
and setup.js over the installed browser artifact. Independent comparison confirms
the browser main/preload/inspector are preserved byte for byte and the legacy
development shortcut remains absent. The resulting native archive digest is
`20f02718df5d1f0aa420a85e6777b0392e027f8a94eb9140608c1f9c480df8b0`.
That task's later restart initially returned to connection recovery; a subsequent
ordinary launch recovered the real-account chat again with Open browser present.
This local observation does not establish long-term connection reliability.

### Native project entry visibility (2026-11-01)

A local follow-up found a running native executor but no consent in the ordinary
Desktop profile; the packaged tools' virtualized profile is separate evidence.
The project availability probe also hid its entry after any remote identity
failure. Availability now advertises the configured main frame and initialized
native host, while access/connect keep their original identity and consent checks.
The real Mycellios profile now shows Use this computer and Project and preview.
The Mycellios agent was subsequently connected through the native access flow,
with matching consent, and its native folder picker assigned the canonical
mycellios-agent-canonical-20261029 checkout. On 2 November, the running native host
confirmed that exact project environment and read project/package.json for this
agent. The recorded check made no project-file modification or model request.

The frontend preview at http://localhost:5191/app is running and open beside that
chat. Anonymous browser verification rendered the page without JavaScript errors
and received Vite's HMR connected frame. It forwards API requests to the existing
https://www.mycellios.com/agent service; no local workers or database connection
were started. Its isolated browser session shows language setup. Preview account
authentication and a model-generated edit remain unverified; no concrete frontend
change was supplied by the user yet.

Nineteen affected tests, scoped incremental types, native build and syntax check
passed locally. Only the availability handler in installed dist/main.js changed;
browser, caption, recovery and relay repairs were preserved. Native digest:
`73e26f2e78a8a5dcf59212e366f8b24396494771e6caa8b9d0dd53ac3fc64cba`.
No production service, public package or agent message was changed or submitted.

### Automatic native workspace acceptance (2026-11-02)

After a subsequent Desktop restart and renewed user consent, the optional folder
picker was cancelled. The connected Mycellios agent's native environment had no
selected project. The existing native transport provisioned its persistent
per-agent directory, executed a command there, then executed a read-only package
check in the explicitly requested canonical checkout via cwd. Both commands
returned exit code zero and the project package name was mycellios. This proves
that manual folder selection is unnecessary for native command work. The check
made no model request and changed no project file; it does not establish a
model-generated edit. The local browser preview was reopened beside the chat.
The final scheduled automatic-workspace and anonymous frontend/HMR checks both
passed after the restart. Browser account authentication remains unverified.

### Project service Play/Stop (2026-11-02)

The local candidate adds Run/Stop, named service profiles and folded logs to the
existing Browser panel. First Play submits an idempotent preparation request to
the current owned agent after native consent/connection; subsequent Play reuses
portable .mycellios/run.json. The absolute binding stays in native machine-local
storage. The native manager owns foreground process trees, validates dependency
order and loopback readiness, cancels pending auto-start and opens ready URLs in
the adjacent browser. It does not own daemon/container/system-service lifecycles.

Twenty-two focused tests, scoped incremental types, scoped lint, web/native build
checks and the root structure/UI-kit gates passed locally. Real Windows processes
verified three-service ordering, partial failure, cancellation and preservation
of an unrelated listener. Anonymous real Electron acceptance verified scoped IPC,
an isolated embedded page with no app bridge and revocation cleanup. Actual React
controls passed desktop/390px checks with one fixture preparation reused across
profiles. These are fixture results, not a real model-generated configuration.
The broad architecture gate retains existing integration cycles and oversized
modules; it was not waived. Local installation is recorded separately; no public
release, API/worker deployment, commit or push was performed.

The qualified candidate was subsequently installed locally, preserving every
other native archive member and the previous recovery/browser/caption repairs.
The app reopened with its authenticated session, and Run/Stop/log controls were
visibly confirmed in the Mycellios chat's Browser panel. Installed native digest:
`a860eb354a86617d7b0190630c953348abcda29e9daeb8e1fa5f7d82f802d15d`.
The real-account Play action and model-generated preparation remain unexercised.


### Quiet Browser preparation candidate (2026-11-02)

The user's real Play screenshot exposed the legacy synthetic setup prompt in the
main conversation. The new local candidate creates an idempotent auxiliary
`project_prepare` task on the same agent/computer/thread without a user message or
chat steering. Existing background classification suppresses narration, progress,
normal transcript/history text and sidebar activity. The Browser keeps compact
preparation state and folded bounded final details. Necessary user-input cards
retain their existing explicit approval flow.

The API resolves ownership before creation/status/cancel. Stop cancels the exact
owned preparation and its fenced computer work, preserving unrelated runs and
steering. Native service lifecycle and internal preview navigation are preserved.
A failed cancellation remains retryable. The worker retains setup results for
Browser details without giving ticket-board instructions. No new Mico, provider,
folder picker, synthetic chat message or database migration is introduced.

Local evidence under src/agent/outputs/project-preparation-quiet-20261102 includes
146 distinct passing tests across focused reports, incremental API/executor/web
types, scoped lint, canonical API/worker bundle syntax checks, a production web
build with unchanged source manifest and actual React/Chromium desktop/390px
screenshots. The main-chat DOM stays unchanged during success, failure and Stop;
details stay folded, the preview stays embedded and no external popup opens.
The model response and native bridge are fixtures, not real-account execution.
Root structure/UI-kit gates pass; prior broad architecture failures are not waived.
One invalid CP1252 dash in another local change's main.tsx comment was converted
to UTF-8 without changing any other byte; the original and hashes are preserved.

Activation remains pending under the user's local-only/no-deploy instruction.
Worker trigger support must precede the API procedures and client update. No
production service, installed app, historical message, Git commit, push or merge
was changed by this candidate. The earlier installed Play/Stop build is unchanged.


### Native agent project workflow (2026-11-02)

- Qualified on the installed Windows Desktop with the actual Jarvis agent: local
  discovery, existing SSH configuration, service/mount identification of a live
  checkout, exclusive temporary-file creation/read/modification/removal observed
  from host and serving container. Final command/SSH exits were 0. HEAD, Git status
  and staged/unstaged diff hashes were unchanged; no functional code or services
  were modified. This does not qualify a functional Jarvis feature release.
- After Desktop relaunch, a second actual agent execution read private PROJECT.md
  and reused its verified destination without repeating discovery; HEAD and marker
  absence checks passed in host/container with exit 0. Project notes contain no
  credentials. Native admission adds the standing workflow through conflict-checked
  bot instruction updates, preserving existing owner instructions.
- Local checks: 31 affected web tests (native-computer-execution,
  native-computer-workspace, rpc); focused incremental typecheck against the current
  local contracts. The installed frontend preserves the preceding renderer assets
  and native package. Hosted web/backend promotion is separate from this PC update.


### Compact native activity and initial project admission (2026-11-02)

- Installed Windows status keeps health and elapsed time visible, with technical
  activity inside a closed disclosure. Qualified at narrow/wide widths in both
  themes with the actual installed component and explicit synthetic state.
- Initial assignment preserves an automatic introduction awaiting its first answer
  on an unused placeholder. User work, active introductions, provisioned computers
  and control/execution leases retain the existing blocking rules. The real local
  API fixture covers both admission and protected cases in the current Linux image.
- 29 affected tests and focused incremental typing passed locally. The actual
  previously blocked new agent received its dedicated workspace and completed the
  user's pending message without cancelling its introduction or losing the draft.
- API promotion preserved the current concurrent runtime modules, image, credentials
  and mounts, retaining the prior container for rollback. No schema migration or
  worker replacement. Hosted web frontend promotion is separate from the installed
  Desktop renderer update.


### Remembered native account permission (2026-11-02)

- Installed Windows Desktop persists account/server consent independently of
  sessions, Spaces and transport tokens. Restoration revalidates identity;
  revocation clears local and account grants and blocks stale permission records.
- Physical restart qualification called the real native computer.requestAccess
  bridge: allowed=true without a dialog. No conversation or command was replayed.
- 16 local tests and five installed-handler scenarios passed, with focused
  incremental typing. Three unrelated opt-in checks remained skipped. The native
  archive preserves 5627 other file contents and unpack flags, with a rollback
  archive retained. No hosted server or public installer was changed.

### Quiet Browser preparation activated and checked (2026-11-02)

- Following explicit authorization, deployed worker support before API creation,
  then installed the Desktop renderer. Synced origin/main was
  `2e7e9205438ccf53e4bcc990afc7ae920b587c73`; immutable server release
  `177faff1a17839f81d788fe1393043874bda704be16fd21dcf2e17485e7cf33a`
  preserves the verified live engine/task/skill changes. No schema migration,
  push, merge or public installer release. Hosted frontend assets are unchanged.
- Exact release passed 134 focused backend tests plus one selected actual
  executor fixture, incremental typing and local Linux smoke with the production
  images. Client qualification includes actual Chromium desktop/390px controls,
  a guarded production build and the initial native-connect polling regression.
- Installed acceptance exposed a concurrent native repair that removed the host
  wrapper workspace accessor. Repaired only that forwarding entry over the exact
  current archive; all other files and the active renderer were preserved.
  Ten real host tests and the exact packaged wrapper reproduction/repair passed.
  Current native digest is
  `501d8396b9e6fda02d12e074608282a88e7508315cef701b75ac55effd7a4858`;
  renderer build `20261102083521` retains concurrent activity/timer improvements.
- Actual Play created and completed `cmvz0o3e9000f01pihs3ujord` as
  `project_prepare`, with no source message. User messages remained 10. Its
  retained result is visible only in Browser details; the main chat received no
  new technical prompt, narration or final response. The prior historical prompt
  remains. Sidebar preview text stayed conversational; its timestamp advanced.
- This checkout still cannot start: incompatible linked dependencies fail Vite's
  `@rakazo/core/screen-reconnect` resolution. The agent correctly left configuration
  unprepared and reported the reason in folded Browser logs. This is a verified
  quiet preparation flow, not a claim of service readiness. Stable app remains
  open; no unrelated listeners were stopped and no external browser was opened.
- Evidence: `src/agent/outputs/project-preparation-quiet-20261102/QUALIFICATION.md`,
  `deployment.json`, `native-workspace-proof.json`, `native-workspace-installed.json`,
  `play-after-native-fix.json` and `play-completed-quiet.json`.

### Local Browser service startup and stop qualified (2026-11-02)

- Replaced this Agent checkout's dependency junctions to a sibling with its own
  npm installation and the verified package lock, preserving the former links
  for recovery. Vite resolves first-party sources in this canonical checkout.
- Real acceptance exposed lost Play intent on transient status timeouts and a
  process-global Koffi type collision across native bundles. Pending intent now
  survives transient observation failures; Stop/revocation still cancel it.
  Anonymous Job structures preserve independent Windows process ownership.
  Startup cleanup now preserves the original refusal before killing children.
  Identity reads retry one timeout only; commands and access refusals never retry.
- Twelve affected React tests, nine actual desktop-relay tests, the startup
  error regression and the independent Windows process-tree regression pass
  locally. Incremental typing and the guarded client production build pass.
  Exact packaged class/Job checks and archive file comparisons qualify the
  installed repair. This does not claim the broad integration suites passed.
- Final local native archive SHA256 is
  `588ab77101b576f1797e7bc7d4653c663383edd998afed31b053e9206d49a772`;
  renderer build `20261102093850`. Normal app restart activated both. In that
  exact installed app, actual Play -> Stop -> Play opened
  `http://127.0.0.1:5192/app` in the native lateral Browser. App and HMR client
  returned HTTP 200; Stop closed their port and preserved a separate existing
  preview. Main-chat user count stayed 10 and raw sequence stayed 33, with no
  new preparation run when reusing configuration. Old chat history was retained.
- Automatic preparation produced a frontend-only profile; local API :3100 is
  still absent. The language screen renders, while data/auth/bootstrap requests
  cannot complete. This verifies the service controls and frontend preview,
  not a complete local backend. Stable app and preview remain open. No public
  deployment, push, merge or installer publication in this follow-up.
- Evidence: `src/agent/outputs/project-dependencies-play-20261102/QUALIFICATION.md`
  and `installed-acceptance.json`, with the recorded native hashes and real
  start/stop HTTP observations.

### Local API, accounts and persistent data in Browser preview (2026-11-02)

- The canonical source now exposes `npm run dev:local:backend` and
  `npm run dev:local:web`. The Browser profile starts the existing embedded
  PostgreSQL/API plus a local Graphile worker, waits for database-backed API
  readiness and a fresh worker heartbeat, then starts Vite. No Docker service
  or detached process is required. Two owned service trees contain all four
  components; source backend changes reload with Stop/Play and frontend changes
  retain Vite hot reload.
- State, random keys and accounts persist in ignored `data/project-preview`.
  Minimal environment construction and explicit dotenv isolation prevent
  inherited production database, SSO, telemetry and model credentials. Auth uses
  the normal local password endpoints, runtime database roles, row security,
  encryption and PostgreSQL realtime. No login bypass or stable-session copy.
- Nine affected local tests, Prisma generation and scoped incremental typing
  passed through the shared scheduler. Real HTTP testing through Vite verified
  local registration/login, authenticated bootstrap, Space creation/rename/read,
  sign-out and anonymous 401. The first request sequence timed out under PC load
  after creating its account/data; subsequent before/after-restart sequences
  passed. No broad integration-suite or live-model qualification is claimed.
- Actual installed Stop closed API/readiness/Vite/PostgreSQL ports and terminated
  all 22 recorded owned PostgreSQL process IDs, preserving the separate prior
  preview and saved state. Play restarted the final heartbeat-based source
  backend; the same account logged in and read the same saved Space afterward.
  Native Browser showed 2/2 services and the normal local sign-in/registration
  screen at `http://127.0.0.1:5192/sign-in`. Passwords were not entered through
  Computer Use. The user can register their own local account there.
- Stable main-chat count stayed 10 user messages and sequence stayed 33, with
  no new preparation or chat message. Stable app and local preview remain open.
  Installed native archive remains
  `588ab77101b576f1797e7bc7d4653c663383edd998afed31b053e9206d49a772`.
  No push, merge, hosted deployment or installer update in this follow-up.
- Evidence: `src/agent/outputs/project-fullstack-20261102/QUALIFICATION.md`,
  `acceptance.json`, `actual-stop.json`, `auth-data-after-restart.json`,
  `unit-tests.json` and `source-hashes.json`.

### Desktop update continuity prepared (2026-11-02)

- Canonical local Desktop source is prepared as 0.3.10, including remembered account/server permission, generic PC/project admission, compact activity and the earlier native-engine/task/skill capabilities. Existing retry, model/contribution behavior and the newer Browser/runner are retained.
- Packaged official /agent UI is selected after an older profile override expires, with root assets kept separately for managed local mode. Authentication/API traffic retains its existing origin/session. Ordinary and unified packaging reject missing or stale native/web/local-backend receipts.
- 328 focused cases and 5 packaging cases pass, with scoped incremental typing and native/backend/both web builds. The actual compiled backend boots against temporary PostgreSQL, returns health/session HTTP 200 and shuts down cleanly. Upgrade fixtures retain permission and private project notes.
- Structure verification passes. The general imported-Agent architecture gate remains failing (10 cycle groups, 25 module-size findings); no public installer, main integration, commit or deployment is claimed. Physical OS upgrade and authenticated native-provider inference are not covered by this task's fixtures.
- Evidence: src/agent/outputs/update-continuity-20261102/QUALIFICATION.md and verification.json. Qualified source digest: 64f9111bb8a537e0bdecc744b1a83f43e47532f7f3708c027e55bbfc3e9f7688.

### Native replica availability and evidence (2026-10-26)

The deployed coordinator preserves its existing PostgreSQL, authentication and
credit-wallet overlays. Bounded worker observations prevent stalled health or
hardware probes from blocking heartbeats; missing readiness stops new admission.
An operator-only native qualification uses three normal leased executions and
binds their signed receipts to the current authenticated session, source build,
model digest, activation and physical GPU node. It preserves zero generated text
tokens for embeddings and speech. A pinned backend watcher refreshes only the two
approved replicas, with a persistent three-attempt daily limit per worker.

The RTX 2060 completed both three-request qualifications, a direct HTTP vector
request with 2,560 normalized dimensions and a Spanish WAV request. Reconnecting
the embedding worker invalidated its previous session proof; the watcher produced
a new proof for the replacement session. Its managed Windows bootstrap also
passed a real cold start with normal priority inside the unchanged 4 GiB / 90%
Windows Job, preserving the pre-import barrier and kill-on-close protection.

The actual economic evidence authority accepted both direct API receipts in a
read-only preview. No customer debit, contributor credit or settlement was
performed by that preview. The public AntSeed request returned 502 and the seller
reported advertising paused below its gas floor; this rollout did not fund its
wallet or qualify that external route. These are two replicas on one physical GPU,
not evidence of inference distributed across two physical computers. Sanitized
identities, receipts and observations are recorded in
[`native-replica-production-evidence.json`](../tests/fixtures/native-replica-production-evidence.json).

### AntSeed production follow-up (2026-10-26)

This follow-up supersedes the preceding preview-only and failed public-route
observations. Actual customer requests for Spanish speech and GPU embeddings
completed, each with a persisted execution receipt and balanced internal-credit
settlement. Both execution and economic signatures were verified, and the
customer could retrieve both settlement receipts. These are non-monetary
Mycellios credits, not AntSeed revenue or on-chain settlement.

After deployment and credential rotation, fresh requests through OmniRoute,
AntSeed gateway, seller and Mycellios completed with HTTP 200 and
`served_free=1`. Speech used the RTX 2060 replica; embeddings used the native CPU
pipeline selected by the scheduler, returning 2,560 normalized dimensions.
Both recorded zero generated-text tokens and persisted execution receipts.
The public speech job has an internal settlement; the public CPU embedding job
has none. This does not qualify CPU financial contribution or establish inference
across two physical computers. Sanitized observations are in
[`antseed-native-e2e-production-evidence.json`](../tests/fixtures/antseed-native-e2e-production-evidence.json).

The seller explicitly selects its existing speech, research and decisions
providers. The stale text provider returned 503 and is excluded from selection;
its original configuration remains recoverable. Identity, remaining prices,
images and resource limits were preserved, and plugin versions are pinned.
Research and decisions were preserved, not newly qualified by these probes.
Three credentials exposed during diagnosis were rotated in the canonical vault
and consumers; all replacement credentials returned 200 and all revoked values
returned 401. Account identity, quotas and permissions were preserved.

Production health returned 200, PostgreSQL was connected without an error, and
the qualification watcher was active. The deployed coordinator source identity
is `sha256:bb4c6d7950156bd8e69eda1f3f33e2e3e446ae91d15dc933a23e53808217a2b9`,
based on fetched main `4f4d8e8745348b199da4e1e0dbd6a0fa09ab95d1` plus
the recorded local reliability patches. This does not imply those patches were
committed, pushed or merged.

An earlier SDK observation paused advertising with a Base mainnet balance of
0.000038496637378844 ETH, below its 0.00005 ETH floor. Daniel subsequently funded
the wallet. Jarvis's recovery evidence at 18:43 UTC records the SDK reporting
0.002168874558129165 ETH and advertising resumed. The previous funding request
is obsolete; no additional transfer is requested. This intervention performed
no transfer or gas-guard bypass. Successful requests and announcement recovery
are bounded observations, not a continuous-availability guarantee.

### Public embedding admission ingress (2026-10-26, 21:07:39 UTC)

A separate ingress validator now rejects invalid embedding envelopes before
upstream job creation or usage reservation. It reuses the exact deployed embedding
contract and delegates authentication to the coordinator's protected, read-only
execution-receipt-key endpoint. Valid requests retain their original body bytes,
authentication and idempotency headers; other models keep their existing route.
The HTTP handler's cancellation path was exercised with a fixture executor, not
physical inference. The native coordinator process itself was not replaced.

Nine local transport tests passed. The unmodified production coordinator image
with isolated PostgreSQL passed 23 HTTP cases covering validation, real API and
operator authentication, and native handler cancellation on deadline/disconnect.
The exact Nginx image preserved an active SSE call through both promotion and
rollback. TypeScript, architecture and structure checks passed before activation.
The isolated builder reproduces identical executable/configuration bytes using
its explicitly pinned TypeScript 6.0.3 compiler API; TypeScript 7 remains the
project's normal typechecker. The extra ingress source identity is
`sha256:da905e65d83e9c7bd66854df833bd13d479d47e7916643a15383ada9832e9fb6`.
It is a pinned addition to the existing runtime image, not code contained by
base source commit `c7b4479` or a replacement for its coordinator build identity.

Activation used Nginx reload only. A non-generative CORS preflight verified the
live route marker before one negative HTTP control returned 400 at the validator.
The protected container IDs, images, start times and host PIDs remained unchanged,
and public health returned 200. The validator publishes no host port, holds no
stored API key or database credentials, and runs with a read-only filesystem.
Its JSON bound is 2 MiB; non-JSON parser exceptions and other endpoints remain
upstream. Existing ingress buffering, limits and logging were preserved.
Explicit request deadlines also bound the proxy transport without rewriting the
body or retrying execution. Existing seller channels and engines were preserved.

This covers the public chat-completions ingress used by the selected speech and
embedding provider. Direct/internal port 4174 callers remain outside this filter;
there is no claim of global coordinator admission closure. A subsequent Jarvis
readback reported three new vectors after its post-activation baseline, all three
valid, and eight successful free gateway responses with one concurrency rejection
in a short window. Further validator rejections occurred after the single control
request. These observations show continued operation and pre-execution rejection,
not a measured migration speedup or reduction of on-chain channel-open fees.
The channel opens before its request payload is validated. Buyer addresses in
metering do not establish the operator or originating process. No buyer was
blocked and price, account limits, daily cap and channel TTL were not changed.

Sanitized evidence: [native HTTP cases](../tests/fixtures/embedding-ingress-native-http-evidence.json),
[active-stream reload](../tests/fixtures/embedding-ingress-reload-evidence.json) and
[activation receipt](../tests/fixtures/embedding-ingress-deployment-evidence.json).

## Agent integration authentication candidate (2026-11-04)

The local candidate resolves each toolkit's enabled custom auth configuration on
an explicit connect attempt and pins it to the owned authorization session.
Managed defaults and genuine no-auth toolkits retain their existing route.
Disabled-only and ambiguous custom configs fail closed. Missing operator setup
uses translated copy; raw provider JSON and request IDs are not user-facing.

The operator CLI can prepare a credential-free template plan and apply that exact
reviewed file by SHA256. It retains existing/disabled configs, rechecks concurrent
creation, supplies no shared credentials and never retries an uncertain POST.
An authorized provider-project application was read back successfully. This is
template-state evidence, not authenticated provider or tool-execution acceptance.
Services requiring their own developer app, including X, remain dependent on
operator-provided OAuth configuration. Private project reports are not committed.

Local verification passed 92 focused Agent and catalog/release-note tests,
six operator CLI tests, root structure/architecture/type checks, the shared UI-kit
gate, API/worker/web types and builds, and credential-free compiled server startup.
The real integration dialog was reviewed at desktop, tablet and phone widths with
an isolated fixture. The dedicated CI browser proof exercises those widths,
legacy error hiding and an independent successful connection without real accounts.
Check its screenshots and the complete release checks on the exact candidate SHA.
The standalone adapters package typecheck still reports existing errors in
unchanged runtime/test files; the deployed API and worker typecheck commands pass.

A separate local Fedora caption backport keeps the native overlay transparent and
restricts theme messages to symbol colors. Its ten focused tests pass; installed
Electron visual acceptance and a replacement installer remain unqualified.
Neither these source changes nor a new native package have been published.

The combined release candidate also retains the serving backend's independent
Mico task conversations, owned local task/worktree admission and bounded command
observations. Its previously applied migration is recovered byte-for-byte; no
new migration execution is implied. The runtime sources were reconciled against
their recorded main base while preserving newer continuation/retry fixes.
134 focused preservation/integration tests pass, together with API/worker/web/
Desktop types, server builds and credential-free compiled startup. Private source
receipts retain the comparison; production promotion is still pending.

## External browser integration authorization candidate (2026-11-04)

Managed integration connections from the catalog and chat cards now request an
ordinary external browser target. The original client still confirms the owned
connection through the server, including when Desktop returns no popup handle.
Existing cancellation, revocation and account ownership checks remain in place.
Generic SSO, model and MCP authorization retain their existing popup behavior.

The existing update announcement describes the change in all 13 web locales; its
guarded refresh action remains unchanged. Focused qualification passed 36 tests
across Desktop routing, chat connection cards, server completion polling and
release notes, together with web/Desktop typechecks and the web production build.
Root structure, documentation, text format, UI-kit, component-boundary, architecture
and typecheck gates also passed.
A read-only routing check against the installed Fedora host confirms that an
external target bypasses its named integration popup policy; no installed files
were modified and no browser or real account authorization was exercised.

An isolated browser regression now covers the catalog connection with an external
target and a null popup handle. That new browser case has not yet run in CI.
Publication and deployment require the exact merged-main release checks and a
separate promotion receipt. These local checks do not establish successful X
sign-in or provider tool execution.

### Unified settings publication — 2026-11-05

Published the searchable account/Space settings shell as a web-only release.
Compiled revision `a2c59c3455ca4804e3d12210fcbeb41196192f79` includes synchronized
main `ec93ee68e9e3d67e50b2683791dc605de7ff6e84`; it retains current task/routine
isolation, failed-helper notifications and the canonical production skill editor.
Marketplace and continuous-voice entry remain separate capability-gated work.
The original development checkout and its unrelated changes were preserved.

Incremental web typing and 249 focused tests passed on the integrated source on
Daniel's PC. The constrained compiler also passed those checks and built web
`20261105033045`. Its sealed artifact SHA256 is
`db33e917ff2f60807a09c0b7840e58cb0871a124f8ead3cdbc88118fd1a1ab7b`.
The previous canonical settings browser scenario passed, but the integrated
scenario stopped at production's retained language-choice screen. Its setup was
aligned with that screen and the account menu; no passing rerun is claimed.
Further browser/CI repetition was omitted under the owner's proportional fast
delivery instructions. The design capture uses synthetic local data.

Private loopback and public HTTPS qualification passed for readiness, the new
entry and Settings chunk, 15 initial assets, anonymous session handling and
`/agent/` PWA scope. Read-only inspection in the signed-in production browser
confirmed the new menu and served build. No account preferences were changed.
An initial Python HTTP probe received 403 and triggered automatic rollback;
qualification with the existing curl transport succeeded on the second promotion.
Previous configuration and immutable assets remain available for reversal.
API, worker, database, coordinator and other protected container identities/start
times were unchanged; no migration, financial action or native installer update
was performed. Full CI was not run. Detailed receipts and logs are retained in
`outputs/settings-prod-20261105/` and the owned server release directory.

## Apps authoring standard — local foundation (2026-11-05)

Apps v1 has a strict manifest/action contract, semantic graph/type/permission
validation, a bounded read-only bundle CLI, a complete video-studio definition,
creator skill and authoring guide. The [standard](../specs/apps-standard/spec.md)
separates definition admission from actual runtime qualification and publication.
Versions are immutable, project versions remain pinned, actions are declared
contracts and both execution targets require independent future qualification.

The 51 affected tests, three scoped authoring checks and an incremental typecheck of the Apps contracts, public
exports, CLI and tests passed on Daniel's PC in an isolated checkout. Tests cover
unsafe definitions, cycles, typed references, altered assets, path traversal,
symlink escape, bounded reads and immutable-version CLI behavior. The broader
contracts check encountered its existing credit-units.test.ts extension error;
it is not reported as a passing package-wide check.

No Apps catalog/sidebar, renderer, project-store migration, executable action
adapter, billing or publisher was enabled. No global skill/profile installation,
paid call, render or production deployment was performed. Full CI and physical
local/Cloud execution qualification were NOT RUN under fast-delivery mode.
## Mico work controls, concurrent tasks and workflows (local source, 2026-11-05)

The Mico task bar now exposes revisioned delegated-work controls and an owned
recent-work overview. Pi Micos admit 1–4 simultaneous turns atomically across
workers, with one live turn per thread. Private Pi tasks reserve the existing
exclusive computer lease before computer operations; native provider sessions
remain single-turn. Existing resource reservations, permissions and models remain
in use. The visual workflow editor supports manual/cron triggers, instructions,
Micos, text conditions and outputs. Executions freeze a graph version, persist
private step Runs and resume via the existing reconciler. Workflow Stop atomically
cancels its Runs and records the existing durable process teardown outbox.

Local qualification passed 285 directly affected tests, incremental web/API typing,
and the isolated PostgreSQL acceptance script (16 recorded checks, including the
actual additive migrations, concurrent admission, stale controls, owner/Space RLS,
step recovery and durable Stop). Adapter typing also passed in the isolated remote
compiler. Earlier local checks hit memory limits; those attempts were not passes.
The final browser fixture passed on the PC: task controls, concurrency selection,
workflow save/run/stop, desktop/mobile layout and light/dark task navigation.
The desktop-width assertion caught and verified a corrected dialog-size defect.
The scoped design detector returned no findings; the fresh finish review returned
`ship` for the supplied synthetic captures and UI source, with delegated controls
source-reviewed rather than visually captured open.

Fixtures used synthetic accounts and a fresh loopback database, called no models
and did not access production. Full suites, authenticated provider execution,
installer packaging and production promotion were NOT RUN for this change.
The changes are local on `codex/mico-workflow-concurrency-20261105`, based on
main `6420234`; no commit, push, shared migration or deployment is implied.
Evidence is retained in `outputs/mico-workflows-acceptance-20261105/` in Daniel's
workspace. Other agents' original checkouts and changes were retained.
