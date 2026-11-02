# AGENTS.md

- Project browsing belongs beside any chat in the shared review workspace. Desktop
  uses an isolated, sandboxed native WebContentsView with its own ephemeral session
  and inspector preload; webpages receive no application bridge, account cookies or
  OS-tool credentials. Keep exact main-frame/owner/chat/Space admission, bounded
  native rectangles and generation-bound selections/captures. Native content hides
  below app dialogs/menus. Selection comments and captures become editable drafts,
  never implicit sends. The web fallback requires a cooperating, frameable page;
  do not strip framing/TLS protections or proxy arbitrary sites. Generic project
  folders and local-computer consent remain independent of the browser. Do not add
  a Mycellios-only development launcher or automatic managed-copy admission.
  Preview toolbars and comment actions must wrap at narrow widths and enlarged
  text sizes; do not hide selection instructions or the draft action to make them fit.
  Preserve any existing local source copies; code changes stay in their chosen
  project directory. Record qualification in specs/project-browser/spec.md and the
  canonical docs/STATUS_AND_EVIDENCE.md. For Windows installed acceptance, inspect
  the ordinary desktop profile: packaged tools can virtualize AppData, so their
  own successful filesystem reads do not prove the app can see the installation.

- Ordinary native project selection retains explicit consent and the configured
  server's owned Desktop relay (or the app-managed local instance). Keep OS bearer
  credentials native-only, revalidate sessions and bot ownership, expire disconnected
  grants and never replay uncertain commands. The outbound relay remains opt-in on
  API and worker. Never expose a host shell on the API server. Keep folder grants
  off HTTP/renderer-supplied paths, preserve dedicated-computer assignment and
  normal workspace boundaries. Shells retain OS-user permissions, not an OS sandbox.
  Reassert existing native relay bindings periodically with the same approved
  generation after API restarts; never replay commands. Long network outages
  abort uncertain operations and show disconnected, while authenticated recovery
  may reuse the grant. Account/session changes and explicit revocation still
  discard all bindings.
  Advertise native project controls independently of consent and network readiness;
  a failed identity probe must not hide the connection action. Authenticate and
  enforce the grant when requesting access or connecting, before any file/command work.
  A connected agent already receives a persistent native workspace automatically;
  do not require folder selection to enable shell/file tools. Existing projects can
  be addressed with the shell's cwd/native paths under the existing access policy.
  The optional picker changes the project file-tool mount; it is not onboarding.
  Browser Play/Stop uses the native project runner and portable `.mycellios/run.json`
  service profiles. Only first-time/invalid configuration is prepared by the chat's
  agent through an idempotent auxiliary `project_prepare` run, never a synthetic
  user message or a normal `threads.send`. Keep its narration out of transcript,
  live events, sidebar activity and later conversational steering. Status and
  bounded final details belong in the Browser's folded logs. Required user-input
  cards retain their normal approval flow. Stop cancels only this owned preparation
  by exact run ID as well as the native services; cancellation failures remain
  retryable. Initial status polling must not cancel a Play intent while native
  access/connection is still pending. Transient observation timeouts retain the
  pending intent and clear their stale error after recovery; Stop and access
  revocation still prevent automatic startup. Use anonymous Koffi Job structures
  across separately bundled host/runner modules to avoid process-global type
  collisions; verify independent real Windows process trees.
  Preserve startup refusals before aborting and killing owned children; cleanup
  exits must not replace the original error. An identity read may retry one
  TimeoutError, never commands or access refusals; revalidate the returned owner.
  Preserve the native host's workspace accessor
  when composing installed repairs; qualify the actual packaged host wrapper as
  well as source fixtures. Deploy the worker's trigger classification before enabling the new
  API creation procedure, then update clients; never fall back to a chat send on
  an older server. Keep the absolute project binding in the
  native machine-local profile, never in portable workspace exports. The manager
  owns process trees, readiness, logs and stop; a model turn does not own servers.
  Preserve loopback-only URLs, dependency validation, preparation cancellation and
  native account/Space/chat checks. Never stop unrelated listeners or open the
  system browser for a runner preview. Keep the toolbar usable at narrow widths.

- Source preview commands are npm run dev:local:backend and dev:local:web.
  They use the existing embedded PostgreSQL server, a separate local worker and
  Vite; the Browser profile waits for API/database readiness and a fresh worker
  heartbeat before starting the frontend. RAKAZO_PROJECT_LOCAL prevents dotenv
  loading; the launcher passes a minimal OS environment and explicit loopback
  settings, never inherited production databases, SSO, telemetry or model keys.
  Persist local data/keys only under ignored data/project-preview. Stop owns the
  complete foreground process tree and retains that data for the next Play.
  Migration snapshots include actual SQL and ignore only empty draft folders;
  nonempty malformed migrations fail. Local users register normally; do not add
  a login bypass or copy the stable app's sessions. Models/integrations require
  their own local configuration; fixture results do not prove live inference.

- Windows Desktop bundles the existing runtime with `apps/desktop/scripts/package-windows.mjs`
  and a pinned public MSI hash. Keep the per-user app ID and legacy userData path
  stable across branding changes. Contribution requires its own account grant;
  preserve existing runtime identities and the separate headless installer. Do not
  activate automatic unsigned updates or treat a same-profile install as clean-OS proof.

- First-party Mycellios sign-in uses the normal same-window OIDC redirect on web
  and Desktop. Windows uses transparent native titleBarOverlay controls over the
  floating header; never paint an opaque caption rectangle over scrolling messages.
  Authentication pages keep a transparent host-owned drag region across the free
  caption row; exclude Windows caption buttons and restore the compact region on returning to chat.
  Right side panels also reserve the native caption row outside their scrolling
  content, so panel and preview close buttons stay below Windows window controls.
  Linux uses the local host-owned three-color control strip
  across navigation, including login and renderer failures, without the OS title bar.
  Keep it in its own sandboxed view, restrict its IPC to its owning window and three
  caption actions, and dispose its renderer on close. The legacy nativeWindowFrame
  capability means controls are host-owned; hide duplicate in-page controls only
  when the bridge advertises it. Older frameless builds retain their page controls.
  Sign-in proceeds without an intermediate login launcher or popup. Keep the persistent
  server-specific Electron session, state/PKCE and explicit retry after failure.
  Generic self-hosted SSO and model/integration authorization retain their existing
  popup behavior; never broaden main-window navigation to arbitrary identity hosts.
  Normal Desktop startup opens Mycellios directly, including after unusable saved
  preferences. Connection failures show Retry/Close with server setup folded under
  Advanced; retry only the native-owned failed target, without configuration writes,
  server fallback, local stack activation or new project/contribution permissions.
  The recovery header must not duplicate Windows caption actions. Keep the
  native-owned connection failure detail folded under Advanced and refresh it
  after an unsuccessful retry without changing the target or account session.
  Preserve explicitly configured self-hosted installations and their owner checks.
  Owner-configured local Desktop UI previews retain the canonical HTTPS origin and
  its existing cookie partition. Serve only /agent frontend assets; forward API,
  RPC, OAuth and central login unchanged. Keep local bundles inside the profile,
  bind them to the installed native version and never copy session cookie values.

- Packaged Desktop E2E selects a window exposing the native bridge and waits for
  `rk:main:load-url-resolved` before navigating; startup storage probes are not the
  application window. Linux Electron automation explicitly enables
  `chromiumSandbox: true`. Distinguish container GUI/identity fixtures from a
  physical Linux GPU or a real-account sign-in.

- Linux x64 unified packaging uses `apps/desktop/scripts/package-linux.mjs` with a
  pinned headless runtime DEB. Reuse its service and identity; polkit elevation is
  only for explicit setup. The shared sidebar controls an account-owned native node
  through the linked SSO session. Pending commands are not confirmed contribution.
  Visible internal balances are Credits (Créditos in Spanish), with 1 USD = 1 Credit on paid top-ups; Spore names the separate official token and Micos names the agents; retain historical ledger/API field names and never
  award a client-calculated balance for connection time.
  Web sidebar downloads target the Desktop product page, not a headless-runtime
  installer. Keep download and browser contribution links separate and preserve
  the active chat when opening either; hide the Desktop offer in the native app.
  SidebarFooter owns the download offer outside the scrolling roster, including
  in installed PWAs; contribution controls must not duplicate it.
  The mobile invitation also lives in SidebarFooter. Its dismissal is browser-local;
  the account menu can reopen the installation guide. Hide the invitation in an
  installed mobile PWA, while keeping the guide available. Describe Home Screen
  installation honestly as a web app, separate from native store/Desktop releases.
  Share only the server's Agent entry URL, never a chat URL or authorization data.
  Keep service configuration private. The elevated helper may publish only the
  non-secret node ID under the protected runtime install root; reading that ID
  never grants ownership or replaces enrollment. Linux descriptors must be root
  owned and not writable by group/other users.

- Execution logs are hidden until the signed-in user enables browser-local developer
  mode under General/Advanced. This display preference never changes server permissions.
  Label client-side log filtering as filtering loaded pages, not the complete history.
  On an older API without `runs.logs`, show explicitly limited recent activity from
  the authenticated space client; do not invent diagnostic fields or fall back on
  authentication failures. Keep prompts and tool payloads out of this view.

- An unset approval model follows the effective main model and its connection in
  the same account/Space scope. Keep explicit approval choices intact; the web
  approval section lives under the single Advanced group at the bottom of model
  settings, retaining its explanation next to the title inside that group.

- Each agent has a visible model picker outside Advanced. A blank choice inherits
  the general model; a specific choice updates only that bot, never Space defaults.
- Provider forms manage connections and keys; model selection belongs to the role
  picker. Connecting a provider never changes a role. Discover compatible catalogs
  using the owned saved credential; enable a newly chosen model before saving its
  role, retaining endpoint, secrets, existing enabled models and runtime limits.
  Show stored keys using `hasKey` and a masked status, never a recovered secret or
  a fake input value. Catalog discovery must not reject legacy connection metadata
  as though it were an explicit role selection.
  Mycellios is the built-in account provider: show it before optional providers
  on first-party deployments, use its authenticated Credit-funded chat catalog,
  and keep its credential server-side. Reconnection reuses the owned connection,
  preserves explicit roles/limits, and never adjusts a balance. Only an unset
  account main model receives its available default during setup.
  Budget native chat after serializing tool/history envelopes. A saved output
  limit is a ceiling; fit each call within its configured context without
  dropping input, changing saved limits or affecting other providers.
  An unadmitted no_capacity response may retry once with a smaller per-call
  ceiling. Never replay accepted work, idempotent requests or billing failures.

- PWA manifests launch the app route inside their deployment base. Keep the
  existing manifest ID and scope stable when changing start URLs or branding;
  the first-party landing links to the same Agent manifest and icon assets.
  Version the icon URLs when refreshing branding so installed browsers detect it.

- Web and installed PWA updates share the server-verified client update tracker.
  Render that single prompt in the sidebar slot when expanded, with a floating
  fallback where no slot is mounted. Keep the same guarded update action and
  dismissal state; never manufacture a download percentage for web refreshes.
  Native download percentages come only from the Desktop bridge's observations.
  Keep manual reloads guarded against unsaved work, including after the version fetch;
  desktop retains its separate native installer prompt.
  Detect web-only releases from the served build on foreground/minute checks;
  even required upgrades must retain draft, attachment, recording and call guards.
  Refreshing the client must never cancel or replay server tasks.
  Curated release notes live in `lib/release-notes.ts` and `ReleaseNotes.tsx`.
  Show them after a newer bundle actually loads, using the prior observed build
  or the guarded update marker; don't describe a first visit or rollback as an
  upgrade. Keep acknowledgement browser-local and allow reopening from the account
  menu. Update the notes edition, date and minimum build together for each authored
  announcement; don't invent semantic versions or copy upstream release claims.

- The loopback production preview proxies the fixed authenticated Agent API; it
  never starts development workers against production data. Keep first-party
  client/callback validation, PKCE/state and secure cookie flags intact. Consumed
  or expired consent URLs restart login; direct OAuth approval responses and empty
  redirects must preserve the callback and session cookies. Qualify with
  `node --test scripts/production-preview.test.mjs` and a real browser session.
  Development previews opt in to local Vite asset routing for hot reload; keep
  credential headers stripped from UI requests and HMR bound to loopback. Never
  proxy arbitrary screen/computer WebSockets or start local production workers.

- Execution logs are owned, space-scoped metadata with bounded keyset pagination.
  Keep prompts, checkpoints, tool payloads and raw provider errors out of this API;
  return allowlisted failure codes and distinguish worker claims from actual attempts.

- Output-limit continuations share the existing three-recovery budget, preserve visible
  text and require progress. Keep call reservations/usage for every attempt and never replay
  completed tool effects. Respect saved output limits and retain partial text on failure.
- An empty advanced output limit selects automatic recovery; do not save a default as
  an explicit user ceiling. Keep learned tool-output budgets scoped to one run/model,
  bounded by context/provider/credit limits, without replaying completed effects.
- Coalesce event-driven thread/sidebar reads per subscription, retaining invalidations
  received while reading and disposing queues on navigation. A serial read timeout starts
  only when that read starts, not while it is waiting behind another read.
- A running computer does not prove its screen is connected. Offer screen retry and
  confirmed recovery separately, preserving the recovery dialog during background refreshes.

- Keep transcript progress compact: status and elapsed time first, tool activity
  and execution diagnostics folded by default. Unknown worker health stays visibly
  unconfirmed; folding details must never cancel, retry or restart a task.
  Keep the latest projected action visible outside disclosures, scoped to the
  active run and labelled as recorded activity rather than worker liveness.
- Protect multiline secret fragments during streaming as well as whole-output redaction;
  monitoring must scrub Windows profile paths with either slash direction and spaces.

- Answered ordinary questions collapse into a neutral reply with the original
  question available in a disclosure. Keep approval outcomes and saved credentials
  on their existing explicit status path, never expose secret answers.

- This development fork presents Mycellios Agent. Shared product names, API origins and asset
  paths live in `packages/contracts/src/product-brand.ts`; semantic forest/paper
  colors remain in `packages/ui-tokens/src/index.ts`. Web overrides must not
  replace the shared forest/paper surfaces with upstream monochrome colors. Generate its CSS with
  `npm run generate --workspace @rakazo/ui-tokens`. Preserve upstream license notices
  and internal storage/protocol identifiers when changing visible branding.
  Declare the startup Geist font in `apps/web/package.json`; ship its OFL notice
  under `apps/web/public/licenses/` rather than relying on a sibling clone cache.
  Agent headings, wordmarks, startup and hosted account forms share Geist through
  `apps/web/src/typography.css`; keep serif display overrides out of these surfaces.
  Hosted identity builds self-host font assets and require same-origin font CSP.
  App icons derive from `packages/ui-tokens/assets/mycellios-mark.svg` via
  `npm run export:brand --workspace @rakazo/ui-tokens`. Keep separate opaque maskable/iOS
  and transparent adaptive/notification outputs; Windows ICO includes small native frames.
- Preserve the separate contribution and paid-model ledgers; product naming does not merge or revalue them. Paid top-ups use the shared integer conversion in `credit-units.ts` (10 USD = 10 Credits). Mico/Micos names the user agents; Spore is the official token name, with existing launch gates unchanged.
- Credit refreshes are account-scoped, cancellable and serialized. A transient failure
  may retain the same owner's last verified amount only with a stale indicator; clear
  it on identity/permission changes or an authoritative null. Never persist client
  balances or turn an unavailable read into a zero. Keep retries bounded and dispose
  timers/requests when the owner changes or the component unmounts.
- Mycellios contribution credits and USD model credits retain their separate funding paths. Never relabel the
  existing USD ledger as MYC or mint contribution credits from client reports.
  Server-issued promotional Credits remain separately identified from earned contribution credits, including in the account schema and credit display. Never count promotional allocation as contributed work.
  See `docs/mycellios-agent.md` for integration and verification requirements.
- Web builds may use `APP_BASE_PATH=/agent/` (default `/`). Keep routing, auth callbacks,
  network endpoints, assets and PWA scope inside that namespace; never claim the host's
  root service-worker scope or replace the surrounding product routes. Hosted sign-out
  also clears and revokes the primary Mycellios session; standalone installs stay independent.
  Qualify the compiled deployment through `/agent/api/auth/get-session` and
  `/agent/rpc/`, including cookie and PWA scope; helper unit tests alone do not
  verify proxy rewriting or the browser's configured auth and router base paths.
  Linux desktop lifecycle and shared profile cleanup tests require Linux. On a
  Windows workstation, run them locally inside the built Linux container.
  The Kubernetes sandbox provider is excluded pending qualification on the
  production Node runtime; do not restore it as part of an unrelated release.
- Hosted frontend promotion may use an immutable UI directory in the existing
  read-only Nginx mount. Identify the served build and active front configuration,
  not only the web container image/dist mount. Preserve HTML-only asset rewriting,
  legacy asset fallback, forwarding/WebSocket headers and `/agent/` PWA scope.
  Adding location-level `proxy_set_header` requires restating inherited headers.
  Qualify the candidate through private loopback before graceful promotion; retain
  the previous configuration and immutable artifacts for rollback. Never replace
  API/worker/database services for a frontend-only terminology release.
- `apps/web/src/hosted-login` builds the first-party identity transition served by the
  surrounding site. Offer both sign-in and primary-account registration there;
  switching forms must retain the pending OAuth authorization and its PKCE flow.
  Confirmation-required registrations are not authenticated sessions.
  Continue automatically only for deployment-
  configured client/callback pairs with openid/email/profile scopes. Unknown clients
  or broader scopes still require consent. Keep live client IDs outside Git and
  preserve server-side PKCE, nonce, subject identity and callback validation.
  The dashboard entry script is only a legacy fallback: remove it when the
  panel supplies its own Agent link, while preserving synchronized sign-out.
- Ask for a language once before mounting the interactive app, remembering the
  browser choice. Before a saved choice exists, use English regardless of
  browser language or build environment. Forward only supported locale values to model-facing greetings
  and new task prompts; never translate history by rewriting stored messages.
- Appearance defaults to light when no valid preference is saved. Keep the pre-paint
  bootstrap and React resolution aligned, and preserve explicit dark or system choices.
- The web fork uses the Mycellios forest/paper palette; this supersedes the
  upstream monochrome appearance rule below. Preserve semantic status colors.
- Keep horizontal scrolling inside wide code/table blocks, never on the whole
  transcript. Bound message wrappers and reserve the hover-action gutter, including
  credential requests; verify the complete chat with mouse, touch and focused inputs.
- Chat credential requests share the bounded question-card width. Inputs may
  fill that card; action buttons keep their content width and wrap when needed.
- Settings forms must fit narrow viewports: keep provider columns stacked until the
  dialog has room for both, bound long form widths, wrap action labels and retain
  independent navigation/content scrolling. Check open and closed forms at mobile,
  tablet and desktop widths without changing credential or provider behavior.
- Integration catalogs use one column on narrow screens so app names and
  connection controls remain visible.
- Shared dialogs must use shrinkable grid tracks and reserve the close button's
  space when rendering a header. Keep long selector values inside the trigger;
  bound open menus to the available viewport and wrap the complete option label.
  Qualify narrow layouts with long names and keyboard selection, not just empty forms.
- General settings retain upstream SettingsGroup/SettingsRow geometry: grouped
  rows with compact controls beside labels, wrapping on narrow screens. Keep
  password editing closed until requested rather than stretching the default form.
- Keep the initial HTML and React startup fallback visible before language and
  session loading finish, using the shared semantic tokens. Measure reload latency
  against the compiled web preview; remote development-module loading is not a
  representative production measurement.
- The Mycellios messages-only adapter translates tool calls and correlated results;
  it translates native SSE text, reasoning and tool arguments incrementally.
  Only a validated terminal result with final usage and `[DONE]` completes a turn;
  truncated or interrupted tool calls must not execute. Legacy JSON responses stay
  buffered; do not fabricate incremental timing for them.
  Runtime schema paging preserves the full authorized tool catalog and original
  executors. Keep initial declarations compact and update them before the next
  turn; changing only `agent.state.tools` leaves old transcript declarations.
  Refresh the executable snapshot before continuing a restored turn: the SDK's
  next-turn hook has not run when checkpointed schema controls are recovered.
  Restored turns must synchronize transcript tool deltas before continue(). Budget
  non-reasoning compatible chat against the same collapsed system/tool state the
  transport sends, preserving current instructions and correlated results.
  Keep authorized memory and user-clarification schemas in the initial catalog;
  basic interactions should not require discovering their own core tools.
- An unavailable sandbox is an explicit `none` computer status, with screen,
  terminal and update access disabled. Keep text chat and thread snapshots usable
  without pretending that a computer was provisioned.
  Remove computer-dependent model tools when the provider is `none`, retaining
  connected-app and text tools. Never claim a persistent workspace in that mode.
- Answer explanations and recommendations before suggesting work. Reserve
  `ask_user` for essential missing information, not a menu replacing the answer.
- In the Mycellios-only browser deployment, login and registration enter the
  configured first-party identity flow automatically. Keep explicit retries after
  cancellation/failure and require a user gesture for desktop OAuth popups.
- Mycellios SSO reuses the configured OIDC provider. The explicit account-connect
  action resolves only the current user's linked issuer, creates an owned native
  key server-side and requires contribution funding. Never return OAuth tokens
  or model keys to the browser, or select identity by email alone. Operator model
  defaults set the initial limits; saved connection settings remain authoritative.
  Setup has a bounded sixty-second overall deadline for public authority round trips;
  keep individual service limits, cancellation and unused-key revocation intact.
- Native account-service failures return an unavailable response without exposing
  diagnostics or switching funding sources. Preserve revocation of unused keys.
- Browser saved-login fills must check the current origin and focused input type
  together. Passwords belong only in password fields; partial fills are cleared.
- Stream recovery is bounded and never executes truncated tool calls. Preserve
  partial replies with redaction and attribute every retry's usage separately.
- Optional authenticated-device session duration belongs to the API composition
  root and keeps bounded rolling renewal. Preserve expiry, sign-out, revocation
  and fresh-authentication requirements; never make OAuth access tokens permanent.
  Hosted deployments may set `AUTH_SESSION_DURATION_SECONDS` from one to ninety
  days; leaving it unset preserves the existing default. Keep the Compose pass-through
  and environment validation tests aligned with this setting.
- The runtime owns context admission for compatible requests without active
  thinking, including reasoning-capable models. Use the raw SDK stream after
  admission so its simple wrapper cannot subtract a second fixed 4096-token
  margin. Preserve assistant roles in restored history, with zero new usage for
  historical messages. Check the real SDK boundary with `pi-catalog-offline`
  and the small-window, thinking-off cases in `pi-compaction-offline`.
- Before any provider request or credit reservation, non-reasoning context
  admission may lower that call's output ceiling to retain required input. Keep
  a bounded usable output floor and charge against the same limit actually sent.
  Saved limits and tool permissions stay authoritative. Verify `model-context`
  and `pi-usage` tests when changing that boundary.
- In-run history compaction uses the effective transport/model budget before main
  admission. Summarize only historical data with the same owned connection, no
  tools, bounded chunks/calls/time and separately attributed compaction usage.
  Active summaries may exceed the connection timeout; retain the independent
  provider idle watchdog and caller cancellation under the summary deadline.
  One empty-summary recovery may halve that chunk on the same owned connection;
  count both attempts, keep the remaining suffix and never rerun tool effects.
  Keep the summarization task outside the untrusted transcript and reserve its
  tokens. Preserve later corrections, negations and deferred decisions explicitly;
  a nonempty summary alone does not establish faithful recall.
  Carry available message IDs and chronology into summary inputs so a later
  recollection cannot silently replace contradictory original evidence.
  Preserve current input, steering, images, completed tool effects and checkpoint
  suffixes. A provider input-overflow rejection permits one model-only recovery
  before visible output; never restart tools or silently change models to recover.
- AntSeed uses provider ID `antseed` with the shared configurable compatible
  transport. Keep its gateway key, enabled models and billing independent from
  Mycellios. Use `isOpenAiCompatibleProvider` for text connection/runtime checks;
  account balances resolve an owned Mycellios endpoint across connections,
  never the newest arbitrary compatible connection or the current main model.
  voice retains its own provider contract. Gateways are user-configured, not a
  hardcoded public endpoint. Preserve HTTPS, SSRF and endpoint-bound secret guards.
  The first-party `/agent/` deployment may preset its authenticated same-origin
  gateway for a new connection; preserve saved gateways and require the user's key.
  First-party onboarding starts with the signed-in Mycellios account and owned
  contribution credits; AntSeed remains an explicit alternative requiring the user's
  own key. Never fall back to another payer or provider when native credit access fails.
  Alternative key-based onboarding discovers models before the user confirms one.
  Keep endpoints and capability limits in advanced setup; preserve key ownership and
  endpoint-bound credentials. The owned local preview uses the public HTTPS gateway,
  never an operator's shared key.
  Treat exhausted provider free allowances separately from transient rate limiting;
  do not silently switch an account to paid routing.
- Catalog API-key connections run a bounded tool-capable model check before saving;
  lasting account refusals reject the connection, while transient failures remain retryable.
  Preserve the separate native-credit and compatible-provider setup paths.
  Routine account failures back off only the user's own refused connection, never
  an operator outage; a successful run restores cadence. Keep its schema change additive.
- Compatible model settings show the full catalog in the searchable model picker.
  Keep connection, keys, limits and additional-model management in one advanced
  section without nested configuration disclosures. Searching and the enabled-only
  view must not change saved selections, endpoints or key ownership. Preserve
  manual model IDs and the active model's protected enabled state.
- Usage settings show full authorized history per agent, aggregating raw model
  calls once. Keep token and money subtotals explicit when records are incomplete.
  Per-response cost visibility is an opt-in remembered browser preference; preserve
  receipt reconciliation and never label pending or unpriced calls as free.
- Native packages use separate Mycellios application identities. Do not restore
  upstream Expo ownership or update feeds. Desktop updates remain opt-in through
  `MYCELLIOS_AGENT_UPDATES_ENABLED=1` only after configuring and qualifying an owned
  signed feed; mobile updates and push need an owned Expo project before release.
- Task cost summaries sum all attributed model calls and descendants once. Keep
  confirmed charges, estimates, pending settlement and missing costs distinct.
  AntSeed uses opaque per-call attribution and that key's scoped receipts; never
  infer one task's cost from shared wallet deltas or advertise unknown cost as zero.
  Inference totals exclude chain gas and external tool services.
- Contribution balance lookup uses the user's owned canonical Mycellios connection
  independently from the selected chat provider. Keep user/space credential and
  secret ownership checks; another provider's key must never reach Mycellios.
- Offline Vitest runs disable Vite environment-file loading. Supply fixture
  configuration explicitly; never make tests depend on a maintainer's `.env`.
  Linux lifecycle and publishing fixtures require Bash, Python 3, jq and procps
  (including the external `kill` command). Installer smoke fixtures also require
  curl, OpenSSL and the Docker CLI.
  Image credential checks inspect saved layers with Python 3 and never start
  the application. Keep the archive-policy fixtures passing, reject unsupported
  encodings, and retain the third-party `node_modules` exclusion. The check also
  rejects secrets deleted by later layers because they remain recoverable.
- Web dictation and calls prefer the configured transcription provider when
  available. Keep browser speech as the unconfigured path, and retain cancellation
  isolation between recordings. Verify dictation, hold-to-talk and call-session tests.
  Composer dictation is independent of the deployment's phone-call capability;
  disabling calls must not hide or disable the microphone in text chats.

- This is a public repository: assume all tracked content and diffs are public. Never commit secrets, `.env` files, private URLs, personal/customer data, or real production data; use fake placeholders. Review `git status` and the staged diff before committing, and never force-add ignored files. If private data appears, stop and alert the maintainer.
- Rakazo is one product across web, Electron desktop, and Expo mobile; Electron hosts the web UI. Put shared behavior, contracts, API logic, and reusable UI in packages. Keep only genuinely native navigation, storage, permissions, and interactions platform-specific. Core workflows must cover every applicable surface or degrade safely for an explicit reason.
- No hosted vendor is required to run the core product. Keep LLMs, sandboxes, memory, voice, integrations, and future external services optional and behind provider-neutral interfaces. Vendor SDKs, configuration, and translation belong only in adapters and composition roots. New providers must reuse shared contracts and deterministic offline conformance tests.
- Keep UI and copy minimal. Show advanced capability progressively and only when it becomes relevant; do not add explainer text that repeats the interface. Frontends express intent and render state; the backend owns orchestration, authorization, validation, retries, recovery, and provider translation. Give controls concise accessible names when needed.
- User-clicked chat links in web, PWA and Desktop open directly without a confirmation
  dialog. Preserve URL sanitization and native browser gestures, with noopener/noreferrer
  for new tabs; this does not grant tools permission to navigate or act autonomously.
- Treat every visible word as UI. Start UX work by asking what can be removed, and prefer progressive disclosure over persistent explanation or status chrome. If a PR adds user-facing copy, its description must quote the copy, explain why it is necessary, and say why removing it or revealing it only when relevant would not work.
- Configure compatible providers and models through shared connection settings and standard protocol capabilities; never add provider- or model-specific environment variables when the generic connection can express the behavior.
- Use top-level `import type`, never inline type imports. Reserve dynamic `import()` for necessary deferred loading.
- Keep code simple: reuse existing primitives and one source of truth, remove duplication and unused flexibility, and avoid speculative abstractions. Add an interface when it protects a real external or platform boundary, not for its own sake.
- Production deploys run the previous and new API side by side for a few seconds after migrations apply, so every migration must keep working with the previous release's code: add tables and columns first, and drop or rename only in a later deploy once nothing reads them.
- Treat auth, secret handling, sandbox boundaries, host commands, and integrations as security-sensitive. Keep tests deterministic and offline by default.
- Judge natural-language meaning and factual claims with an LLM and an explicit, versioned rubric calibrated against reviewed examples; do not grade free-form prose with keyword lists, regexes, or exact wording. Keep deterministic assertions for observable effects and structured output contracts. Keep judge calls opt-in and provider-neutral, report their cost separately, and treat judge errors as unqualified results rather than passes.
- The desktop Playwright suite (`npm run test:e2e --workspace @rakazo/desktop`) opens real Electron windows and steals focus on macOS. Do not run it on a maintainer's machine as routine verification; run the unit tests locally and let CI's virtual-display job run the e2e on push.
- Marketing pages (the Astro site in `apps/www`) don't get tests. Check those changes visually and with a build, not with unit or E2E tests.
- After creating a pull request, stay with it until CI and automated review bots have finished; passing checks alone do not mean the review is complete. Follow `.agents/skills/pr-watch/SKILL.md`: run its `pr-digest --watch` helper as a single backgrounded call that blocks until a new review comment or check failure arrives or the checks on the current head commit are terminal, then act on the verdict it prints and watch again. Do not poll in the foreground on a timer, which mostly buys repeated snapshots of an unchanged PR and dies at the tool timeout. Address every actionable issue, push the fixes, and repeat until no actionable feedback remains. Do not merge while review bots are still pending or review issues remain unresolved.
- PR descriptions say why the change exists, what changed, and how it was tested. Write Why as the product reason (what was wrong and what this changes); never "Elie wants" or a third-person briefing of a named person; the maintainer is the author.
- Commit messages, PR descriptions, issues, and review replies are public too. Describe test results in words instead of pasting tool output. Never include business metrics such as analytics, traffic, click-through, conversion, signup, revenue, or star-growth numbers; give the product reason in words, even when data motivated the change. Never include anything that identifies a person, machine, or account: local paths, usernames, hostnames, signing identities, legal entity names, Apple Team IDs, API key IDs, issuer or tenant IDs, account emails, or the accounts, machines, and files that secret values came from. Naming the secrets a workflow reads is fine; use placeholders when a value must be shown.
- For UI changes, link the CI E2E screenshot that shows the change on the PR; add the web test that opens that screen if it is missing. For native-only mobile UI that CI cannot capture, say so in the PR instead of linking an unrelated web screenshot.
- UI system. Colors live in `@rakazo/ui-tokens` as semantic tokens (background, card, muted, border, primary, destructive, ...) with one TypeScript source that generates `tokens.css`; never hardcode a product hex or use `[var(--…)]` arbitrary values. Web and Electron use shadcn/ui on Base UI, vendored into `packages/ui-web` via `npm exec -- shadcn add` from the official registry only (third-party registries are a supply-chain risk); reuse those components before writing chrome by hand, and reuse `apps/web/src/components/ai/` for AI moments (loading, shimmer, success). The app is monochrome: primary is ink, status colors are destructive/success/warning, bots carry the only identity color. Mobile is native-first: Expo Router, Expo UI, native sheets, menus, alerts and pickers wherever one exists; custom surfaces (thread, composer, avatars, cards) use plain StyleSheet with the shared tokens through `apps/mobile/lib/appearance`, and system chrome stays PlatformColor via `lib/native`. Mobile may diverge from web when the native pattern is better.
- On mobile, use built-in native iOS controls (@expo/ui SwiftUI and Liquid Glass, native header items, context menus, alerts, pickers, and switches) wherever possible instead of custom React Native pills or buttons.

- This Agent is now maintained inside Mycellios/mycellios under src/agent. The
  parent repository's npm-only rule supersedes upstream pnpm command examples.
  See specs/agent-integration/spec.md at the repository root for pending gates.
  Keep this workspace's package-lock.json and install its own dependencies with
  npm; never junction node_modules to a sibling checkout. First-party packages
  must resolve to this checkout. Run frontend commands in apps/web (or with
  --workspace @rakazo/web) so Lingui finds its configuration. Do not validate or
  launch while another install is replacing this checkout's dependencies.
  Compose application, supervisor and updater images use the canonical repository
  as their build context so shared native contracts remain available. They install
  with npm; only the updater image receives the Docker CLI. Agent quality is checked
  separately by the root .github/workflows/agent-quality.yml workflow.


- Execution health distinguishes worker lease renewal from actual output. Never cancel
  a run merely because it is long or silent. Settle permanent preflight failures through
  fenced run finalization so missing configuration cannot retry indefinitely.

- Explain technical settings through the shared InfoTooltip and SettingsRow/SettingsLabel
  helpers. Keep help buttons outside field labels so opening help cannot toggle or
  change a setting; preserve translated labels and keyboard/touch access.

- The review workspace is independent of computer providers. Keep local files and
  unsent review notes browser-local and scoped to the active chat/Space. Comments
  become editable composer drafts, never implicit sends. HTML previews retain opaque
  sandboxing; live page selection accepts only bound-frame/origin/session messages.
  The web iframe fallback requires a cooperating page for cross-origin element
  selection. Desktop uses its isolated native inspector instead. Never proxy
  arbitrary sites or disable their framing restrictions to imitate a desktop browser.

- Native Desktop admission binds the owned computer before sending a turn. Generic
  project workflow is added using expectedInstructions conflict checks, retaining
  owner instructions. PROJECT.md in each private workspace stores verified local
  or SSH/live destinations and runbooks, never credentials. Projects are optional.
  Verify native-computer-execution.test.ts and native-computer-workspace.test.ts.

- Running-chat status shows a brief health label and elapsed time. Tool activity
  labels can contain commands and paths, so render them only inside the closed
  execution-details disclosure. Preserve actionable blocked/waiting states and
  keep observation independent from cancellation/retry. Verify RunActivityStatus.test.tsx.

- Initial computer assignment may ignore only the automatic created/waiting_input
  introduction on an unprovisioned, unoccupied team placeholder. Never relax
  active-run blocking for user questions, queued/running introductions, provisioned
  machines, controls or execution leases. Preserve the original run and reply flow;
  verify initial-computer-assignment.test.ts and the real API fixture.

- Remember native computer permission by the authenticated account and configured
  server, independently of transient sessions, Spaces and transport credentials.
  Revalidate identity before restoring a remembered grant. Revocation must clear
  local and account grants, and a stale account record must not revive revoked
  local access. Keep consent records native-only and test host-computer.test.ts.

- Build future Desktop releases from this canonical nested workspace, including its
  npm lock and current sources. Ordinary and unified installers run the same
  beforePack continuity gate: web, native host and local backend must have fresh
  release-inputs.json receipts matching the current sources, version and bundles.
  Build the local backend separately with `npm run build:local-server --workspace
  @rakazo/desktop`; invoke it through npm so its locked toolchain is inherited.
  Do not copy installed repairs or older candidate dist files into a new release.
  Keep com.mycellios.agent.desktop and the Mycellios Agent userData path stable;
  preserve profile/workspaces, account permission and existing projects on upgrade.
  A version-bound local UI override expires on a version change and the new bundled
  UI must retain bootstrap and compact activity behavior. Verify
  upgrade-continuity.test.ts, package-metadata.test.ts and
  scripts/release-continuity.test.mjs with the affected native/web/API tests.
  Development source snapshots exclude generated Desktop local-server trees,
  retained/partial build recoveries and out directories; these runtime resources
  are packaged separately. Preserve actual source files and existing user projects.
  Desktop packaging builds web with --desktop: root assets for the managed local
  stack, plus web/first-party for the exact https://www.mycellios.com/agent namespace.
  Packaged first-party UI survives expiry of profile overrides; API/RPC/OAuth and
  other sites still use the network and existing origin-specific session. Do not
  replace a self-hosted server's UI with the official bundle.
  Integrate older capability candidates by feature hunks, preserving current retry,
  computer-error recovery, model defaults, contribution RPCs and project-browser
  behavior. Keep existing tests alongside new ones; composer and repository tests
  must still pass with the new native capabilities and project_prepare filtering.
  Windows packaging may retry only transient EBUSY file-copy failures, with a
  bounded delay and attempt count. Keep every other filesystem error fatal and
  preserve the normal copy functions outside packaging. Verify
  scripts/windows-copy-retry.test.mjs when changing this handling.

- A remembered native account/server grant connects the PC independently of the
  visible chat and requesting client. Keep account presence in native main,
  authenticate each current member Space separately and lazily admit only owned
  bots on the server. Browser, PWA, mobile and scheduled jobs use this same relay;
  never require their renderer to bind a bot or receive the host bearer. Preserve
  physical-device, session/generation and offline-expiry fences and never replay
  uncertain commands. Saved Team/dedicated workspace policies remain unchanged.
  With remembered consent, closing Desktop hides its window and retains drafts;
  packaged Windows login startup restores the connection. Explicit tray Quit
  disconnects; revocation disables host access and background login startup.
  Verify account-computer.test.ts, account-computer-background.test.ts and the
  native/API/broker desktop-relay tests, plus upgrade-continuity.test.ts.
  Native ES module bundles retain the existing createRequire banner for CommonJS
  runtime dependencies; qualify compiled module evaluation as well as syntax.
  Resolve shared root protocol dependencies through the Agent build's own pinned
  node_modules as well, so native bundling does not require a parent install.

- Repository-root `.github/workflows` owns Mycellios CI and publication. Nested
  `.github` files here preserve the imported upstream CI reference for offline
  security-boundary tests; they do not execute as workflows in this repository.
