- Model lists follow upstream releases at run time, as the reference app's auto-updated engines
  do (behavior reference only; its code is PolyForm Noncommercial and not copied).
  `models-dev.ts` reads the public models.dev catalog as data only (bounded, cached,
  last-good copy, off with RAKAZO_LIVE_MODEL_CATALOG=off) and adds agent-ready models
  of connected providers that bundled Pi lacks, on that provider's own protocol and
  host. ChatGPT sign-in keeps its account catalog, whose Codex client_version comes
  from npm with a pinned floor; the managed provider and compatible endpoints are
  unchanged. Claude sign-in (OAuth) requests likewise send the Claude Code version
  from npm with a pinned floor (`pi-claude-code-version.ts`) instead of Pi's bundled
  one, which Anthropic rejects for newer models; verify its test with pi-runtime. `model-listing.ts` sets New/Older from release dates; saved choices stay
  in the main list and search shows everything. Verify models-dev, model-listing,
  models-dev-runtime, pi-codex-catalog and chat-model-picker tests.

- Cadencia is a trusted first-party Hifa Store app, not a published HTML bundle.
  Keep imported media, DSP workers, auditioning and codecs browser-local. Limit
  clips to five minutes/250 MiB; preserve source audio rate and one compacted
  audio/video timeline. Sustained-vowel proposals are acoustic candidates requiring
  individual opt-in, never word alignment or a linguistic diagnosis. Keep original
  files unchanged, review/export invalidation, cancellation, URL/codec cleanup and
  account/Space-scoped memory-cache/reload guards. Verify Cadencia signal, timeline,
  close/cache/UI tests and actual browser export/re-import; retain the pinned media
  dependency/license and synthetic demo provenance. No remote media fallback.
  The loaded editor groups preview and closed waveform/detection disclosures
  beside a compact editing panel with time saved, Create/Download and visible
  cut review. Stack the panels by available container width. Keep per-cut
  audition and precise bounds revealed only on selection. Display bounds
  in seconds with 0.001-second precision; retain explicit vowel opt-in and stop
  audition when its review panel closes.

- The distributable Android host lives in apps/android and packages apps/web unchanged.
  Native push uses data-only Firebase HTTP v1 messages, the fixed first-party session
  registration endpoint and encrypted session-bound FCM device records. Keep Expo
  tokens separate. Build with the four MYCELLIOS_FIREBASE_* public client values;
  ANDROID_FCM_SERVICE_ACCOUNT_JSON belongs only to API/worker secrets. Initialize
  Firebase in Application for background process starts. Never return tokens or
  cookies over the WebView bridge. Preserve account/epoch checks, deduplication,
  foreground suppression and validated internal notification destinations.
  Keep com.mycellios.android separate from the legacy Expo preview and use a durable
  release signing key, never the preview/debug certificate. Native capabilities use
  WebViewCompat messages with exact HTTPS origin, main-frame and packaged chat-route
  checks; external pages receive no microphone bridge. Preserve shared reviewed voice
  and Send nonces, foreground-only capture, permission denial and Recents replay guards.
  Do not register a service worker or use web reload updates over packaged assets.
  Build with scripts/build-android-release.sh and verify scoped web/Java tests, APK
  signature, source seal, manual update continuity and physical Quick Tap separately.

- The main, development and floating Desktop preloads publish the same scoped
  API under both bridge names during migration. Renderers prefer the Mycellios
  bridge. Preserve the floating window's narrower methods and keep both names
  out of unprivileged previews. Check preload, desktop, RPC and PWA tests.

- Expo mobile registers both app-link schemes and routes notifications from either.
  Native Android Expo notifications and Maestro flows use Mycellios links and
  the current Expo app ID. Keep old callback URLs
  working while deployed servers and supported builds still use them.

- Native Expo sign-in may share the configured HTTPS OIDC issuer origin with Agent.
  Its authorization proxy accepts only the configured issuer authorize path, client,
  callback, S256 challenge and live server-issued state/nonce. Preserve the upstream
  external-provider flow. The auth allowlist accepts the Mycellios sign-in and
  account callback authorities alongside the installed app scheme. Keep the
  Expo client on the previous URLs until compatible servers are live. Verify
  packages/auth/src/oidc.test.ts and apps/api/src/auth-origins.test.ts.

# AGENTS.md

- Manual context compaction is for idle, owned Pi chats and side conversations.
  The background job checks the message sequence, summary cursor, generation and
  queue before summarizing and again before replacing the local summary. Keep
  recent messages verbatim, preserve the visible transcript and meter a bounded
  model call. Do not export manual summaries to semantic memory. Verify
  history-compaction, NewChatControl and the mobile conversation browser fixture.

- Team app builds follow the reference app's bot-crew preview (behavior reference only, no
  copied code) through specs/mico-team-build/spec.md. Presence is transient: the
  worker publishes it on the realtime fanout only after an authorized app_read/
  app_write commits, never content, never from clients or models; webs.presence
  streams it to the app owner with session/ownership rechecks. webs.team counts
  real running/queued runs, not presence. The locator script is preview-only and
  answers only its parent; the host accepts replies only from its own iframe and
  cursors never take pointer events. "Construir con equipo" only drafts an editable
  request. Verify hosted-app-presence, web-presence, preview-locator, TeamPresence
  tests and scripts/verify-hosted-webs-db.ts.

- Artifact share links follow specs/artifact-share-links/spec.md. Only the owner
  creates, moves or revokes a link from the Library (`artifacts.share/unshare`);
  Micos have no share or publish tool. One unguessable token per artifact family,
  pinned to the version shared; revocation and artifact deletion end it. The
  public `/api/shared/<token>` route is sessionless, mounted before CORS/auth,
  reads in system context and keeps every response under `SHARED_ARTIFACT_CSP`
  (opaque origin, no network, no forms, noindex). Render inline only the listed
  safe types; everything else downloads. Verify artifact-shares and
  ArtifactShareButton tests plus scripts/verify-artifact-shares-db.ts.

- Word (.docx) attachments preview in the chat file card, review workspace and
  Library, as the reference app's file preview does (behavior reference only; no
  copied code). `lib/docx-preview.ts` bounds the file (20 MiB, declared ZIP
  expansion), converts it with the pinned mammoth in a terminable module worker,
  keeps only embedded raster images and sanitizes the HTML with a private DOMPurify
  allowlist before DocxViewer renders it with app tokens. Never fetch linked
  resources or run document content; failures show the existing error with the
  download kept. Shared links keep downloading .docx. Verify docx-preview,
  DocxViewer and the media-preview E2E.

- PC app control (`pc_windows`, `pc_snapshot`, `pc_act`) follows
  specs/desktop-accessibility-control/spec.md. Desktop runs the pinned agent-desktop
  CLI (`app-control-runner.ts`, SHA-256 verified before every call, Windows x64 only)
  from resources/app-control with a minimal environment and a private state folder
  that the CLI itself creates. It is offered only while the owner's separate native
  opt-in is on (bound to host consent, cleared on revocation) and never to routines,
  webhooks, takeovers or project sessions. Text goes on stdin; never pass --headed.
  pc_act always asks for approval; only refs from the host's own snapshots are
  accepted and Mycellios, password managers and security prompts are refused.
  Report an action as done only when the result is confirmed. Verify app-control,
  host-app-control, executor-readonly-approval and windows-installer tests; unit
  fixtures do not qualify a real installed Desktop session.

- read_video follows the reference app's video reading (behavior reference only; its code is
  PolyForm Noncommercial and not copied). `packages/adapters/src/video-reader.ts` runs
  in the worker: a pinned yt-dlp verified by SHA-256 before use, site extractors only
  (`default,-generic`), a public-address check before any command, 500 MB/720p and
  15-minute bounds, a private temporary folder removed afterwards, and ffmpeg for
  frames and audio (the compose image installs it; without it the tool returns text
  only). Captions come first; speech uses only the owner's Voice connection
  (`video-transcriber.ts`), never another payer. It shares web_fetch's per-site
  approval through `SITE_FETCH_TOOL_NAMES`. Page text is untrusted data. Verify
  video-reader, approval-ask, action-approval and executor tests; fixtures do not
  qualify a real download.

- Silent delivery does not disable continuation of durable authorized work in Pi
  or native runtimes. Keep scripts, ephemeral setup/retrieval/compaction and
  one-shot internal generations outside that loop. Retain persisted continuation
  counts, Stop, approvals and ordinary Credit admission on every model call.
  Pi shares the task tool budget across the parent and subagents. Plan updates
  and internal tool discovery use a separate cap of max(8, configured limit).
  Give the model the remaining task budget so it can prioritize verification and
  close its plan. A committed `ask_user` answer starts a fresh budget once for
  that checkpoint and retains the plan and prior tool results. Automatic plan
  starts, approval replays and retries keep their existing budget. Verify with
  the Pi checkpoint, catalog and tool-dispatch tests.
- `await_event` parks a private Mico request as a `waiting_event` child of the
  existing Task tree. It waits for an owned run, the next owned routine result,
  or a bounded future time; external events use the existing routine ingress.
  Reconcile under the same scoped work lock, fence the source run, and return
  failures/expiry without claiming success. Pause/cancel prevent wakeups; no new
  scheduler, credentials or model polling is involved. Apply the additive
  `20261116150000_event_wait_delegation_state` migration before enabling waits;
  it extends the existing delegation-state CHECK without changing older states.
  A wait wakes its request once, in its conversation (reopened if archived), and
  that turn gets the original request and the saved note as data. The conversation
  shows an "Open waits" card (waiting, paused, woke, continuing; Show the request;
  Cancel the wait) and the Conversations pane marks it. closeEventWait serves the
  card and close_wait under the same lock: it reuses the tree cancellation, ends a
  parked request with nothing else pending without a turn, and never reports a
  woken wait as cancelled. list_waits/close_wait reach only the Mico's own waits
  (other conversations only where its history reaches) and are idempotent. Archive
  keeps a request parked only on waits; Stop cancels it. Long-job guidance (check
  within ~15 minutes in the turn, otherwise a wait; never sleep loops or provider
  schedulers) goes with await_event. Inspect through
  `work_status`; validate with `scripts/verify-autonomy-waits-db.ts` on its fresh
  disposable loopback cluster, the event-waits/work-continuation, OpenWaits and
  executor-agent-tasks tests and `node scripts/verify-mico-tasks-ui.mjs`.
- Fresh routine sessions receive only a bounded, redacted historical handoff from
  their owned routine thread. Respect its first readable sequence, omit system
  messages and unrelated chats, and treat history as data rather than approval.
  Verify routine-context and native/Pi runtime continuation fixtures separately
  from live-provider inference.

- Native companion windows stay hidden until their own main renderer acknowledges
  the populated first frame. Keep background painting enabled and showInactive;
  never focus another app or broaden the companion bridge to fix visibility.
  Resolve window icons from packaged dist/assets as well as development assets.
  Development Electron uses a separate Windows AppUserModelId ending in .dev;
  keep the packaged upgrade identity unchanged to avoid shortcut/icon collisions.
  On Windows, the existing Koffi fallback may mark only the companion's own HWND
  topmost, without moving, resizing or activating it. Keep this native call fixed
  in the main process. Verify floating-window, desktop-companions,
  companion-renderer, window-icon and floating-chats tests.

- `/demo/<event>` is a bounded public guest surface, outside the normal SessionApp
  gate. Keep its coordinator cookie scoped to `/mobile/v1/demo/<event>`; the Dev
  proxy forwards only this cookie and strips all Agent cookies. It never creates
  an SSO session or exposes supplier keys. An operator-keyed handoff may create
  an isolated temporary Agent profile in the normal panel, retaining the same
  native grant and guest. Each guest receives the idempotent ten-role demo company
  once, with fixed free welcome messages and one shared wallet/connection. Preserve
  existing Mico ids, edits and archived roles on repeat admission; never start
  greetings, delegated work or additional credit grants from provisioning. Its tab header selects only its separate HttpOnly
  cookie; expiry and worker admission are enforced server-side. Guest balance and
  Play/Pause stay in the normal sidebar. Refresh the authoritative wallet after
  live terminal chat events with bounded reads, never client-predicted debits or
  balances. Keep the visible guest heartbeat read-only while SessionApp is open;
  never reenroll or start inference from polling. The presenter receives pseudonymous telemetry only. Its live count and grid show
  current presence or connected work, not cumulative admissions; hide stale live
  state on read failure. Keep inference totals separate from online attendance. The presenter mycelium is
  an illustrative peer mesh with stable ordinal positions, never measured routes.
  Only real working state animates traffic; pause visual motion independently of
  compute, and respect hidden/offscreen/reduced-motion states. Verify its focused
  layout/component tests and `scripts/verify-event-demo-presenter.mjs`.
  Preserve stable message IDs, read-only recovery and explicit opt-in for the
  small browser model test. Never portray managed DeepSeek chat as browser work.
  Verify event-demo client/proxy tests and actual mobile/desktop guest/presenter
  browser fixtures, plus the separate pinned-model inference qualification.

- ServerConnections stores only device-local connection metadata. Native reads
  and edits require the owned main frame; labels/colors never edit a remote
  server identity or grant administration. Preserve the native work/draft/call
  switch guards and origin-specific sessions. Browser connections open a separate
  tab without an opener, account data or credential copying; require HTTPS off
  loopback. ServerConnectionDialogs lives once in Shell, outside responsive rails
  and menus: preserve unsaved edits on resize, clear on account changes and fence
  late closes by request ID. Current-server notification actions use the existing
  authenticated account policy, preserving Mico overrides. Do not represent
  Space ownership or a deprecated deployment owner field as server administration.
  Shared server capabilities require their own authorized backend implementation.
  Verify server-connections/dialogs, native directory/IPC and setup/preload tests.


- Supermemory reads both container namespaces and writes new memories under the
  Mycellios prefix. Purge both prefixes for the same explicit history generations
  and leave durable memories untouched. Check the focused Supermemory adapter
  tests. Preserve dual reads and purges in any rollback once new writes begin.

- Local memory keeps existing Markdown documents/revisions. General notes are owned
  by user and Space; Mico notes span that Mico's conversations; task notes require
  the current main/task thread and use a tasks/<thread>/ path. Isolated scope excludes
  general notes in context, search and tools, including inherited Space defaults.
  Messaging channels must never receive personal memory tools or background reviews.
  Essential selection is revision-guarded and capped at 8 KiB per scope; searchable
  memories use local lexical relevance and bounded snippets, with no embeddings.
- memory.review runs outside the answering turn after 20 turns or 15 idle minutes
  with at least three new user messages (configurable/off). Archiving an owned
  conversation makes an otherwise eligible review due immediately with the same
  three-message minimum. Check for pending deletion before submitting a review
  and take the source thread lock before applying facts to defend against
  a concurrent delete or context change. Use only the Mico's
  existing first-party model with a verifiable Credit quote; no unpriced fallback.
  Defaults reserve at most 0.01 Credits per Space/UTC day, 0.002 per review. Claim
  worst-case cost transactionally before a single paid POST, retain uncertain
  reservations and reconcile the same key without replay or payer/model switching.
  Review snapshots/results use Space content encryption and owner RLS; automatic
  changes must respect user-controlled notes, edits/deletions and context resets.
  Verify scoped memory/review/UI tests and scripts/verify-local-memory-db.mjs
  (MEMORY_TEST_EPHEMERAL=1 inside disposable Linux CI; local uses an isolated DB/role
  on project-preview, never live memory). Keep full suites paused.

- Web entry keeps its React root in HMR data and disposes entry listeners on
  replacement; never create a second root on the existing container.
- On Desktop startup, a bundled official cloud page that never mounts can retry
  once on the original HTTPS protocol in the same native session. Preserve
  explicit local renderers, self-hosted servers and connection-switch behavior.
- Cold-start session/bootstrap/navigation reads use startup-fetch with a 15-second
  deadline so a stalled connection reaches existing retry/error handling. Preserve
  caller cancellation and keep auth writes, paid requests and event streams outside
  that deadline. Qualify first language entry and returning-user Settings navigation.
- While route or panel content first loads, reuse the kit's Skeleton through
  LoadingSkeleton with the destination's layout. Retain populated content during
  background reads and preserve errors, empty states and in-progress actions.
  Desktop preloads the Settings overlay after the usable shell paints, then mounts
  the resolved component directly. Preserve cold-open fallback and chunk recovery.
  Cache system fonts for the renderer session and refresh conversation voice readiness
  on successful Voice edits, independent of section navigation.

- Desktop navigation keeps server connections in the narrow rail footer and the
  active workspace in the sidebar header. Keep server management out of the
  desktop workspace picker; mobile retains server access in its navigation menu.

- Mico response style (natural by default, or classic) is stored in account
  Mico defaults and delivered on each run. Checkpoint resumes use current supplied
  instructions, preserving visible history/tool results and dropping old signed
  reasoning when the system prefix changes; never replay completed effects.
- Everyday Mico replies use the shared compact policy in
  `packages/adapters/src/conversation-style.ts`. Deliver it with each run through
  `mico-behavior.ts` and refresh its known legacy paragraph on runtime resume,
  preserving user instructions and tool guidance. Explicit requests for detailed
  work override the default. Keep approvals, costs, failures and unfinished work
  visible; never enforce brevity by truncating replies or lowering output limits.
  Check the focused conversation-style/Mico behavior tests and provider delivery
  fixtures; a fake provider verifies delivery, not a live model's compliance.
- Mico replies follow the reference app's natural/classic behavior. The reference app is PolyForm
  Noncommercial: use it as a behavior reference only and write every prompt, label
  and line of code in our own words. Pi repeats the natural first-line rule as a
  `<mycellios_turn_style>` block before each user turn (not for scripts, silent runs
  or compaction). Delegated work answers with DELEGATED_RESULT_FORMAT (Status/Result/
  Evidence/Unblock) and the requester retells only the outcome, naming the teammate.
  In natural style the web transcript (`lib/natural-turn.ts`, MessageView) shows the
  notes written between steps as small action-free lines without filler or repeats,
  one merged steps summary, then the complete answer; a live answer is held until the
  turn completes, and a finished turn with nothing after its last step answers with
  its latest note. Durable progress messages skip filler and repeats
  (isRedundantProgressNote) and carry `progress: true` (from the user-progress
  nonce) so natural style draws them as action-free notes. Classic keeps the earlier
  transcript. Two or more consecutive Mico-to-Mico receipts fold into one
  "N messages with …" row (peer-exchange-groups); jumps open the row first. Pi and
  native runtimes both repeat the turn-style reminder. update_work_plan becomes a
  `plan` block leading the final message (PlanDisclosure: folded "{done} of {total}
  tasks done"). With showPlan on, direct user runs get `acknowledge_request`: a
  pausing ask with a `plan` field, fixed start/alternative/cancel answers and a
  server `plan.autostart` job after the owner's planAutoStartSeconds (default 10; null
  waits for a person) that answers only through the fenced commit with the internal
  autoStart flag, never from client input. reconcilePlanAutoStarts restores lost jobs.
  update_work_plan also travels on agent.tool.called so the live task list stays open
  (withLivePlan in web and core projections). The Android host and PWA use the web
  transcript; the legacy Expo preview shows plan-card steps on its ask card.
  Unknown run errors show their own text only when short and not technical or vague;
  WORK_INCOMPLETE has its own sentence. Notifications use notificationLead (whole
  leading sentences, 200 characters). Verify natural-turn, message-view,
  peer-exchange-groups, PlanCard, plan-card, user-progress, run-error,
  markdown-plain, conversation-style and bot-messages tests.

- The Hifa Store library unifies hosted static apps and fixed Desktop app launchers.
  Hifa Store is available by default for the independent app launch.
  `VITE_MYCELLIOS_HIFA_STORE=false` explicitly pauses it, retaining the disabled
  navigation and direct-link placeholder without mounting HostedWebs. Preserve
  independent Integrations/Micos/Skills sections and the separate routine and
  workflow gates. New app implementations ship as independent static bundles,
  outside the host repository, through the existing owner-scoped publication API.
  Verify hifa-store and MarketplaceWorkspace tests. A published revision may carry
  only owner-granted `downloads` (`allow-downloads`) and `storage` (host data
  bridge, no header) capabilities; never add `allow-same-origin`, popups, forms,
  navigation or device permissions to hosted content. App data stays in
  `hosted_web_data`, scoped by the host to app/user/Space/preview; the bridge must
  answer only its own iframe. Draft saves, Mico edits and restores record encrypted
  snapshots in `hosted_web_snapshots` (newest 50); restore never publishes.
  Large app files (`files`) stay unavailable unless the operator sets
  MYCELLIOS_HOSTED_WEB_FILES_ENABLED=true with object storage; never local disk,
  never raise the 25 MiB/250 MiB defaults, keep tombstone cleanup for every delete.
  Check hosted-webs capabilities/bridge/DraftHistory tests and
  scripts/verify-hosted-webs-db.ts on embedded PostgreSQL.
  Routines UI is also available by default; `VITE_MYCELLIOS_ROUTINES=false`
  explicitly pauses it. While paused, keep rail/overflow entries visible with
  Coming soon, gate direct routine links/editors before mounting them, and show
  the same notice in the computer panel. `?routine=` links (Schedule, search)
  resolve through `lib/routine-link.ts` and open the editor that the computer panel
  and Routines page open (`?routine=new` is a new draft). Preserve saved routines
  and backend scheduling either way; this is a UI gate, not a cancellation of
  existing jobs. Verify RoutinesAvailability and routine-link tests.
  Workflows uses the same opt-out pattern: `VITE_MYCELLIOS_WORKFLOWS=false`
  explicitly pauses it. While paused, gate direct workflow links before mounting
  WorkflowWorkspace and keep navigation visible with Coming soon. Preserve saved
  workflows and backend execution either way. Verify WorkflowsAvailability tests.
  Marketplace has no workspace-rail or More-menu entry, including the unpinned
  footer fallback. Preserve its routes/features and legacy pin preferences;
  a saved Marketplace pin must not restore a visible navigation entry.
  Use marketplace/StoreAppHeader for app titles and the return to Hifa Store;
  keep unsaved-work guards on that return action. Estudio IA distinguishes a
  disabled service, missing account connection and temporary catalog failures;
  catalog retries only discover models and never submit generation or checkout.
  `MYCELLIOS_MEDIA_STUDIO_ENABLED=true` enables only the authenticated media proxy;
  project-local sets it explicitly. Catalog admission, quotes, reservations and
  settlement remain on the canonical user's Credit wallet. Never substitute a
  personal provider key, fixture model or operator-written price for admission.
  Respect the configured AntSeed upstream without a fallback to OpenRouter.
  Public network advertisements do not authorize paid media: the gateway's own
  key scope, enforced supplier bounds and complete attributed receipts must qualify.
  Render all catalog entries through marketplace/StoreAppCard so cover, title,
  description and footer geometry stay shared; keep secondary actions in menus.
  Estudio IA is a catalog app; reserve the Store toolbar for Crear app. Keep its
  explicit price confirmation and hide recharge when no usable catalog is loaded.
  Keep their execution boundaries separate. Cadencia and Desktop launchers share
  the directory; legacy cover artifacts remain private to their account/Space.
  Cover editing belongs inside the creator's app editor, never on Store cards.
  Built-in apps expose no user cover editor. Community covers use one validated
  raster file in the encrypted draft and become public only through the existing
  immutable publication pointer. Keep creator/Space checks in every write path,
  including legacy appCovers.set; an artifact ID never grants public access.
  A community list failure must not hide browser-local tools. Owners upload bounded static
  files, edit encrypted account/Space drafts and explicitly publish immutable
  revisions. Preserve mandatory `sandbox allow-scripts` response headers without
  same-origin privileges on documents, assets, errors and previews. Public DTOs
  omit account identity and private source; preview capabilities expire and
  recheck membership. Relative directory links must preserve `/agent` routing.
  Keep unsaved editor source in the existing account-scoped memory cache across
  internal navigation, and retain web/Desktop update guards until it is saved.
  Verify hosted-webs admission/template tests, editor-state/composer/update tests,
  `scripts/verify-hosted-webs-db.ts` and actual browser file/module isolation.
  App authoring uses a persisted owner/Space-scoped Mico and independent task
  conversation. app_read/app_write resolve from the actual run and binding;
  recheck membership, assignment, bot and run before accessing the encrypted
  draft. CAS prevents lost edits. Reassignment revokes prior access; tools never
  publish. A Mico delegated from the bound request reaches the same draft only
  through its exact live started child run (specs/mico-team-build/spec.md); paused,
  stopping, cancelled or archived work and other requests are refused. Optional
  per-file expectedFileSha256 lets teammates write different files concurrently;
  site:<file> delegation resources serialise teammates on the same file. Reuse thread streaming and TaskComposer; preview follows saved draft
  versions without overwriting dirty manual edits.
  Local qualification is not public production publication.

- Contribution-funded network speech uses deployment-owned
  MYCELLIOS_NETWORK_SPEECH_IDENTITIES and the scheduler's authenticated pinned-edge
  policy. Keep placement out of HTTP input, refuse missing/invalid placement before
  inference, and never fall back to legacy CPU replicas or another funding source.
  Qualify real WAV output, the debit, provider transfer and balanced settlement;
  an advertised model or completed job alone is not economic qualification.

- Conversation pending sends are local presentation scoped to account/Space/thread.
  Match durable echoes by client nonce or acknowledged message ID, never by
  text. Preserve existing draft/attachment recovery and nonce reuse on retries.
  Send receipt message IDs are independent of event cursors; do not alter transcript
  ordering or use a colliding sequence number to infer acknowledgement.
  Coalesce only progress presentation to animation frames; reduce all events in
  order and update the authoritative reference immediately. Flush structural,
  terminal, navigation and preference changes without waiting for a frame.
  New-reply/send/control motion must preserve reduced motion and history scroll
  ownership. Loading an earlier page belongs to the current conversation visit.
  Message links into folded routine history reveal the exact run, and completed
  natural replies retain visible symbols such as emoji. A failed run with an empty
  transcript shows its actual state alongside the composer recovery controls. Run focused
  composer/thread/pending/frame tests and
  `node scripts/verify-chat-fluidity.mjs --output=...` for actual browser components
  with synthetic delivery/progress. This does not measure a live model's latency.
- Chat routine mentions are a single owner- and Space-scoped summary read, triggered
  by the composer mention search. Do not fetch routine lists for the entire roster
  on chat entry. Check composer/query tests and `scripts/verify-routine-isolation-db.ts`.
- The chat task menu shares its in-flight and recent overview poll across chats in
  the same account and Space. Preserve the periodic refresh and the per-thread
  notification filter. Check the query-scope tests when changing this path.
- Space navigation skips a browser transition that cannot capture the old
  screen. Preserve the single guarded commit, Space-scoped state reset and
  late-callback regression in `lib/space-switch.test.ts`.

- Production English messages with interpolated values must exist in
  `apps/web/src/locales/en/messages.po`; production macros omit development text.
  Verify compiled messages without a fallback in `i18n-catalog.test.ts`.

- MCP stdio launch arguments remain unchanged for the child, but explicitly named
  credentials must join output/error/log redaction. Omit tool names or schemas
  that contain those credentials rather than corrupting JSON Schema with replacement
  text. Verify `mcp-launch-secrets`, MCP connector and OAuth tests.
  Browser MCP authorization URLs have a 16,384-character budget after added scopes
  and parameters; resource/fetch URL limits and private-egress authorization stay
  unchanged. Auto Review accepts one complete flat verdict (optionally JSON-fenced);
  duplicate keys, surrounding text, unknown fields and malformed values require
  the existing owner-approval fallback. Verify auto-review and factory tests.

- Tailscale connections use the optional private Linux gateway in `infra/tailscale`.
  Each user/Space/network owns a userspace device; never enable global private
  egress or join customer routes to the API/worker host. Require both the network's
  Mico allowlist and existing MCP/tool assignments. Revalidate cached sessions,
  membership, company policy and exact MCP binding at every request. Private OAuth
  origins require explicit per-MCP grants. Never fall back to public egress after
  a private connection fails. Verify tailscale contract/adapter, MCP connector/OAuth,
  gateway and deployment tests, `scripts/verify-tailscale-db.ts` and
  `scripts/verify-tailscale-ui.mjs`. Fixtures do not qualify real Tailscale consent.
  The gateway qualification workflow builds the exact Docker image and tests a
  real ephemeral Headscale-controlled Tailscale network. Its private MCP fixture
  listens only on peer loopback; `scripts/verify-tailscale-live.ts` uses isolated
  PostgreSQL and the actual Mico connector. Never run its fixtures on production.
  Headscale transport evidence does not certify Tailscale SaaS browser consent.

- The workspace selector opens Space settings independently of personal Settings.
  Bind each Space panel and its writes to the Space being edited, even when the
  open conversation belongs to another Space. Preserve account model credentials
  and per-Space inheritance for model, voice and approval preferences.

- People in Spaces follow specs/space-members/spec.md behind MYCELLIOS_SPACE_MEMBERS_ENABLED
  (off by default; MYCELLIOS_SPACE_MEMBER_LIMIT people, 20 by default). The owner or an admin
  of a Space other than Personal invites by email or a one-use link valid 7 days; store only
  the token's SHA-256 and keep the token in the link's fragment. Accepting runs as system,
  binds an email invitation to that verified address and adds a `member` organization and
  Space membership; the default-Space trigger joins owners only, so nobody reaches a Personal
  Space. Nobody removes or changes the owner; only the owner changes roles. A non-owner
  reaches only `spaces.members.*`/`spaces.invites.*`/`spaces.shares.*` and `sharedMicos.*`
  there (`assertSpaceRoleAllows`) and no route outside RPC: their own identity would read Space
  rows and spend the owner organization's Credits. Membership is read per request, so removal
  and leaving end access at once. Audit changes in `security_events` with names, never addresses.
  The owner or an admin shares a Mico (`mico_shares`, default none, chat level) with people
  or everyone; `sharedMicos.*` resolves that share on every call and runs as the Mico owner's
  tenant on the member's own side threads (`Thread.memberUserId`) only, never its main chat,
  settings or computer. Messages and runs name the member (`authorUserId`,
  `requestedByUserId`). Any run in such a thread is a member turn: Pi only, no computer,
  memory, reviews, connections, secrets, schedules, other Micos or backups, only
  `MEMBER_RUN_TOOL_NAMES`, and only hosted Credits; each paid call rechecks the share and holds
  against the member's UTC-day allowance under the account lock. The owner reads those threads
  but never writes, answers or marks them read; they stay out of the owner's counts and
  notifications. Unsharing, removal and leaving cancel the person's queued turns. Verify
  scripts/verify-space-members-db.ts and the space-members, executor-space-members,
  model-credit-observer, SpaceMembersPanel, SpaceInvite and switcher tests.
  The chat provider/model selection owns execution: saved API/OAuth connections
  use Pi automatically; installed account providers are selected in the same
  model menu. Do not expose a second Agent engine switch in Mico settings or
  select an unrelated CLI merely because a PC is connected. New Micos inherit
  the general connection unless the user selects an installed provider, except
  a new This PC Mico created with no model or engine: it starts on the first CLI
  in the order Claude Code, Codex whose sign-in that PC confirmed
  (localEngineForNewMico, specs/local-engine-default/spec.md), keeping the
  general model as its server fallback. Unknown sign-in, an older Desktop, no
  answer, OpenCode (no sign-in report) and idempotent spawnKey creates keep Pi.
  Existing This PC Pi Micos move once the same way (bots.adoptLocalEngine, called
  by Desktop per account/Space start): only idle ones (no active run or unfinished
  delegated work, checked under the bot row lock), recorded in
  bots.localEngineAdoptedAt so a later manual choice is never overridden, with a
  system note in the main chat. Verify local-engine-adoption tests.
  Conversational turns capture the resolved model, engine and owned connection
  before their first model call, with the Run lease fence. Resume uses that
  selection and rechecks credentials and native consent. A later turn reads the
  saved Mico settings. Native session changes carry conversation history into a
  fresh session in the same workspace. Verify executor-turn-checkpoint, the
  native runtime protocol and verify-message-queue-db on isolated PostgreSQL.
  The account catalog resolves expired managed metadata with one owned GET refresh
  and a reread of the canonical enabled list. Inventory never authorizes models;
  retain the shared deadline, native results and fail-closed price filtering.
  Model-read failures use the shared localized error text and explicit read-only
  retry, including the compact default-provider selector. Failed catalog/credential
  reads must not appear as an empty or disconnected provider directory. Recovery
  preserves open connection fields and scoped caches, reloads the role selector,
  and never connects/disconnects providers or changes the selected model.
  The chat picker offers explicit exploration of Mycellios credits beside personal
  providers. Exploration only changes the visible catalog; it must not connect,
  save a model, replay a run or switch payer. Model selection retains the same
  Mico, conversation history, memory and computer/files. Qualify the real picker
  with scripts/verify-builtin-provider-ui.mjs and persistence with
  scripts/verify-workspace-sync-db.ts; synthetic offers are not live billing proof.
  Sidebar subscription quota reads saved OAuth accounts and the authorized native
  Codex CLI through account/rateLimits/read. Recheck native account/Space grants
  before serving cached quota; forward only sanitized limit metadata, never CLI
  account identity or credentials. Keep stale measurements visibly unavailable.
  Codex model, effort and Fast preferences live in Bot.nativeConfig, separately
  from API model connections. Read the authenticated CLI catalog and validate
  the selected model/effort/tier again in the executing CLI. Fast requests priority;
  switching it off explicitly requests default. Preserve those fields through
  Desktop dispatch and continuation turns; do not substitute an API model or
  lower reasoning effort to simulate speed. Verify native-codex-settings and
  native-agent-runtime regression tests.
  Publish live Codex reasoning activity only for the active thread and turn.
  Forward one content-free status per turn through existing progress events; keep
  reasoning fragments on the host and outside the first-response timing.
  Verify stale notification rejection and delivery through the Desktop host.
  Keep one idle Codex process for up to 30 seconds, scoped to its authorized
  account, Space, Mico, conversation and exact runtime binding. Retain its process
  slot, clear it on host disable/account changes, and reject retired turn events.
  Verify native runtime, Desktop engine and process-slot regressions. Use the
  opt-in VERIFY_CODEX_REUSE live check for first activity and first text.
  The native OpenCode engine is opt-in per Mico and uses the server's installed
  CLI over ACP. Preserve operator account/Space grants and a private CLI home per
  conversation. Keep project config and external plugins disabled and deny native
  permissions outside the approved MCP bridge. Keep the explicit MCP object
  schema root even for union schemas and expose the authorized file tools with
  descriptive bridge names so OpenCode can discover and call them.
  For Desktop OpenCode, resolve a
  project or task worktree on the native host from the existing local grant.
  Use it for the CLI and ACP working directory, keeping the private profile and
  session on the host outside the repo. Resume only with the same project binding
  and an ACP CLI that advertises session load. The chat picker discovers native
  engines from the Mico's authorized computer. An offline Desktop never offers
  the server's engines or delegates its run to them. Verify the scoped settings and
  native-agent-runtime tests. Protocol fixtures do not qualify real inference.
  Managed CLIs (specs/native-engines/spec.md phase 3) live in one store per host user,
  provider-runtimes/<engine>/<version> (Desktop's profile, a server's data folder). First installs
  use the exact npm URL, sha512 integrity and size bounds in packages/adapters/src/native-engines.lock.json
  (regenerate with scripts/native-engine-lock.mjs). Desktop updates follow the npm channel and
  target package in that lock with the same checks. Check the bundled and published blocklist
  before a managed executable starts. Existing turns keep their version and new turns wait while
  an update is being verified. The hosted native-engine canary tests each target without model
  requests. Its locked npm install is scoped to contracts and the workspace root.
  Downloads are verified before unpacking into staging, every file's SHA-256 is
  recorded and `--version` checked before the folder is used, and again before a session's first
  start. No administrator rights, global npm or CLI updater. Resolution: an absolute
  native-agents.json command, then the newer of the managed copy and PATH (the person's CLI wins
  ties; macOS/Linux add the login shell's PATH), then the managed copy. A PC installs through
  `engines.install` → the owned Desktop's `engineInstall` (`engineInstall: 1`) with the same
  This PC, owner and consent checks as `engines.account`; server hosts keep installOpenCode
  behind allowOpenCodeInstall and the account/Space grant, and the pre-store OpenCode 1.19.5
  copy is adopted by its pinned hash. Preserve operator command overrides and the no-fallback
  model policy. Verify native-engine-store, native-login-path, desktop-agent-engine,
  host-computer, the engines route tests and chat-header-model.
  Signing a PC's Codex or Claude Code in or out (specs/native-engines/spec.md phase 1)
  goes through `engines.account` → the owned Desktop's `engineAccount` method, only
  for a This PC Mico (never server, Team or isolated computers) and under the PC's
  account scope and local-access consent; the Desktop reports `engineAccount: 1`.
  `native-account.ts` runs the CLI's own login: Codex `account/login/start` in its
  app server (browser on that PC, or a device code for another device), Claude Code
  `auth login` in a visible terminal (never hidden, never typed by Mycellios).
  The CLI keeps its credentials and receives the provider's callback itself; only a
  device code leaves the PC, and sign-in page addresses are HTTPS-checked and never
  logged. One login per engine, closed after 10 minutes; sign-in and sign-out drop
  the cached probe and a pending sign-in rereads status every 2 s. Sign out asks for
  confirmation. Verify native-account, native-signin, desktop-agent-engine, the
  engines route tests and chat-header-model.
  `engines.codexQuota({ botId })` reads a This PC Mico's own PC through the
  `engineUsage` host method (never inside `environment`, so runs are not slowed):
  only a Codex whose CLI confirmed a sign-in, `account/rateLimits/read` mapped by
  `nativeCodexQuota`, cached a minute on the PC (`native-usage.ts`), checked again
  against AccountPlanLimitSchema on the server. Without a Mico it keeps the
  server's own Codex under the operator grant. The rail passes the open Mico.

- Ask aside lives in a resizable side pane, with transient state pinned to user,
  Space, Mico and task. Hiding or switching panes preserves pending exchanges;
  closing deletes them and aborts only the aside request. Move a plain text draft
  there only when it has no files. Never send, steer or stop the main task from
  the aside pane. Respect the current contextStartSeq and send-key preference.
  Side-question generations are ephemeral: meter usage, but do not write a chat
  message or a Pi session transcript. Clients send up to 20 recent exchanges when
  the capability probe advertises extended history, and up to eight otherwise.
  The server retains its context budget and model output token cap. Verify scoped
  pane/composer/API tests.

- Pinned messages are personal per account/Space/exact thread, or pinned for that
  person by their own Mico with pin_message in its own main chat or side conversation
  (`pinnedByBotId`, shown as "Pinned by {Mico}"; never in groups or outside chats).
  Mico pins count toward the same 100 per conversation under the same lock; the person
  can unpin them or adopt them by pinning, and a Mico never unpins the person's pin.
  Store references, not copied message text; preserve encrypted reads and transcript
  visibility. Resolve the thread and message before writes. Header pins use existing
  jump paging; message menus and touch actions share MessagePinsContext. The pins
  popover (phone too) also lists all of a Mico's conversations (pins.mico, newest 200,
  each with its conversation); opening another one restores it if archived, then jumps,
  and says so when the message is gone. Unpin never deletes history or starts inference.
  Check message-pins API/UI tests and `node --import tsx scripts/verify-message-pins-db.ts`
  for the real migrations, isolation, Mico pins, the combined list, FK cleanup and
  concurrent limits; see specs/agent-message-pins/spec.md at the repository root.
  Never activate its migrations outside an authorized scope.

- Mico task conversations use MicoTaskTabs: one Mico keeps independent named
  conversations behind the compact + action and the Conversations picker.
  Mico page-browser tools use a tab keyed by the server-owned conversation on
  Docker computers. A display lock serializes tab activation and CDP input.
  Preserve the browser's existing cookies and desktop permissions. Scoped calls
  require a compatible supervisor and helper; never replay against a focused
  tab on an older image. For a waiting takeover card, Open focuses the saved Docker
  tab for its exact waiting run and takes control under the existing lease. Never
  silently open another tab when that target is gone. Update the API, supervisor
  and computer image together. Verify the supervisor, helper, and browser handoff tests.
  A routine can opt into a headless browser only in its own conversation on a managed
  isolated Docker computer. Fresh routine runs that would use This PC or a shared
  computer pin a private server workspace under the run lease and use a server Pi
  model. The Mico keeps its computer assignment. Resumes keep the recorded workspace.
  Verify offline-cloud-workspace tests for assignment, ownership, and forbidden fallbacks.
  The run fence keys a separate Chromium user-data directory.
  Close it before releasing the lease and retain the helper lifetime cap after disconnects.
  Keep saved login, upload, desktop focus and download actions outside that browser.
  Qualify the supervisor fence and prove cookie/storage separation and cleanup in Chromium.
  The handoff then shows only that tab: the page-browser helper's `tab-stream` screencasts
  it over CDP through the control gateway (`tab.html`, sealed like the embed page),
  follows popups it opens and replays only validated input. It belongs to the control
  lease and stops with it; Show desktop returns to noVNC. Older images fall back.
  The phone menu groups conversations by unread, read and archived state, counts
  open conversations waiting for the person, and gives owned rows a touch menu
  with the same actions and a delete confirmation. Verify the mobile fixture in
  `scripts/verify-mico-tasks-ui.mjs --mobile-menu-only`.
  Size the visible tab subset to the measured available width, always keeping
  the active conversation readable. Overflow stays in the picker; never close
  or delete history to make it fit. Keep New conversation first in that picker.
  development.list returns each thread's server-derived kind plus its lifecycle from
  the thread itself (archivedAt, deleteAfter, a run-derived state running/queued/
  waiting/idle/closed, outcome, lastError, titleSource, startedBy, updatedAt, unread):
  the picker lists open threads by updatedAt with a ThreadStatusMark (working dots,
  queued clock, needs-you question, failed X, unread dot) and a relative time, marks
  routine, workflow and delegated threads with a short label, lists archived
  conversations last under Archived (choosing one restores it and opens its tab),
  hides deleting ones, and offers rename, archive and delete only for the person's
  conversations and the ones their Mico started. A task tab marks its own thread read once that
  task's snapshot has loaded (never on hover) and never clears the main chat's dot.
  search_history/read_history (core history-access, adapters history-tools) read the
  run's own thread. From the Mico's main chat or an ordinary side conversation they also
  list its conversations without a query (main chat and side conversations, archived
  too, never deleting ones; kind, state, outcome, request/reply previews, cursor),
  search this conversation first, then the main chat and the 8 newest side ones (each
  match tagged with taskId; 5 results, at most 10) and read any of them by taskId.
  Routine threads read only tasks the Mico opened; delegated/project threads, groups,
  outside chats, routines, webhooks and background work stay on their own thread. Same
  owner/Space/unarchived-Mico fence and per-thread New chat boundary; results stay
  untrusted. Sidebar search also returns side-conversation messages (opening ?task=)
  with kind filters, and each chat has an in-chat search (threads.searchMessages); both
  keep blind-index token matching for encrypted messages.
  The + (also Ctrl/Cmd+Shift+O, the picker and the Mico's sidebar menu) opens a draft
  tab (`?draft=1`, no thread): its composer keeps unsent text per Mico under
  `bot:<id>:new-conversation`, and its first message creates the conversation with the
  draft's stored request key (a retry reuses it) and sends through a new immutable
  client bound to that thread, which reads it first; the main chat's client never
  carries it. A refused first send removes the empty conversation; an unconfirmed one
  moves the text to the new conversation's composer. The draft tab becomes that
  conversation in place. Nothing is created for a draft that is never sent. The
  draft hides main-chat parts (transcript, Reset context, queue, reply, voice, pins)
  and never marks the main chat read. The first committed user message
  supplies the title in the same transaction, without a model request: its first
  non-empty line (else the first file name), at most 120 characters ending in "…",
  titleSource auto; later messages preserve it. Manual rename is owner/Space/Mico-
  scoped, accepts 1-120 characters on one line without control characters (the
  server explains a refusal) and sets titleSource user, which no automatic title
  replaces. Rename stays available by clicking the selected title, double click, F2,
  from a tab's context menu or the picker. Tabs (lib/thread-tabs.ts, one store per
  user/Space/Mico shared by every strip and window) keep order, the active tab and
  parked places, capped at 50 stored ids (never a limit on conversations). A tab's
  menu offers Open, Close tab, Close other tabs, Close tabs to the right, then Rename,
  Archive and Delete for own conversations; the Mico name (main tab) offers the close
  actions only. Delete/Backspace and a middle click close a focused tab, Alt+Shift+
  Left/Right and dragging reorder, Alt+Shift+Down/Up step through tabs (not inside a
  text field holding text; the roster ignores Shift for its Alt+arrow reorder).
  Archive goes through the server's stop-then-archive and closes the tab. Delete hides
  the tab at once and shows "{title} deleted" with Undo for the server's window, which
  restores it at its place; it is disabled while the conversation works and a phone
  asks first without Undo. A tab whose conversation is archived or deleted elsewhere
  closes (its open view leaves for the tab on the left) and returns on restore. A
  conversation the Mico started (startedBy agent) joins the end of the tabs in the
  background without navigating, shows "{Mico} opened this conversation" and can be
  renamed and deleted like the person's own. Below 440 px the row is a title
  switcher; below 48 px only the picker button. Side threads use the placeholder
  "Message {Mico} in this conversation", show the thread's lastError card until the
  next turn and load older messages by themselves near the top. A "thread" mention
  (same owner, Space and Mico only) stores a thread_link block shown as "Open
  conversation {name}". Verify MicoTaskTabs, thread-tabs, new-conversation, composer,
  transcript-autoload and thread-target tests.
  Edit inline: Enter/blur saves and Escape cancels; retain failed edits for retry.
  Lifecycle (thread-lifecycle in core/db, side-threads.ts in the API): archive from
  a tab, Tasks or the phone stops first (queued messages, runs, delegated work; a
  request parked only on await_event waits stays parked), retries for up to 15 s under the thread lock sends take, then archives or explains
  that the conversation still works; restore undoes a pending delete before it
  reopens an archive. Delete (conversations the person started, not app threads)
  is refused while any run or delegated work is unfinished, hides the thread with
  deleteAfter = now + 6 s (undo = restore), refuses writes meanwhile, and the
  thread.delete job or the reconciler removes it 5 s after: Mico outputs made only
  there, Pi/native session files, then the thread row, whose cascade takes messages,
  steering, runs, pins, Tasks entry and task notes. The same purge removes that
  owner's revisions sourced from the conversation. If a shared note needs
  restoring, save its latest independently sourced content as a new revision
  through encrypted Prisma, or remove the note if nothing remains.
  Uploads and outputs shown in other
  conversations stay. The main chat is never archived or deleted (also a DB CHECK).
  No open-conversation limit and nothing is archived automatically. finalizeRun,
  stopThreadRuns and expireStuckRun record outcome/lastError (2000 characters, never
  from background runs); the person's next message clears them.
  Before task navigation, including from the Projects sidebar, prime the
  destination's account/Space-scoped shell metadata and only its own cached
  transcript. Key the Projects list by the resolved Space so selecting a task in
  the implicit primary Space keeps the same list on screen. Keep immutable
  RPC/draft isolation, tab titles and open-tab state across the scoped remount
  without a whole-page loading frame.
  A seeded tab switch reads the destination's history directly without duplicating it
  through bootstrap. Cold web history and bootstrap request the recent window.
  The direct history read for a selected side conversation returns a normal
  bounded page so short conversations arrive in one response. It checks account,
  Space and Mico ownership while selecting only fields needed for the snapshot.
  Inactive threads read 24 stored messages first and can page back normally.
  Active runs and explicit history reads keep their current window. Preserve the
  snapshot cursor and avoid evicting already loaded history on this first read.
  While the first read is pending, show loading in the chat pane. Prioritize
  history over the explicit list of secondary control reads, with a bounded hold
  across rapid navigation. Resume queued control reads at most two at once.
  Start a cold same-Space history read at roster selection and consume its fresh,
  scoped result in the incoming shell. Keep writes, auth recovery and realtime
  direct. Reuse fresh model and account queries within their existing scope.
  Projects warm up to twelve conversations across folders with two concurrent
  background reads per account and Space. On the default route this starts when
  authenticated bootstrap retrieves the Projects list, while the shell mounts.
  The remembered conversation leads the initial queue. The sidebar takes over
  the same queue without restarting in-flight reads, prioritizing the intended
  folder's first two slots before giving the other folders a turn. Store only
  the conversation ID.
  Pointer and keyboard intent can warm another row. Reuse the same memory-only
  snapshot and never mark a conversation read until it is opened. Verify the
  preload limit and folder changes with SidebarProjects.test.tsx.
  Preload at most two tab/picker destinations independently in the scoped memory
  cache, including when only the active tab fits on mobile; pointer/focus intent
  may warm another destination. Pending asks are preloaded without marking them read. Roster replies target the owned task thread and scroll to its loaded card.
  Read messages, active runs, and the event cursor in one Repeatable Read snapshot
  without taking a thread row lock. Verify the navigation and lock regressions in
  conversation-tab-history.spec.ts and working-bot.postgres.test.ts.
  Verify MicoTaskTabs, query cache isolation, auto-read,
  development-conversations, side-threads, thread-deletion, core thread-lifecycle,
  DB messages and history-retrieval(.postgres) tests plus
  `node --import tsx scripts/verify-conversation-titles-db.ts` for atomicity/isolation,
  `node --import tsx scripts/verify-thread-lifecycle-db.ts` (migration backfill, archive,
  delete/undo/purge, lock races), verify-task-conversations(-route)-db.ts and
  `node scripts/verify-mico-tasks-ui.mjs`.
  In the wide header, Main chat has a fixed tab, the Mico name opens its
  settings, and All conversations sits beside the tabs. The picker marks open
  tabs independently of routine and unread status. Closing a tab keeps its
  history. Keep Create Mico separate from these actions.
  Reset context is a confirmed secondary action for the main chat only; never
  expose that endpoint from an independent task or label it New conversation.
  Verify the task navigation and NewChatControl regression tests.

- Side conversations stay visible from the main chat and the sidebar
  (specs/conversation-surfaces/spec.md; the reference product is a behavior reference only).
  The side panel's Conversations pane (from Chat tools) lists the open conversations and the
  draft by activity with ThreadStatusMark and time, "Waiting for you: N" (state waiting), and
  opens one in the chat or beside it as a pane tab (Open in the chat, Close; closing shows the
  right, then left neighbour, else the list; phones have no beside view). A beside view and a
  mirrored request each use their own immutable client bound to that thread, read first, and
  mark read only once its messages loaded. development.requests lists pending asks and takeovers
  of the Mico's open conversations (owner/Space/Mico-checked, decrypted through the client); the
  main chat shows them as compact cards that answer questions, approvals and plans only through
  threads.answer with that taskThreadId; credentials and takeovers link to the conversation.
  The roster carries unreadCount (main-chat replies after the read cursor and the person's last
  message, no progress notes, capped at 100, shown 99+) and a conversations summary (open,
  unread, waiting, working, revision) from one metadata query per list; a failed read keeps the
  roster. Rows show the number, else a numberless badge for replies only in conversations, and
  rosterRowSignal order: answer, takeover, conversation waiting, error, working, unread, then
  conversation unread. A desktop Mico row expands (stored per device) to the conversations
  needing a look plus 3 recent (Show N more/Show less), read again when revision moves. Mico Mark
  as Read uses threads.markAllRead({botId}) (main chat and open conversations, never archived or
  deleting); Mark as Unread makes the newest reply unread; the view menu's Mark all as read calls
  markAllRead per Space. "Needs you" sits above the roster only while something waits and leaves
  rows in their folders; the device filter (Micos, groups, unread, working, folders) and Recent
  activity sort are opt-in: never change the default order or grouping. The transcript shows
  "N new messages" with Jump and Mark as read while the New divider is out of sight. Verify
  ConversationsPane, SideConversationView, MirroredRequests, SidebarMicoConversations,
  BotContextMenu, transcript-new-messages, sidebar-filter, conversation-pane, needs-you,
  sidebar-conversations, roster-status, sidebar-chat-order, thread-read(-routes) and db
  conversation-surfaces tests, `node --import tsx scripts/verify-conversation-surfaces-db.ts`
  and `node scripts/verify-mico-tasks-ui.mjs`.

- A Mico opens its own side conversations with start_task/message_task/close_task
  (specs/mico-side-tasks/spec.md; the reference product is a behavior reference only).
  Offer and accept them only in its own main chat and owned routine threads, refuse them
  elsewhere with an explanation, and refuse await_event in agent-started threads. At most 8
  unfinished agent-started conversations per Mico, counted under a per-Mico advisory lock:
  no queueing, no automatic archive. The tool effect key names the thread, so retries replay.
  Turns run as agent_task through claimMicoRun (concurrency unchanged); message_task queues an
  agent_task steering row that is never claimed mid-turn. close_task stops through the
  work-stop outbox, archives within 15 s and sends no report. finalizeRun, stopThreadRuns and
  expireStuckRun queue one task_report message and run in the main chat in the same
  transaction (nonce task-report:<thread>:<run>; no report for silent, person-started without
  a waiting teammate, delegation-parked or deleting turns). Report turns are ordinary paid
  turns: normal Credit admission and observers, tainted from the start. A bot_message turn
  that opened tasks replies to its teammate only once they settle (auto-outcome key; the
  reconciler retries). A report turn that an update or lost PC connection cut off
  (isInterruptedRunError) starts again from finalizeRun's own commit: a fresh task_report run
  on the same report message (nonce <report nonce>:recovery:<failed run>, so teammates keep
  waiting), INTERRUPTED_TURN_RECOVERY_DELAYS_MS and the recovery note; never a replay, and only
  the failure that ends recovery alerts. Verify core/adapters agent-tasks, executor-agent-tasks, bot-messages,
  db events/messages, message-view and peer-exchange-groups tests and
  `node --import tsx scripts/verify-agent-tasks-db.ts`; fakes do not qualify a live model.

- Micos messaging each other and groups follow specs/mico-team-messaging/spec.md (the
  reference product is a behavior reference only). message_bot reaches 1-32 owned Micos,
  shares at most 10 workspace files as owner/Space artifacts, and takes reply_to_message_id
  and expects_reply; every recipient still gets its own bot_message turn, never a steer.
  Requests open bot_message_requests/recipients (ids and states only). Answers to a
  multi-recipient request are held and released as one turn under the request row lock,
  naming who did not answer; stopThreadRuns and the job reconciler settle stopped
  recipients, and a request nobody answered starts no turn. A bot_message turn that an update
  or lost PC connection cut off (isInterruptedRunError) starts again from finalizeRun's commit
  (queueBotMessageRecoveryInTransaction): a fresh run on the same message (nonce
  bot-message-recovery:<failed run>, INTERRUPTED_TURN_RECOVERY_DELAYS_MS, recovery note), which
  takes over the recipient row and the answers it read; the cut-off run returns no failure
  (botOutcomeReturnedAt), never a replay. Not for FYIs or turns that already answered, opened
  tasks or delegated work; only the failure that ends recovery reaches the teammate. "Waiting for replies"
  (tasks.awaitingReplies) reuses the person's Stop and the revisioned work controls
  (Continue = resume). Desktop keeps an initially open, bounded disclosure above
  the composer. Narrow main chats use one bottom sheet for replies and queued
  messages, with a compact trigger. list_agents is read-only;
  interrupt_agent stops only turns working on the caller's own messages through
  the durable Stop and refuses the rest. Groups keep a
  purpose and a person-chosen leadBotId (additive `20261123090000` migration); routing is
  deterministic (mentions, @everyone, an opening name, else the lead) with no model routing
  call; a member's history hides other members' replies to the same message; "continue"
  resumes the stopped work of the newest request; send_to_group returns answers to the
  sender's main chat; history tools stay available and the 24-task limit is unchanged.
  Verify adapters/core bot-messages, group-mentions, message-visibility, thread-target,
  AwaitingReplies, CollaborationMarker, GroupPanel and SendToGroup tests and
  `node --import tsx scripts/verify-mico-requests-db.ts`.

- Group shared folders follow specs/group-shared-folders/spec.md (the reference product is a
  behavior reference only): up to 8 folders per group, chosen only with Desktop's native picker
  after the server confirms the owner/Space owns the group; the server keeps an opaque HMAC id
  (keyed by a private per-profile key, not the host token), a name and a label it assigns once
  (additive `20261124120000` migration, RLS), never a path. Grants stay in memory on the PC like
  ordinary folder grants, are pruned to the server's list and cleared for another account. Only
  a person-started turn (own message/call/reaction, or a same-thread handoff chain back to one)
  of a This PC (`dedicated`) member in the group's own thread carries them; never routines,
  webhooks, channels, Mico requests or background work. Re-read before each computer tool; the
  PC serves only ids it holds for that group, as `group/<label>/`. Never mount them on server or
  Team computers. Shared edit_file writes carry the read SHA-256 and are serialized per real,
  case-folded file. Shells keep OS permissions; ids gate file tools only. Verify adapters
  host-group-folders and group-folders, desktop group-folder-ipc, web GroupFolders tests and
  `node --import tsx scripts/verify-group-folders-db.ts`.

- "Branch in new conversation" (specs/conversation-branching/spec.md; behavior reference only)
  sits in the More menu of the last Mico message of each finished turn, main chat or side
  conversation, on desktop/web only (not phones, groups, projects or floating chats); disabled
  while a turn runs, which the server also refuses. development.branch is idempotent by
  requestId (taskKey mico-task:<bot>:branch:<id>, the existing unique key) and copies under the
  source's thread lock the visible messages of that turn's context up to its run's end (newest
  1,000) with new ids, a branch_origin system divider, files as new artifacts and storage
  objects (nonce branch-copy:<branch>:<source>, skipped by version lookups) and the compacted
  summary only when it ends inside the copy. Never runs, usage, costs, effects, events,
  reactions, pins, read marks or queued messages. Encrypted content is read and written again
  through the client (same Space key, new row binding); never copy ciphertext with raw SQL.
  Title "{title} #N" or the person's last message, startedBy branch, titleSource auto, read to
  the end; the tab opens right after its source and the divider links back, or says the source
  was deleted (branchedFrom* are SET NULL). The first turn gets BRANCH_HANDOFF_NOTE (files were
  not rolled back). No conversation limit. Deleting a branch removes its copies; deleting the
  source never touches a branch. Verify core/web conversation-branch, message-view,
  MicoTaskTabs and development-conversations tests,
  `node --import tsx scripts/verify-conversation-branch-db.ts` and verify-mico-tasks-ui.mjs.

- New chat is distinct from Clear: retain messages with a context_reset divider,
  advance Thread.contextStartSeq, invalidate local summaries/checkpoints and rotate
  the native session binding while keeping the same workspace and Mico settings.
  Reject busy/queued resets under the Send thread-row lock and deduplicate by
  client nonce. Model history, compaction and history tools respect the boundary;
  display paging keeps earlier messages. Verify scoped DB/UI/native tests and
  PostgreSQL transaction tests with synthetic temporary tables.

- Deleting a directly sent message from an idle private chat keeps a blank
  sequence slot and the original send nonce. It removes the visible message,
  its pin, saved quote links and source prompt, and invalidates summaries,
  checkpoints and native session reuse for that context. Queued messages use
  their own controls. Verify the isolated thread lifecycle and message action tests.

- Composer audio follows one clear split: Mic dictates an editable text draft;
  AudioLines opens the voice conversation, or closes its owner when active.
  The empty composer uses Voice, a draft uses Send, and an empty running turn
  uses Stop. A turn waiting for an answer retains Send. The + menu has one Voice entry and one supported-file picker.
  Preserve recording cancellation, Space/Mico ownership and explicit Send.

- Marketplace integrations include a bundled remote MCP catalog when no managed
  provider is configured. Preserve managed-provider entries and deduplicate by
  app slug. Bind creation, OAuth and health checks to the edited Space; do not
  mark registration or cancelled authorization as connected, and do not approve
  a Mico's tool access implicitly from a catalog connection.

- Account-owned Desktop execution keeps the existing cloud account, conversations,
  model connections, leases and approval effects. Advertise agentExecution v1 only
  after the native host starts and authenticates remembered account consent.
  Desktop owns the Mico loop; cloud owns credential renewal, real model requests
  and producer-side credit accounting. Send only allowlisted model metadata and
  an owned inference stream to Desktop, never keys, OAuth material or endpoints.
  Keep approval judges on the server and preserve Team/task computer assignments.
  Native run receipts are account/server scoped and forbid replay after restarts.
  Approval/takeover continuations use a stable hash of the server-owned saved
  checkpoint as their execution segment. Fence and receipt each segment once,
  preserve the parent run/project identity, and refuse concurrent or repeated
  starts. Keep legacy initial-run receipts; reconnection alone grants no segment.
  Keep the native session open for outstanding callback replies after the engine
  ends. Report completion only after the complete stream and acknowledgements.
  The bridge carries plain data, bytes and callbacks only (no AbortSignal or class
  instance). The server owns the steering watch for Desktop tools: never send
  steeringPending across it. Verify with the Pi tool-call test in desktop-agent-runtime.
  Every bridge message costs a relay round trip, so keep them few and full: a model
  read merges consecutive deltas of one block and answers with everything buffered
  (desktop-model-batch.ts, bounded by bytes, never by a small event count); open()
  returns the first batch when the PC asks with firstBatch, and both sides keep
  working with peers that do not. Checkpoints go without awaiting the reply; the
  tool call follows on the same ordered stream. The Desktop relay sends every
  complete line buffered during a result POST in the next one (RESULT_FRAME_BYTES)
  with the stream end joined to the last lines, and the API rechecks all of a PC's
  bound Micos with one ownedBots read. Verify desktop-model-batch, desktop-model-stream,
  desktop-agent-runtime and the Desktop/API relay tests.
  Phase 4 of specs/local-engine-default/spec.md gives only explicitly requested,
  recoverable owned Desktop shell commands the ephemeral loopback model token.
  Keep it out of the renderer, transcript and logs. The wallet transaction checks
  current billing ownership, opt-in and lease. It excludes shared Mico member turns,
  pins the approved turn ceiling and
  counts tagged unsettled and settled entries across segments and restarts.
  Verify desktop-tool-model, desktop-agent-runtime and model-credits.postgres
  tests. SDK and local child fixtures do not qualify an installed Desktop.
  Disconnects must not silently substitute a cloud run for an admitted local run.
  Before dispatch, a fresh turn can run in the cloud if Desktop is offline.
  Preserve local project and checkpoint bindings; a tool result payload alone
  does not indicate checkpoint recovery.
  Automatic server workspaces use separate home keys, preserve Team/dedicated
  isolation and pin the selected workspace to the run. Keep Bot.computerId and
  native project paths out of cloud provisioning.
  Keep callback/agent/command admission lanes bounded and native long polls
  authenticated again before delivery. The additive desktop_execution migration
  remembers the choice across API restarts; it does not move account data.
  Verify desktop-agent runtime/engine and relay tests, host consent/native runtime,
  and scripts/verify-desktop-execution-db.ts against isolated PostgreSQL. Physical
  installed-Desktop/mobile acceptance is separate from fixtures and builds.
- With several Desktops online in one account/Space, an unbound Mico goes first to
  the PC its owner last chose (explicit Desktop bind, saved hashed in
  desktop_bot_devices so API/Desktop restarts and routines keep it), else only to
  the one PC whose account registration reports its folder key (SHA-256 of the bot
  id, sent after the server's `ownership: 1`); none or several is `unresolved`, never
  guessed or offline. One online PC still takes every Mico; explicit binds win. The
  offline cloud workspace needs a really offline PC, and for native engines the
  server's nativeHostAccess grant (specs/desktop-mico-ownership/spec.md).
  Without that grant a fresh turn of a native-engine Mico answers on the server
  with its saved Pi model, else the account's main model (piFallback), captured
  as engine pi so resume stays there, and the chat note names the engine it
  replaced; with neither model it keeps the PC's offline message
  (specs/local-engine-default/spec.md). Admitted local runs never move. Verify
  relay broker/API/client, mico-folders, offline-cloud-workspace and runtime tests.

- The installed PWA Voice shortcut uses ?dictate=1 and the existing scoped chat
  recorder. Consume each request once; start only in a visible standalone app
  after voice configuration is known, without busy work, calls, drafts or files.
  Never send on launch: shortcut dictation goes to an editable review with
  Continue/Cancel/Send. Preserve text and the nonce on refused/uncertain sends.
  Verify voice-shortcut, composer, dictation and PWA manifest tests; physical
  microphone/gesture acceptance remains separate from synthetic browser tests.

- Windows updates check the official HTTPS catalog and stage verified packages in
  the background. Eligible new Windows installations enable automatic idle updates;
  preserve saved opt-outs and leave development/system-installer channels manual.
  After fresh native/renderer readiness, expose a cancellable fifteen-second grace
  period. New work, unsaved state or a changed release restarts that grace period.
  Unreadable saved preferences disable automatic installation, never erase an opt-out.
  Downloads and ready/error states stay in the sidebar without blocking chats.
  Cover the app only after an explicit restart request and renderer readiness;
  preserve Cancel while waiting. A call continues until the owner chooses to end it and restart.
  Keep an explicit retry and official download link for failed updates.
  RAKAZO_DISABLE_AUTO_UPDATE=1 suppresses background requests. Keep the unsigned
  automatic-install channel disabled. Bound and
  verify catalog/payload bytes, platform, paths, versions and SHA-256; never accept
  renderer-provided installer paths. Normal updates may wait for native work; an
  explicit Restart now checkpoints owned operations and queues the same fenced Run.
  Always require the nonce-bound current main-frame acknowledgement, preserve
  stored text drafts and block in-memory work. Keep unacknowledged calls resolved
  as uncertain checkpoint results; reconcile their command receipts before mutation.
  A planned restart may restore a relay generation only from bounded private
  version/account/server/Space/session metadata after fresh identity and consent.
  An asynchronously failed helper defers that release until an explicit retry or
  a newer package; never relaunch it on every idle tick. Preserve the bounded
  local handoff-error.json process receipt when PowerShell exits without logs.
  Restart now transfers the queued policy intent to the manual controller before
  handoff, so its failure cannot leave a second idle restart waiting or retrying.
  A pending restart is cancellable. The hidden same-user helper waits for normal
  exit, installs and reopens the same profile, without copying
  files or scanning the profile in between: the NSIS fast-install journal keeps
  and restores the previous installation, and the installer never writes userData.
  Never force-stop another process, use Restart Manager shutdown or clear user data.
  Read PowerShell progress receipts as UTF-8 with an optional BOM. Retry only
  temporary Windows sharing and lock violations on progress writes. Qualify real
  Windows file contention and encoding in manual-update-helper tests. Start the
  worker through a hidden non-detached launcher so it survives Desktop's exit.
  Canonicalize owned file paths before Windows process identity checks, including
  8.3 TEMP aliases. Retain process handles before waiting or reading exit codes.
  Wait on the installer process handle with a deadline before checking its exit
  code and the installed version. Do not wait on the installer's entire process
  tree or roll back over an installer still running. Confirm the reopened
  window against the committed job, target version and child PID. Record failed
  relaunch separately from a failed installation.
  Keep private logs and leave Desktop open until the worker acknowledges.
  Hold the profile's exclusive active-install.lock for the worker's lifetime;
  refuse a competing handoff before quitting. Keep Windows installer launch
  checks visible and distinguish starting-installer from a running installer.
  Before acknowledging shutdown, Windows Attachment Execution Services must scan
  the exact file and enforce its download-origin policy and any owner prompt,
  attached to the owned, visible main window. Present a required prompt before
  scanning, then recheck Windows policy and rehash under the verification lock.
  Keep the app and PC online until that approval, then recheck current drafts and
  local work before committing the restart. On timeout, cancel only that launcher's
  uncommitted worker. Preserve zone evidence and reject cancelled/blocked checks.
  Only then launch the approved bytes directly, avoiding a second hidden shell
  prompt after quit. Keep the install progress window responsive through relaunch.
  Qualification Job Objects close their descendants when the command ends: verify
  interactive relaunch outside that teardown before claiming the app stays open.
  Check space on both installation and profile volumes before quitting, then
  recheck before backing up. Keep checking for newer releases while one is staged.
  Verify manual-update, desktop-update-work, composer-draft and preload tests plus
  a fresh-profile native handoff before applying it to an installed profile.
  Published Windows preview tags use the owned GitHub release's bounded
  desktop-release.json; ignore draft, legacy and headless releases. Follow only
  the owned GitHub asset URL to its exact release CDN, without credentials.
- Windows release packaging embeds desktop-build.json with the committed revision,
  tree and all three current build receipts. Windows compact resources keep
  local-server JavaScript in runtime.asar and
  native packages at real paths, with root-scoped resolution in utility/Node
  children. Never expand the complete server at startup or drop offline features.
  Windows passes a standalone builder config file: builder API overrides concatenate
  resource arrays with package.json and would reintroduce the legacy loose tree.
  Preserve base voice unpacking and check the actual packaged file count.
  Map compact native node_modules as a separate resource root: the builder's
  resource filter unconditionally skips a root directory with that name.
  Fast installation journals a same-volume installation snapshot, retains the old
  uninstaller, registration and shortcut recovery, and never moves userData.
  Qualify compact-resources, fast-install, the real local server and timed NSIS
  legacy upgrades; report hosted timing separately from physical-PC acceptance.
  Compact Windows payloads use ZIP32/Deflate; afterPack bounds the actual file
  and directory count and total bytes before NSIS. Keep loose legacy payloads on
  7z, reject ZIP64-sized inputs and retain the measured installation-time gate.
  Disable differential payload generation for ZIP, then generate the standard
  standalone blockmap with the pinned builder; never append it to the EXE.
  Windows local PostgreSQL uses bounded pg_ctl readiness and exit status with
  ignored process pipes. Keep the profile lock if shutdown fails.
  desktop-windows-release.yml builds
  release branches/manual runs without publishing. A matching integrated Desktop
  tag can publish, or desktop-windows-promote.yml can promote an already-qualified
  run from main without rebuilding. Require its exact revision/tree, checksums and
  installer receipt; never promote an older tree over newer main changes.
  Never replace an existing release. Do not bump the Desktop version in feature
  work: write changelog.d notes and desktop-auto-release.yml picks the version.
  Keep the native runtime pin and other platform channels intact.
  Operator-requested workflow_dispatch expedited releases retain the real build,
  artifact identity and packaged-startup gate, but record optional tests/installer
  timings as NOT RUN and qualifiedInstallation:false. Never claim a measured time.
  Verify desktop-release, published-desktop-release, manual-update and
  prepare-desktop-version tests; a signed-out packaged startup does not qualify
  account login, real video generation or physical multi-device inference.
- Workspace navigation uses the single rail and per-account/Space pins. Marketplace
  reuses the existing connection and skill services; preserve multi-account editors. Its
  menu collapses from a persistent header control, with a device-local preference.
  Hide only navigation; keep active apps, editors and drafts mounted. Preserve
  keyboard focus, mobile access and the native caption-control clearance.
  Library shows chat attachments and Mico outputs from the existing artifact index.
  Preserve Space scoping, artifact deep links, version history and previews.
  Inbox entries refer to ordinary Mico task threads through taskBotId and the
  mico-task key namespace, never a parallel execution engine. Keep ?task= for
  owned task conversations and ?inbox= for the inbox selection. Archive and sends
  share the exact thread lock; uncertain sends retain their original nonce. Archive
  lives on threads.archivedAt; task_inbox.archivedAt is only a mirror written for
  rollback and the reminder index. A send from a Mico tab or from Tasks restores an
  archived conversation inside that same transaction, keeping history and read
  state; a conversation being deleted refuses it and stays out of Tasks.
  Discover existing named task conversations into inbox metadata in bounded,
  owner/Space-scoped batches without starting Runs or replacing archive/read state.
  Exclude routine/workflow/main threads and interrupted inbox starts. Completed
  turns remain reviewable until archived. Verify verify-task-conversations-db.ts
  and the task section/navigation tests when changing this bridge.
  Follow-up uses InboxTask.pinned/remindAt and existing read cursors. Separate new
  replies from read conversations awaiting continuation. Keep the seven Tasks
  sections; a conversation with no finished turn sits in Waiting, never To continue.
  Rows take the thread outcome before the last run (red failed/stopped, amber when
  the person is needed, always with words) and mark conversations the Mico opened.
  Questions stay answerable inline; "Answer in the chat" opens ?task=&m= at the
  question. The detail panel resizes (320 px for it and the list, width kept per
  device) and Open on a pending start commits it at once. The existing worker
  reconciler claims due reminders; no model Run or Credit charge. Archive cancels
  reminders, rescheduling invalidates queued notices, and delivery rechecks owner,
  membership and notification/privacy policy. Preserve UTC instants through Web
  Push outbox SQL and epoch-based job scheduling. Verify the focused route/DB
  verifier, follow-up UI, notification and section tests for changes.
  Calendar and usage queries remain bounded and owner/Space scoped; unknown cost
  stays unknown. Workflow condition branches retain the existing worker semantics.
  Verify scripts/verify-workspace-sync-db.ts and verify-workspace-sync-ui.mjs;
  the browser fixture uses synthetic RPCs and does not qualify real agent execution.
- Continuous voice keeps its immutable Space/task client and stops its owned audio
  resources on close. Track the accepted turn by run and task ID so an older
  chat failure cannot stop the microphone or speak an unrelated reply.
  Groups get the same voice conversation, as the reference app's channels do
  (behavior reference only): it sends to the group target, so the server's
  deterministic routing picks the members, and tracks every run id the send
  returned. Each member's reply is read in that member's voice once its own run
  ends (lib/group-voice.ts); one member failing stops voice only when nobody
  answered. The panel shows the member speaking or working, else the lead, and
  dictation is authorized for the lead. "Read new replies aloud" (or a member's
  autoSpeak) reads, once, the first finished answer to the person's newest group
  message, preferring a member that message named; never member-to-member turns,
  and not while a voice conversation is open. Verify group-voice
  and VoiceConversation tests.
  Native speech preparation is explicit and verifies pinned
  files. Keep standalone Node, its license, optional native modules and Windows
  Job ownership in packaging; never replace them with a renderer-selected runtime.
  Browser tests do not qualify microphones, model inference or native installers.

- Windows installers explicitly include Koffi's win32-x64 optional native module
  under resources/koffi/win32_x64. Preserve this loader-supported fallback even
  when dependency collection misses optional packages. Use the native 7z NSIS
  payload: the full resource tree exceeds ZIP32 and nsisunz rejects ZIP64.
  Verify windows-installer tests and a fresh-profile packaged startup before release.

- Private Apps stay disabled in production builds. Local development keeps its
  preview; packaged private qualification requires both VITE_MYCELLIOS_PRIVATE_APPS=1
  at web build time and MYCELLIOS_PRIVATE_APPS=1 at native launch. These release
  flags never replace the account, Space, PC consent or revision admission.
  The qualified built-in Video Studio has separate released availability; its
  projects remain private and it does not admit arbitrary app bundles. Operators
  can disable it with VITE_MYCELLIOS_VIDEO_STUDIO=0 (web build) and
  MYCELLIOS_VIDEO_STUDIO=0 (native launch). Keep both existing admission guards.
- Account-PC shutdown ignores late status callbacks after quitting. Verify
  account-computer-background tests; repeated stop and pending refresh completion
  must not rewrite Windows startup preferences during shutdown.
  Isolated RAKAZO_PERFORMANCE_USER_DATA qualification profiles never write the
  installed application's Windows startup preferences.

- Apps opens its catalog in Marketplace and launches Video Studio through the
  Shell overlay. Preserve the chat draft and scope. The Apps catalog uses compact responsive app cards with real compositor scene samples; keep browser versus Desktop availability explicit. Personal app covers reuse owner/Space-scoped artifact versions with revision checks. Uploads accept bounded PNG/JPEG/WebP only. Generation opens an independent Mico task on its existing model/tools; persist and reuse admission nonces, never auto-resubmit, and require explicit application of an actual returned image. Verify app-covers and app-cover-generation tests. The private Video Studio v1 definition is in Desktop assets,
  with a fixed native driver and owner/Space/device-private projects. No app HTML,
  executable commands or paths are accepted from the renderer. Keep script/media
  revisions, review binding, actual artifact checks and existing PC consent.
  Cloud, catalog publication and cross-device project sync are not implemented.
  Qualify the app validator, native studio tests and `scripts/verify-apps-studio-ui.mjs`
  through compilar.ps1. `--codex` additionally uses the PC's real provider session;
  the ordinary fixture otherwise uses a manually entered script, not fake AI.

- Development projects group independent existing Mico task conversations through
  owner/Space-scoped metadata, not cloned bots. Native repository paths stay in
  the native profile. Project conversation admission verifies the exact owned
  thread and provisions a distinct Git worktree before sending; ordinary Mico
  threads keep their existing route. Never reset a source repository, import its
  uncommitted files implicitly or merge task changes automatically. Keep review
  drafts, native preview generations and runner keys scoped to the conversation.
  Parallel native project runs require owner/Space metadata plus the exact native
  worktree-v1 binding. Use per-conversation computer lease keys, retain their run
  fences and block shared screen/browser tools in both offering and execution.
  Ordinary/legacy computers retain their existing computer leases.
  Admitted native task roots use dedicated path mapping without changing the
  saved Team assignment; never prefix their commands/files with bots/<mico>.
  Namespaced computer lease keys are not Mico identities: preserve their exact
  DB fence and resolve the owned native conversation for Stop/crash teardown.
  Wakeups must check the conversation's key, not serialize the whole Mico.
  New worktree basenames use 128-bit hashes to fit Git for Windows' internal
  metadata paths; recover existing full-hash receipts without moving owner files.
  Verify projects API/RLS, project-workspaces, project-conversations-ipc,
  host-task-project, task-thread-scope and native-computer-execution tests, plus
  scripts/verify-projects-db.ts and scripts/verify-projects-ui.mjs locally.
  scripts/verify-projects-desktop-real.ts is an explicit opt-in qualification:
  isolated profile/database, existing unexpired subscription credential, real
  native bridge and two barrier-synchronized tests. Run it once through the shared
  queue with --allow-real-model; never nest the queue in its child test commands.
  Its private PostgreSQL cluster requires UTF8 and a stored Unicode round trip.
  Windows command pipes use overlapped I/O with early error guards. Output loss
  records an unknown outcome, not success or permission to replay the command.
  Verify desktop-sandbox-command, desktop-process-tree and native-command-journal.


- Mico Work controls reuse revisioned delegation controls and durable teardown.
  Keep command/workflow/delegation tools in the canonical built-in registry so
  saved tool blocks remain enforceable. Pi shell parameters retain the declared
  bounded timeout, including its description and validation.
  Pi concurrency is admitted atomically per Bot and serialized per thread; a Pi
  Mico's main chat is its own lane outside its 1-4 conversation slots (claimMicoRun,
  delegation capacity), so it never waits behind side work. Native engines remain
  single-turn in total, main chat included, unless the operator sets
  MYCELLIOS_NATIVE_CONCURRENCY=1 on API and worker (specs/native-engines/spec.md phase 4):
  then Codex, Claude Code and OpenCode get the same lanes (micoRunsLanes) and side-
  conversation private lane, while a generic ACP agent stays single-turn. Either way a
  separate-browser routine turn that runs on its server workspace with a Pi model
  (routineBrowserRunsOnServer/isServerRoutineRun in slotRunsWhere) neither takes nor waits
  for a native Mico's slots; one already begun elsewhere keeps counting. Each run keeps
  its own session folder, CLI process and MCP bridge token; Desktop bounds turn CLI
  processes per PC (NativeProcessSlots, default 6) and a turn above it waits visibly. The
  Desktop relay's unchanged lanes still deliver at most 2 agent runs per Mico and 4 per API
  instance; further admitted turns wait unclaimed there, as Pi tasks do.
  Private Pi and native tasks reserve the existing computer lease
  before computer/file/command tools, never share it between runs, so screen and browser
  tools stay serialized. Verify scripts/verify-native-concurrency-db.ts with both flag
  states, native-process-slots and the native runtime/Desktop engine tests. Workflows reuse
  existing Micos, owner/Space RPCs and the existing reconciler, freeze graph versions
  and persist private step runs. Stop commits cancellation and process teardown
  receipts together. Verify workflow contracts, affected wakeup/control tests and
  the synthetic PostgreSQL/browser acceptance scripts through compilar.ps1; never
  use production accounts, credentials or models in these fixtures.
  Workflow approvals pause admission of new steps. Independent branches join only after their
  inputs settle; stop, rejection and failure preserve exact teardown receipts. Workflow
  history keeps 50 revisions, and restore writes a paused version. Signed workflow webhooks
  authorize only the revision the owner enabled; secret rotation is immediate and concurrent
  deliveries share an execution bound to the sender's id. Workflow answer receipts bind the
  run lease. A corrective turn offers only the answer tool and does not replay the instruction.
  A bounded loop has one entry and exit, and never resets work outside that region.
  Workflow templates create paused, unassigned drafts. Step tests and restarts create a
  new execution from the current saved version and reuse only settled checkpoint data.
  Keep original run IDs and authorization receipts in their source execution. Ask
  for upstream approval again, fence cleanup, and retry uncertain requests by nonce.
  Verify the synthetic workflow PostgreSQL and workspace browser fixtures.
  Workflow thread ownership queries project only userId/spaceId from a Run actor;
  preserve execution identity and verify scripts/verify-workflow-thread-db.ts.
  Delegation from ordinary Mico tabs uses internal work scope; explicit project
  delegation keeps its independent native project binding and admission.

- Settings uses one searchable full-viewport account/Space shell, with a fixed
  section header and independently scrolling content. General contains device UI
    preferences; Profile owns identity/security and its visible Usage and costs
    section. Legacy settings=usage focuses that section in Profile; keep
    usage bound to its selected Space RPC client and retain usage/cost search
    aliases on Profile. Micos opens the existing per-Mico
  editor and its canonical skills editor. Keep Models, Voice, Approvals, Memory, Usage,
  Computer, Mobile and Updates connected to their existing services, with Billing
  and Logs gated by capability. Search matches field aliases and accents; Escape
  clears a query before closing. Profile/model/voice/memory drafts use the shared
  leave guard and saves block navigation while pending. Do not duplicate account
  connection editors or cross a Space boundary with the current Space's client.
  The account provider directory uses the existing main role for its compact
  default selector. A connection does not pick a default model. Keep host
  discovery and installation scoped to the existing grants. The ACP Registry is
  a read-only metadata catalog and supplies no executable commands.
  OpenCode is listed as a built-in engine even without a host grant. Its detail
  reads actual availability and offers the managed download only when granted.
  Zen and Go connections use the account API model path, separate from the
  isolated native engine selected per Mico.
  AntSeed shares the built-in provider detail layout and groups the account's
  AntSeed gateways. Its detail reuses endpoint-bound credentials and the model
  catalog editor. Changing gateway models never changes the account main role.
  Account notification levels and per-Mico overrides use notifications.saveSettings
  and the shared notificationAllowed policy for both live and push delivery. Device
  enable/preview/sound/pause preferences stay local; task-alert switches save through
  the owned Space RPC and remain an additional gate. Hidden previews never reveal
  reply text or names. The service worker persists device preferences beside its
  account binding, applies them after restart and clears them on sign-out. Account
  status failures must not fabricate saved defaults or report a test as delivered.
  Desktop uses the optional named notifications bridge in native main; retain
  at most 50 alerts, validate main-frame origin and internal chat targets, and clear
  them on account/window changes. Keep the Windows AppUserModelID aligned with
  the installer. Older clients retain the browser Notification API; web clients
  use the active service worker where available. Suppress notices while a same-account tab is
  focused. Click destinations must stay inside the deployed app and the target Space.
  A focused conversation plays a short cue after a persisted reply completes.
  Honor the device sound, mute and attention settings and the Mico's preference.
  Off-thread activity checks are scoped to the current Space and run only while away.
  Closed or suspended clients enroll in Web Push with existing OS permission and
  the device's reply-notification setting. Never prompt outside the user's gesture.
  Installed mobile web apps offer the OS permission from a dismissible chat prompt.
  Web Push is backed by encrypted,
  session-bound subscriptions and a durable outbox. Configure the same stable VAPID
  identity on API and worker. Never record subscription endpoints or payloads in logs.
  Explicit, confirmed sign-out clears the local worker account binding and native
  alerts; closing a tab/app keeps its background subscription. Reconcile actual
  subscription/key state instead of trusting only the server registration flag.
  The push worker uses event-specific copy and bundled notification artwork. Put
  later icons in avatarArt so installed workers with the original allowlist
  still deliver the notice with the generic mushroom. When
  previews are off it displays a generic mascot and hides conversation identity.
  Refined failure kinds (not_started, helper_failed, usage_limit, sign_in from
  runErrorNotice) travel as `detail` beside a base kind old workers accept. Turns
  another Mico started (bot_message, delegated_task) finish without notice or cue;
  their requests and failures still alert. A group notifies once, from the last
  member turn, while unread (groupWorkEndedWithUnread). The account taskReplies
  switch only silences finishes/failures of non-routine task conversations. An
  indefinite pause stores NOTIFICATIONS_PAUSED_UNTIL_RESUMED. notification_requests
  records request notices; one sweep claim queues the version-2 close only to
  devices with sentAt, never Apple endpoints, plus a normal-priority Android close
  for the matching request. Closes skip the presence hold; other pushes keep it.
  Regenerate the small PNGs with `node packages/ui-tokens/scripts/export-notification-art.ts`.
  Qualify delivery and the destination on an installed PWA on a physical phone.
  Mobile boot/resume only refreshes prior opt-ins; request OS consent from settings.
  Android creates the stable default channel before registration. Pin asynchronous
  token registration to its original account/server session. The additive
  mobile_push_devices table retains up to 20 encrypted devices per account and the
  legacy push_tokens row; revoke only the current session on device unsubscribe.
  Promote API and worker together with that migration. Shared background filters
  and preview privacy apply to native mobile and Web Push. Session DateTime fields
  are UTC timestamps without timezone: compare raw SQL against now() AT TIME ZONE
  'UTC', leaving timestamptz outbox fields unchanged. Verify with
  `node --import tsx scripts/verify-notification-devices-db.ts` through the queue.
  A native Android WebView build without push must say so; do not claim Expo,
  APNs/FCM or closed-app delivery without owned configuration and physical proof.
  Web update checks share the existing guarded tracker; they never deploy servers
  or reload through open settings, unsaved work or calls. Desktop uses the installed package's
  real updater policy; do not fabricate channel/automatic-install permissions.
  Account navigation shows all authorized sections directly. Models remain
  reachable from Micos, approvals from Computer use and usage from Billing.
  Settings sections stay visible under headings, including advanced fields,
  notification filters, account access, voice services, MCP and version details.
  ExpandedSettings scopes the shared Disclosure presentation to settings and
  their portalled subpanels; do not globally change chat/tool disclosures.
  Preserve field state, save/leave guards and masked credentials. Skills and
  usage load on entering their section; search can reach every visible field.
  Updates use one compact channel/version/action group. Local Vite previews do
  not advertise Stable or a disabled release-check button. Packaged empty-feed
  installs retain their actual channel and may retry metadata. Compare returned
  web builds before claiming up-to-date; retain guards instead of forcing reloads.
  Do not mix animation demos/raw build details into ordinary update actions.
  Desktop update choices persist transactionally in update-preferences.json.
  The renderer shows both installPending and relaunchPending update requests;
  cancel the controller that owns the request and surface relaunchError for retry.
  Disabling automatic downloads checks metadata without fetching the installer.
  Idle restarts require both a fresh renderer acknowledgement and an idle native
  executor check, remain cancellable and never interrupt an update download.
  Development/managed installations must not offer unsupported automatic updates.
  Qualify affected settings/security/model/voice/update tests and the isolated
  `playwright.settings.config.ts` flow. No live OAuth, paid run, payment, password
  change, account deletion, microphone permission or model download is a fixture.


- Mico task tabs bind immutable bot/thread/Space RPC clients, separate query caches
  and composer drafts. A draft tab has no thread: it keeps the main chat's client for
  reads only and its first send creates a fresh client for the new thread id. Reject snapshots for another thread; never derive task
  identity from mutable global location state. Cron, Test and event routines use
  the owned routine-thread resolver, preserving explicit targets and history.
  Delivery receipts freeze routine recipients and retain Run nonces after clearing
  chat; do not promise universal exactly-once execution for raw/legacy deliveries.
  Routine runs exclude screen tools at offering and execution. Preserve computer
  leases and private-call restrictions until those transports are scoped.
  Verify affected task/RPC, routine, webhook, push and native runtime tests;
  `node --import tsx --test scripts/verify-routine-isolation-db.ts` uses a fresh
  loopback PostgreSQL cluster, and `node scripts/verify-mico-tasks-ui.mjs` checks
  the real task component in a browser with synthetic RPCs. Run both in the shared
  scheduler. Native private-task push targets use the exact web fallback until
  native task rendering is qualified; never silently open the primary chat.

- Routine runs stay in their own conversation (specs/mico-routine-runs/spec.md). finalizeRun
  adds one system `routine_run` marker per run to the Mico's main chat (nonce
  `routine-run:<run>`; never for older main-chat/group targets). Reported, failed and paused
  markers mark it unread; a quiet run (NO_RESPONSE, nothing posted) never does, nor becomes
  the preview or moves the Mico. Markers never enter model history; the web folds consecutive
  markers of one routine into one line. testRun runs carry `routine-test:` and a person's
  Test/Run or chat mention is never quiet. `routine_report_failure` (≤500) is for routine runs
  only: the reply stays, the run fails with that reason, no retry. A scheduled run may use
  schedule_update only to pause its own routine (routines.pausedByRun*, never silent). Late
  wake-ups count missed times on the run (runs.missedRuns/missedReason). The conversation
  follows renames unless titleSource is user, a run reopens it, deleting the routine archives
  it with its history. Verify with verify-routine-isolation-db.ts and the routine tests above.
  `runIn` (thread default/chat; group is kept, never moved) is set by the editor switch and the
  schedule tools; moving back reuses the conversation found by key, never a second one.
- Signed webhook routines (specs/mico-automation phase 2): `/api/v1/routines/<id>/events` takes
  Standard Webhooks events (`v1,` HMAC-SHA256 of `id.timestamp.body`, `whsec_` secret, ±5 min),
  verified on the raw bytes before parsing; every refusal is the same 401. Secrets stay encrypted
  in `routine_webhook_secrets`, never in logs or prompts; a rotation keeps the previous one 24 h,
  Revoke or turning the webhook off ends both. `claimRoutineEvent` locks the routine: delivery-id
  digests dedupe for 7 days (runs keep their nonce, so never a second run), 60 events an hour then
  429, and type/filters/paused decide before any run (202, shown in the history). Send test event
  starts a `routine-test:event:` run, also while paused. The per-Mico Bearer route skips routines
  with their own secret; the UI issues per-Mico keys only for GitHub. Verify routine-events tests
  and `node --import tsx scripts/verify-routine-events-db.ts` (fresh loopback cluster).

- Mico Scripts (specs/mico-automation phase 3) require
  `MYCELLIOS_MICO_SCRIPTS_ENABLED=true` plus owner opt-in per Mico. Keep token
  hashes and delivery receipts bound to the Mico, Space and owner. A token only
  reads and answers ordinary questions for its own deliveries. Retried deliveries
  reuse their receipt, and every accepted run keeps the unattended webhook policy.
  Verify with `node --import tsx scripts/verify-mico-script-credentials-db.ts`.

- Mico work delegation uses durable parent/child Tasks, expected results, dependency
  and resource reservations, and revisioned controls. Native command receipts belong
  to the admitted host/Mico and are observed with command_status; a lost observer or
  missing exit is never success or authorization to replay. Preserve native Windows
  Job ownership, consent, Stop, bounded budgets and exact run/fence teardown. Plans
  and continuation counters are fenced Task metadata, not new instructions.
  A work return that an update or lost PC connection cut off (isInterruptedRunError) never
  ends the request silently: reconcileWork queues one fresh task_return run (nonce
  work-recovery:<failed run>, wakeAt 30 s, 2 min, then 5 min, WORK_RECOVERY_MARKER note to
  check before acting), never a replay; only the failure that ends recovery alerts. A failed
  child's normalized reason (≤500) travels as data in the receipt and work_status. Verify
  native-command-journal/recovery, work-continuation, work-resources, work-stop-reconciler
  and API work-controls tests plus scripts/verify-resilient-work-db.ts through the
  shared scheduler. Keep production and existing user accounts out of these fixtures.

- Mobile dependency updates must match the installed Expo SDK's
  `bundledNativeModules.json` and the proposed lockfile's peer requirements;
  an isolated Router major update is not an SDK migration. Mermaid's API route
  serves the library's browser bundle directly to native WebViews, so a package
  major must preserve the supported iOS/Safari floor as well as passing current
  Chromium tests. Keep the existing browser floor unless explicitly migrating it.

- Project browsing belongs beside any chat in the shared review workspace. Desktop
  uses an isolated, sandboxed native WebContentsView with its own ephemeral session
  and inspector preload; webpages receive no application bridge, account cookies or
  OS-tool credentials. Keep exact main-frame/owner/chat/Space admission, bounded
  native rectangles and generation-bound selections/captures. Native content hides
  below app dialogs/menus. Selection comments and captures become editable drafts,
  never implicit sends. The web fallback requires a cooperating, frameable page;
  do not strip framing/TLS protections or proxy arbitrary sites. Generic project
  folders and local-computer consent remain independent of the browser. Do not add
  a renderer-owned source path or command. Developer mode may open an isolated
  Mycellios Dev window through native admission from the current main chat;
  keep the original chat bound to its preserved source copy and do not copy
  normal account cookies or provider credentials into the development profile.
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
  Initial native admission prepares owned instructions before connecting and
  preserves the saved computer assignment. Explicit legacy assignments may move
  an idle Desktop team record while only its created greeting waits; preserve
  user control, execution IDs/leases and every other active-run refusal.
  A connected agent already receives a persistent native workspace automatically;
  do not require folder selection to enable shell/file tools. Existing projects can
  be addressed with the shell's cwd/native paths under the existing access policy.
  The optional picker changes the project file-tool mount; it is not onboarding.
  The Mico's Add folder action uses that native picker for ordinary directories.
  An attached Git root with HEAD can create tasks through the existing development
  project API and worktree admission. Match the native attachment by server, owner,
  Space, Mico and project ID. Keep ordinary folder grants session-scoped and send
  only the project name and opaque ID as metadata. Verify LocalProject, host-computer,
  project-conversations-ipc and project-workspaces together.
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
  Application behavior reuses AppBehavior's transactional native settings and OS
  startup/power ports. The shell owns explicit startup preferences; account
  computer consent must not overwrite them. Quick reconnection keeps only an
  already authorized live remote transport after the last window closes;
  explicit Quit stops it, and a second launch reopens the UI in the same process.
  Keep this distinct from hiding the full app in the background. Unavailable
  native controls are disabled on web; restoring the workspace works on both.
  Product measurement remains opt-in. New screen events use a random installation
  identifier unless consent is bound to the currently signed-in account. The
  server derives linked identity from the authenticated actor, strips request
  metadata before the fixed analytics event allowlist and pseudonymizes through
  the existing optional configured collector. Never send email, content or URLs.
  Verify AppBehavior, account-computer-background, App analytics, native settings
  UI and authenticated analytics route tests; physical OS acceptance is separate.
  External-link destination lives with conversation preferences. Reuse native
  settings.state/update and its existing isolated browser; keep pending saves
  navigation-blocking and never show a failed save as selected. Web exposes the
  system browser only and explains the Desktop-only integrated browser instead
  of offering an unsupported embedded or custom executable destination.
  Show agent steps is an expansion preference, never permission to hide a turn's
  available tool history. Legacy off values render folded steps; expanded opens
  them by default. Synchronize storage events across windows and retain choices
  in memory when persistence is blocked. Manual disclosure choices survive new
  steps; a changed default applies to live activity too. Only describe steps the
  runtime actually supplies; do not promise missing reasoning or memory diffs.
  UI language preferences distinguish system mode from the activated locale.
  First visits follow navigator.languages/navigator.language, choosing the first
  supported locale (English fallback). Keep explicit saved choices, and refresh
  on languagechange only in system mode; catalog fallback must not persist a
  detected language over system mode. Verify ui-locale and i18n-system tests.
  For an already running preview, use npm run dev:local:status: parallel, bounded,
  read-only probes check the Vite HMR client, React Refresh and API/worker readiness.
  This is service readiness, not browser interaction or release qualification.
  Visual-only iterations use the existing Vite/React hot reload; do not install,
  run turbo build/check, package Desktop or restart healthy services for them.
  Review the narrow diff and inspect the changed surface. If browser automation
  is unavailable, report that limitation rather than repeating the same timeout.
  Functional changes retain affected tests/types; publication retains its real
  build, provenance and health gates. Never label omitted checks as passed.
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
  and Desktop. Windows and Linux use the standard native OS title bar, the same
  way the reference app does: the BrowserWindow keeps `frame: true` and does not set
  `titleBarStyle` or `titleBarOverlay`. Caption controls sit in that bar above
  the page. Do not install a host caption strip, a transparent overlay, or page
  padding and drag regions that reserve space for those controls.
  macOS uses `titleBarStyle: "hidden"` with the traffic lights over the page at
  MAC_WINDOW_BUTTON_INSET, inside the 72px macOS page rail and centred on the
  51px top row, as in the reference app; drag regions exist only on that platform. Each
  top row drags the window as a whole: mark only its controls no-drag, never a
  wrapper that spans the row. The legacy nativeWindowFrame
  capability means controls are host-owned; hide duplicate in-page controls only
  when the bridge advertises it. Older frameless builds retain their page controls.
  Sign-in proceeds without an intermediate login launcher or popup. Keep the persistent
  server-specific Electron session, state/PKCE and explicit retry after failure.
  Generic self-hosted SSO, model and MCP authorization retain their existing
  popup behavior. Managed integration connections use an ordinary external browser
  target; the original client confirms completion through the owned server request,
  without depending on a popup handle or shared browser cookies. Never broaden
  main-window navigation to arbitrary identity hosts.
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
  Visible internal balances are Credits (CrÃ©ditos in Spanish), with 1 USD = 1 Credit on paid top-ups; Spore names the separate official token and Micos names the agents; retain historical ledger/API field names and never
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
  Mobile settings show real owned sessions as phone cards. Reads/revocations are
  scoped to the live account and stale async results are discarded. Focus refreshes
  the list; bounded polling runs only while adding a phone. Preserve fresh-session
  confirmation and revoke by public session ID, never by exposing bearer tokens.
  A permanent link/QR opens the same server and still requires sign-in; it is not
  a single-use login credential. Block pairing/copy on loopback previews rather
  than silently sending a user to a different cloud server.
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
  the same account/Space scope. Preserve existing explicit approval choices and
  the server-side review policy. Settings > Models exposes chat models and
  providers, while Settings > Approvals owns the permission rules.

- Each Mico has a searchable model picker in the chat header. Account Settings
  > Models manages provider connections. Preserve saved account and Space model
  defaults and fallbacks. A specific choice updates only that Mico and can run
  with its own connection even if the account has no general model. The header
  lists each actual model once and marks the effective selection; inherited
  defaults resolve to that same row without writing an override on open. Shared
  defaults stay in Settings > Models, not in a second header editor. Preserve
  the inherit option in Mico settings and existing saved defaults.
  If its primary slot is empty, chat may start on the first saved backup with
  an owned connection. Preserve the backup order and the existing funding checks.
  Pi's implicit reasoning default does not constrain the saved backups. Preserve
  explicit thinking preferences and image requirements, and check pi-runtime-fallback.
  Keep the chat picker compact by connection and list all already authorized
  models directly, without a separate quick-list filter or catalog screen.
  Mycellios reads its live account catalog rather than saved enabled IDs; retain
  an absent saved selection as unavailable without silently replacing it. Exclude
  catalog services explicitly lacking tool support from Mico selection. The +
  manages providers. Enable a newly selected compatible model with the owned
  connection before saving the Mico, preserving shared defaults and limits.
  Order live Mycellios network chat models before AntSeed and label both groups;
  keep the network group visible above AntSeed when it has no compatible chat
  capacity. Show an empty state only after successful discovery, and omit empty
  groups while searching or viewing a different provider.
  speech/transcription services and tool-less demos are not Mico chat capacity.
  A native provider whose connection already grants catalog access can select
  its models directly. Keep enabling a model separate from selecting it.
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
  Reusing an owned personal connection must not require a live SSO token; fresh
  linked-account SSO remains mandatory when provisioning a new connection key.
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
  Manual reloads may restore already-persisted composer text. Keep guards for unsaved work
  before and after the version fetch; desktop retains its separate native installer prompt.
  Detect web-only releases from the served build on foreground/minute checks;
  Automatic and required upgrades still wait for unsent drafts. All upgrades keep the
  attachment, recording and call guards. Verify client-update, client-update-work and WebUpdates.
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
- Computer-use settings recheck server health and the reported environment before
  showing a configured state; unknown/test providers and failed refreshes never
  inherit a cached green status. Keep local-device access distinct from a Mico
  environment. Reading settings must not request consent or start/stop work.
- Billing stays visible when payments are disabled, with no payment RPCs in that
  state. Keep server connections separate from account subscriptions/model Credits;
  adding a saved server is not buying hosting. Reuse native server-switch guards,
  current billing owner permissions and the existing ledger/checkout controls.
  Never infer a commercial license, free-use restriction or hosting plan from an
  account access flag. Failed reads must not become empty or active paid plans.
- A running computer does not prove its screen is connected. Offer screen retry and
  confirmed recovery separately, preserving the recovery dialog during background refreshes.

- Keep transcript progress live: in classic style stream the reply as it arrives
  unless the user saved streaming off (natural holds the answer until complete), and show the current step with its specific command, path
  or query plus live output in an open timeline. Unknown worker health stays
  visibly unconfirmed; folding details must never cancel, retry or restart a task.
  Keep the latest projected action visible, scoped to the active run and labelled
  as recorded activity rather than worker liveness. Finished tool cards stay behind
  the tool-activity preference.
- Protect multiline secret fragments during streaming as well as whole-output redaction;
  monitoring must scrub Windows profile paths with either slash direction and spaces.

- Answered ordinary questions collapse into a neutral reply with the original
  question available in a disclosure. Keep approval outcomes and saved credentials
  on their existing explicit status path, never expose secret answers.

- This development fork presents Mycellios Agent. Shared product names, API origins and asset
  paths live in `packages/contracts/src/product-brand.ts`; semantic forest/paper
  colors remain in `packages/ui-tokens/src/index.ts`. Web overrides must not
  replace the shared forest/paper surfaces with upstream monochrome colors. Generate its CSS with
  `npm run generate --workspace @mycellios/ui-tokens`. Preserve upstream license notices
  and internal storage/protocol identifiers when changing visible branding.
  Declare the startup Geist font in `apps/web/package.json`; ship its OFL notice
  under `apps/web/public/licenses/` rather than relying on a sibling clone cache.
  Agent headings, wordmarks, startup and hosted account forms share Geist through
  `apps/web/src/typography.css`; keep serif display overrides out of these surfaces.
  Hosted identity builds self-host font assets and require same-origin font CSP.
  App icons derive from `packages/ui-tokens/assets/mycellios-mark.svg` via
  `npm run export:brand --workspace @mycellios/ui-tokens`. Keep separate opaque maskable/iOS
  and transparent adaptive/notification outputs; Windows ICO includes small native frames.
- Preserve the separate contribution and paid-model ledgers; product naming does not merge or revalue them. Paid top-ups use the shared integer conversion in `credit-units.ts` (10 USD = 10 Credits). Mico/Micos names the user agents; Spore is the official token name, with existing launch gates unchanged.
  Trial Spore in Usage is off-chain and has no monetary value. Derive it from the
  account's canonical processed usage across Spaces, using the same token buckets
  as the usage report. Keep it separate from Credits, paid usage and blockchain
  balances. Verify reward thresholds, isolation and duplicate calls with the
  workspace PostgreSQL check.
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
  A hosted closed beta gates primary account creation in the identity database
  as well as Agent workspace creation. Preserve the email-bound proof from the
  invite cookie, the transactional primary quota and existing-account sign-in.
  Qualify both gates with `scripts/verify-signup-invite-db.ts` before activation.
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
- Chrome side-panel appearance is local to the extension and independent of the
  Agent account preference. Accept live visual overrides only from the exact
  approved extension origin and the parent window. Keep the existing host
  permissions, signing IDs and normal web/Desktop appearance.
- Appearance defaults to light when no valid preference is saved. Keep the pre-paint
  bootstrap and React resolution aligned, and preserve explicit dark or system choices.
- The web fork uses the Mycellios forest/paper palette; this supersedes the
  upstream monochrome appearance rule below. Preserve semantic status colors.
  Marketplace, Tasks, Schedule and Usage inherit the same semantic surfaces
  as chat. Keep page-specific accents separate from the shared surfaces.
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
- Device General preferences persist in `mycellios.general.v1`; validate font/color
  values before applying CSS. Keep separate chat backgrounds for light and dark.
  Read startup restoration once; preserve explicit deep links and active RPC scopes.
  Native Settings use main-frame-only IPC, transactional profile writes and actual
  login/power APIs. A failed write must leave the saved switch unchanged. Keep
  battery wake disabled until AC wake is enabled; never prevent display sleep.
- Desktop dock and island windows are sandboxed, without the app preload. Publish
  only the owned account/Space roster, clear it on sign-out/scope exit, validate
  bounded PNG avatars and accept selections only from companion windows and the
  current roster. Result text is opt-in. Preserve click-through when auto-hidden.
  Dock size (75–150%), edge offset, active-app visibility and display selection
  are device-local. Missing displays fall back to the main window's screen. The
  drag handle and arrow keys persist position through the private write queue;
  failed writes retain confirmed preferences. Completed-result previews expire
  after eight seconds and never replay historical results on scope entry.
  Browser dock controls are an explicit unsaved preview, not an OS overlay.
  Companion updates change native placement, zoom and focusability only when
  their values differ. Follow the main window's display identity rather than
  each intermediate drag bound; qualify movement and display transitions with
  the companion tests without repositioning the main window.
  Restore the island reply input's focus during updates only when the native
  host reports that window focused. Windows can retain document.hasFocus() and
  activeElement after native blur; neither is sufficient without the host signal.
  On Windows, companions lose native focusability on blur and regain it through their
  private preload's trusted pointer gesture or an explicit island-open action.
  Background DOM replacement must never reactivate a companion window.
  Keep that dynamic activation gate Windows-only: Linux constructor focusability
  changes window-manager integration and cannot be reversed through setFocusable.
  Preserve normal dock focus behavior on Linux and macOS.
  Windows releases run `apps/desktop/scripts/verify-window-interaction.mjs` in
  an isolated profile, checking typing during companion updates and native position
  retention from normal and maximized windows. Its optional `--pointer` mode
  requires an interactive desktop; CI marks that gesture NOT RUN separately.
  Retain its qualification receipt and never call a native bounds test a real drag.
  Island scope filters are device-local and keyed by the full account/Space scope.
  New-scope defaults never overwrite explicit choices; switching that default in
  settings freezes known scopes first. Excluded scopes publish no question reads.
  Legacy preferences acquire safe defaults without losing size/behavior. Browser
  Island controls are an explicit unsaved preview, never an OS-overlay claim.
  Size sliders preview while dragging and commit on release/keyboard/blur, retaining
  confirmed values on write failures. Idle branding uses the Mycellios mark and
  clears on sign-out, including an empty roster.
  The detached collapsed island uses a 212 x 32 capsule at default scale, with
  avatar and state at opposite edges; keep names and question text in its expanded
  panel and accessible label. Rasterize the actual avatar body, excluding decorative
  rings, and embed only bounded same-origin sprite assets before SVG-to-PNG capture.
  The question island publishes only current ordinary pending asks while enabled;
  keep credentials and approval cards in the main chat. Re-read the owned thread
  before each answer, preserve the server answer fence, bind every IPC response to
  account/Space/prompt/nonce, and revoke pending actions on scope exit. Later only
  collapses the panel. Test companion questions, renderer and trusted native bridge.
- Device Voice preferences select automatic/local/provider/device dictation and
  local/provider/device spoken output. Explicit device playback wins over an installed
  Supertonic model and never uploads text; explicit local dictation fails closed if
  Parakeet is unavailable. Parakeet shows automatic language detection without
  overwriting the saved provider hint. System-default recognition keeps the actual
  browser language region. Voice previews are scoped, cancellable and stop on
  engine/voice/speed changes. Native preparation blocks settings navigation. Model downloads require a user gesture. Optional screen-usage reporting
  is off until this device opts in; this does not disable security/error reporting.
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
  Keep authorized memory, user-clarification and page-browser schemas in the
  initial catalog. Schema paging never admits a tool the run cannot use.
- Micos created in Desktop default to This PC (`dedicated`), each in its own
  native folder, as the reference app's agents work on the owner's computer (behavior
  reference only); local-access consent is still requested before binding.
  Elsewhere, new ordinary Micos use `isolated` server computers with distinct account/Space/
  Mico home keys. Keep Team sharing and explicit This PC (`dedicated`) unchanged,
  including the installed-account first-run route. Creation allocates stopped
  metadata only, under existing quotas. Never move existing assignments by default.
  Derive the internal isolation pin from the owned Computer; reconnecting Desktop
  cannot redirect an isolated workspace. Reuse private leases, fencing, approvals,
  takeover and recovery. A local project requires a supported explicit computer
  selection, never an implicit PC fallback. Qualify isolated creation/routing with
  scripts/verify-workspace-sync-db.ts and the actual controls/overlay with
  scripts/verify-isolated-computer-ui.mjs; fake screen/provider results do not
  qualify a real container, operating system or multi-host execution.
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
- Mycellios SSO reuses the configured OIDC provider. Authenticated bootstrap/me
  and provider-directory setup resolves only the current user's linked issuer, creates an owned native
  key server-side and requires contribution funding. Never return OAuth tokens
  or model keys to the browser, or select identity by email alone. Operator model
  defaults set the initial limits; saved connection settings remain authoritative.
  Setup has a bounded sixty-second overall deadline for public authority round trips;
  keep individual service limits, cancellation and unused-key revocation intact.
  Mycellios stays pinned in the model picker without a saved key. Automatic setup
  chooses its available default only for an unset account main role; retain personal
  providers and explicit Mico/Space choices. Outages leave a read-only unavailable
  state and explicit retry. Reject deletion, renaming or replacing its account
  key/endpoint through generic provider RPCs; legacy bulk disconnect preserves it.
- Native account-service failures return an unavailable response without exposing
  diagnostics or switching funding sources. Preserve revocation of unused keys.
- Browser saved-login fills must check the current origin and focused input type
  together. Passwords belong only in password fields; partial fills are cleared.
- Page tools on Docker computers follow phase 1 of specs/agent-browser-tools/spec.md at the
  repository root: browser_act press, scroll, hover, wait (15 s a step, shared by one call's
  waits) and dialog; browser_navigate returns the first snapshot; browser_snapshot `from` reads
  later parts with the same refs. Send these only after the helper's `capabilities` lists them;
  on an older image or supervisor the steps before the first unsupported one run and the result
  says it, never a replay. A dialog that a navigate or act opens ends that step and a keeper
  process holds it for the conversation's next call (10 minutes, outside the display lock), which
  answers it with a dialog step first; other calls on that tab are refused, and dialogs nobody
  holds stay for a person. Dialog messages are untrusted page text. Verify test_page_browser.py,
  browser-tools, computer-browser and page-browser-route tests and the page-browser e2e;
  activation needs a new computer image and supervisor.
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
- Direct Groq GPT-OSS runs use the published free-tier TPM as a conservative
  per-request ceiling when the key's tier is unknown. Apply it before compaction
  and admission, including Desktop's account transport; preserve smaller saved
  limits. A verified lower 413 ceiling stays local to the current run.
- In-run history compaction uses the effective transport/model budget before main
  admission. Summarize only historical data with the same owned connection, no
  tools, bounded chunks/calls/time and separately attributed compaction usage.
  Plan summaries with the same bounded reply headroom as admission. Skip
  summarization when the current message and required instructions leave no
  room for a useful summary. Verify context-compaction and pi-compaction-offline.
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
  Use the current attempt's output ceiling for local admission. Context rejection
  logs distinguish local admission from provider overflow and contain only model,
  run and sizing metadata.
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
  Empty accounts see one reference-style first-run choice (FirstRunChoice): free
  models (recommended) connect Mycellios and make a zero-priced managed AntSeed
  route (`mycellios/managed/*`, external processing; see lib/free-models.ts) the
  main role when one exists. Free models come only through AntSeed: never offer a
  zero-priced network model or fall back to OpenCode's anonymous free models;
  without the AntSeed route, say none is available. A subscription goes to ChatGPT/Claude sign-in or an
  installed Codex/Claude Code/OpenCode. Both create the default team without model
  calls; analytics stays opt-in. The team builder remains at /onboarding/team.
  Explicit role/audience/start choices create bounded templates without model calls.
  Verify with scripts/verify-onboarding-team-ui.mjs.
  Preserve configured providers and Space-scoped spawn keys on retries; setup
  profiles use bots.createProfile so creation never starts automatic inference
  and older servers fail before creating a profile. Keep the
  single-Mico, native-provider and import paths. Verify team catalog/creation/UI
  tests and the isolated onboarding browser fixture without live accounts or spend.
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
- Mycellios chat discovery uses the owned canonical `/models` catalog. When external
  metadata expires, wait once on the owned `/managed/catalog` read and reread
  canonical admission under one deadline. Do not expose expired prices as available,
  admit raw inventory, start inference or switch payers while refreshing.
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
  Keep the production Lingui catalog loader in Vitest: related-test discovery
  traverses lazy PO imports. Verify catalog-asset-loader.test.ts when changing it.
  Linux lifecycle and publishing fixtures require Bash, Python 3, jq and procps
  (including the external `kill` command). Installer smoke fixtures also require
  curl, OpenSSL and the Docker CLI.
  Image credential checks inspect saved layers with Python 3 and never start
  the application. Keep the archive-policy fixtures passing, reject unsupported
  encodings, and retain the third-party `node_modules` exclusion. The check also
  rejects secrets deleted by later layers because they remain recoverable.
- Inline dictation uses the platform's interim speech results when available,
  falling back to the configured recorder when the browser cannot stream.
  Keep calls and note recording on their configured transcription paths and
  fence capture by composer scope. Inline dictation appends to the editable
  draft. A voice note attaches playable audio through the existing upload
  path. Both require Send.
  Verify dictation, composer, voice.spec.ts and call-session tests as applicable.
  Composer dictation is independent of the deployment's phone-call capability;
  disabling calls must not hide or disable the microphone in text chats.
  Desktop reports already installed voice models as ready after verifying the
  pinned files on disk. A status check must not download files. Keep confirming
  the transcription and sending the draft as separate actions in the composer.

- This is a public repository: assume all tracked content and diffs are public. Never commit secrets, `.env` files, private URLs, personal/customer data, or real production data; use fake placeholders. Review `git status` and the staged diff before committing, and never force-add ignored files. If private data appears, stop and alert the maintainer.
- Mycellios is one product across web, Electron desktop, and Expo mobile; Electron hosts the web UI. Put shared behavior, contracts, API logic, and reusable UI in packages. Keep only genuinely native navigation, storage, permissions, and interactions platform-specific. Core workflows must cover every applicable surface or degrade safely for an explicit reason.
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
- The API and worker refuse to start when the runtime login cannot see a table or column their Prisma client uses (`assertDatabaseSchemaCurrent`), so a release whose migrations were not applied fails its health check and rolls back instead of serving 500s. Deploys apply `npm run db:deploy` as the owner before starting the new image; never skip or weaken the check to get a release through. Verify schema-compatibility tests and the row-security PostgreSQL test.
- Treat auth, secret handling, sandbox boundaries, host commands, and integrations as security-sensitive. Keep tests deterministic and offline by default.
- Judge natural-language meaning and factual claims with an LLM and an explicit, versioned rubric calibrated against reviewed examples; do not grade free-form prose with keyword lists, regexes, or exact wording. Keep deterministic assertions for observable effects and structured output contracts. Keep judge calls opt-in and provider-neutral, report their cost separately, and treat judge errors as unqualified results rather than passes.
- The desktop Playwright suite (`npm run test:e2e --workspace @mycellios/desktop`) opens real Electron windows and steals focus on macOS. Do not run it on a maintainer's machine as routine verification; run the unit tests locally and let CI's virtual-display job run the e2e on push.
- After creating a pull request, stay with it until CI and automated review bots have finished; passing checks alone do not mean the review is complete. Follow `.agents/skills/pr-watch/SKILL.md`: run its `pr-digest --watch` helper as a single backgrounded call that blocks until a new review comment or check failure arrives or the checks on the current head commit are terminal, then act on the verdict it prints and watch again. Do not poll in the foreground on a timer, which mostly buys repeated snapshots of an unchanged PR and dies at the tool timeout. Address every actionable issue, push the fixes, and repeat until no actionable feedback remains. Do not merge while review bots are still pending or review issues remain unresolved.
- PR descriptions say why the change exists, what changed, and how it was tested. Write Why as the product reason (what was wrong and what this changes); never "Elie wants" or a third-person briefing of a named person; the maintainer is the author.
- Commit messages, PR descriptions, issues, and review replies are public too. Describe test results in words instead of pasting tool output. Never include business metrics such as analytics, traffic, click-through, conversion, signup, revenue, or star-growth numbers; give the product reason in words, even when data motivated the change. Never include anything that identifies a person, machine, or account: local paths, usernames, hostnames, signing identities, legal entity names, Apple Team IDs, API key IDs, issuer or tenant IDs, account emails, or the accounts, machines, and files that secret values came from. Naming the secrets a workflow reads is fine; use placeholders when a value must be shown.
- For UI changes, link the CI E2E screenshot that shows the change on the PR; add the web test that opens that screen if it is missing. For native-only mobile UI that CI cannot capture, say so in the PR instead of linking an unrelated web screenshot.
- UI system. Colors live in `@mycellios/ui-tokens` as semantic tokens (background, card, muted, border, primary, destructive, ...) with one TypeScript source that generates `tokens.css`; never hardcode a product hex or use `[var(--â€¦)]` arbitrary values. Web and Electron use shadcn/ui on Base UI, vendored into `packages/ui-web` via `npm exec -- shadcn add` from the official registry only (third-party registries are a supply-chain risk); reuse those components before writing chrome by hand, and reuse `apps/web/src/components/ai/` for AI moments (loading, shimmer, success). The app is monochrome: primary is ink, status colors are destructive/success/warning, bots carry the only identity color. Mobile is native-first: Expo Router, Expo UI, native sheets, menus, alerts and pickers wherever one exists; custom surfaces (thread, composer, avatars, cards) use plain StyleSheet with the shared tokens through `apps/mobile/lib/appearance`, and system chrome stays PlatformColor via `lib/native`. Mobile may diverge from web when the native pattern is better.
- On mobile, use built-in native iOS controls (@expo/ui SwiftUI and Liquid Glass, native header items, context menus, alerts, pickers, and switches) wherever possible instead of custom React Native pills or buttons.

- This Agent is now maintained inside Mycellios/mycellios under src/agent. The
  parent repository's npm-only rule supersedes upstream pnpm command examples.
  See specs/agent-integration/spec.md at the repository root for pending gates.
  Keep this workspace's package-lock.json and install its own dependencies with
  npm; never junction node_modules to a sibling checkout. First-party packages
  must resolve to this checkout. Run frontend commands in apps/web (or with
  --workspace @mycellios/web) so Lingui finds its configuration. Do not validate or
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
  On mobile web and PWA, the chat opens the same review workspace full width.
  Keep the conversation mounted, put browser navigation in the bottom toolbar,
  and hide address, tabs and review tools until requested. The web history covers
  addresses opened from the toolbar. Desktop uses native page history.

- Native Desktop admission binds the owned computer before sending a turn. Generic
  project workflow is added using expectedInstructions conflict checks, retaining
  owner instructions. PROJECT.md in each private workspace stores verified local
  or SSH/live destinations and runbooks, never credentials. Projects are optional.
  Verify native-computer-execution.test.ts and native-computer-workspace.test.ts.

- Running-chat status shows the current step and elapsed time. The timeline stays
  open on desktop and lists the specific command, path or query, with live output
  on that step. Mark errors or waits there. Leave worker timestamps and empty
  metadata out of the chat. On narrow screens, keep a single activity row and open
  the timeline in a sheet on demand. Preserve actionable blocked/waiting states
  and keep observation independent from cancellation/retry. Verify
  RunActivityStatus.test.tsx and the mobile activity sheet case in
  tool-activity.spec.ts.

- Narrow chat transcripts keep message actions in a sheet opened by holding a
  message, with a focusable trigger for assistive input. Keep scroll, links and
  desktop hover actions usable. Verify message-hover-actions.spec.ts.
- Narrow workspace navigation fills the viewport and keeps search at the bottom.
  Keep account tools behind the overflow and folder expansion scoped to the
  mobile layout. Verify mobile-sidebar-swipe.spec.ts.
  On desktop, keep search visible below the expanded sidebar header. The search
  icon in the collapsed sidebar expands it and focuses the same field.
  The desktop rail footer follows the reference app, top to bottom: usage, Hifa Store,
  Help, Settings and the server menu last. It has no account avatar or app
  marks; sign-out lives in Settings > Profile, integrations in Hifa Store, and
  the account footer remains in the mobile navigation. Place credits and compute
  contribution at the foot of the chat sidebar.
- The full-viewport Settings panel owns its current section. Keep the roster,
  transcript and side panel frozen behind it (FrozenWhileCovered) so section
  changes do not re-render the hidden app; they catch up on close.
- The transcript follows geometry changes only while the reader is at the end.
  Preserve history and explicit reply jumps, and animate only newly appended
  messages when motion is enabled. Verify chat-progress-messages.spec.ts.

- Explicit initial computer assignment may ignore only the automatic
  created/waiting_input introduction on an unoccupied team placeholder or idle
  native Desktop binding. User questions, queued/running introductions, controls
  and execution leases still block reassignment. Modern sends preserve mode.
  Verify initial-computer-assignment and modern/legacy native-first-chat fixtures.

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
  @mycellios/desktop`; invoke it through npm so its locked toolchain is inherited.
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
  packaged Windows login startup restores the connection. Desktop has no tray
  icon. Launching it again reveals the existing window and File → Quit disconnects.
  Closing a window that would quit Desktop and choosing Quit from the application
  menu both require explicit confirmation while local or relayed work is active.
  A hidden Mac window keeps its relay alive while work is active. Verify the
  quit-with-active-work tests along with the account computer background tests.
  Revocation disables host access and background login startup.
  Verify account-computer.test.ts, account-computer-background.test.ts and the
  native/API/broker desktop-relay tests, plus upgrade-continuity.test.ts.
  Native ES module bundles retain the existing createRequire banner for CommonJS
  runtime dependencies; qualify compiled module evaluation as well as syntax.
  Resolve shared root protocol dependencies through the Agent build's own pinned
  node_modules as well, so native bundling does not require a parent install.

- Repository-root `.github/workflows` owns Mycellios CI and publication. Nested
  `.github` files here preserve the imported upstream CI reference for offline
  security-boundary tests; they do not execute as workflows in this repository.

- Self-host defaults name this repository: `install-images.sh` fetches its
  `infra/compose` files at the tag it installs, Compose files and env examples name the
  `ghcr.io/mycellios/mycellios` images, and the updater reads only this repository's
  `v<semver>` tags (never `desktop-v*`). An install whose `.env` names the upstream images
  keeps them until its owner moves: the installer asks once and records the answer, the
  updater offers `POST /move`, Desktop's Docker stack moves on its next start. Every move
  first runs the target image's migration check and changes nothing when the database
  records a migration the release lacks. Never pull this repository's tags from the upstream
  namespace, and keep rollback on the exact cached image under its old name. Verify the
  install-images, updater, local-stack tests and scripts/verify-migration-history-db.ts.

- Native image generation uses only the run owner's already admitted Desktop
  computer and that host's ChatGPT-backed Codex session. Preserve explicit
  provider choices, bounded PNG transfer, nonce/thread/turn validation and
  cancellation; never transfer account credentials or retry uncertain generations.
  Verify native-image-generation.test.ts and codex-image-worker.test.ts.

- Desktop relay queues bound both waiting requests and buffered bytes separately
  from execution slots. Claim each operation once; report only delivered IDs as
  active. Preserve owner/generation fencing, queued cancellation and distinct
  queue-pressure/disconnection errors without automatic command replay.
  Quitting or update restarts call the `release` action, ending presence at once
  while keeping consent and the execution preference (unlike `revoke`). Wait at
  most two seconds for pending notices before closing the windows. An offline
  profile skips the relay wait. A start the
  PC never claimed requeues the run as not dispatched and frees its segment; a
  claimed start stays uncertain. Verify the broker, stream, runtime and API relay tests.
  A deploy hands the in-memory broker to a new API version through
  `/internal/desktop-relay/handoff` (never through the public edge; signed with the relay
  key; `node dist/cli/desktop-relay-handoff.js status|start|cancel` inside the container).
  `start` (15 minutes unless renewed) refuses new operations and probes with 503
  `desktop_updating`, so turns wait (ComputerUpdatingError(false): setup retries without the
  setup limit, PC work pauses and continues) and are never read as offline; callbacks of
  agent runs open on that instance still pass. Every answer carries the instance, revision
  and open/delivered/agent-run operations a handoff waits for; `cancel` is the rollback.
  If an active Desktop turn loses the relay without a handoff, only a correlated
  run transport interruption with a captured tool checkpoint starts a recovery
  segment. Mark pending calls uncertain and reuse the command-receipt checks.
  A second interruption of that recovery or a missing checkpoint keeps the
  existing manual recovery path. Verify executor-turn-checkpoint tests.

- Only the relay's own answer (200, or 404 unavailable) says whether a PC is available.
  A probe that times out, loses its connection or finds the relay busy (409, 429, 5xx)
  throws DesktopUnreachableError: never "offline", never a move to a server workspace.
  Before the turn starts or reaches the PC it is a counted setup failure (same requeue,
  backoff and RUN_SETUP_FAILURE_LIMIT) that ends with that error's own sentence; after
  either, it is never replayed. It only holds back work whose computer is the PC:
  Micos on server computers keep running as if the PC were offline. Verify desktop-relay,
  host-aware-sandbox, offline-cloud-workspace, desktop-agent-runtime and
  executor-lazy-computer tests.

- Desktop diagnostics reuse the relay and native lifecycle hooks. Keep fixed
  failure codes, phase/stage and operation UUIDs through the transport and safe
  persisted run-error suffix; diagnosed interruptions retain the uncertain-result
  retry fence. `apps/desktop/src/diagnostics.ts` stores metadata only in two bounded
  local files, with bounded pending writes and an unclean-session marker. Never
  record request/response bodies, commands, URLs, credentials or raw exception text.
  Native Help / Copy diagnostics and chat error Details / Copy diagnostics are
  explicit local copies, not uploads. Preserve partial-copy fallback when disk
  stalls and keep diagnostic failures independent of execution. Verify the focused
  desktop-diagnostics, desktop-agent-stream, native relay, retry and composer tests.

- Developer mode exposes a Copy link action beside the current Mico. Build its
  URL from the deployment origin/base and owned bot, Space, conversation and run
  IDs; reuse noticeSpace/task routing, never copy arbitrary query/fragment data
  or issue a public sharing capability. Keep it hidden outside developer mode,
  preserve authentication and verify developer-context-link and its copy control.

- Never ask honors the account owner's standing approval choice for resumed and
  unattended work. Keep explicit action blocks, account/Space ownership, native
  computer consent and credential scope enforced. Outside content remains data,
  not authorization for unrelated work. Reload the saved choice before each tool.

- Server bundles use scripts/tsconfig.server-build.json to resolve executable
  dependency exports independently of typecheck-only aliases. Preserve automatic
  JSX and verify the compiled fixture with scripts/build-server.test.mjs. After
  building API and worker, run scripts/verify-server-startup.mjs to evaluate their
  imports without credentials or a database before promoting the sealed package.

- Native workspace probes do not prove that the directory exists. Provision
  creates the owned home before reusing a cached reference, and running checks
  verify its directory. Preserve existing files and contained writes; verify
  desktop-workspace-recovery and host-computer tests with attachment transfer.

- Interactive Pi/Codex/Claude/ACP runs share update_work_plan and bounded
  continuation in their existing session. Never infer task completion from a
  provider turn ending. Preserve Stop, human pauses, usage observers and effect
  idempotency. Await actual background-shell results without rerunning commands;
  fail exhausted/no-progress runs explicitly. Silent delegated/routine runs retain
  their separate lifecycle. Verify work-continuation, native-agent-runtime, Pi
  dispatch, shell-command-stream and executor repeated-call regression tests.

- Desktop send preparation preserves the saved Team/dedicated assignment; native
  workspaces are already account/server/bot scoped. Never switch computer mode to
  admit a message or bypass active-run checks. Verify native-computer-workspace
  and native-computer-execution tests, including waiting introductions.

- Namespaced web routing accepts both the bare entry and its trailing-slash form;
  keep asset URLs namespaced and preserve deep links. Verify app-path.test.ts.

- Mico avatar preferences persist together in the existing `bots.color` shape
  encoding. Keep the reserved appearance slots stable and preserve legacy
  shapes and uploaded images. The default collection uses twelve mycelium forms with vivid brand pairings and 24 palettes; historical animal
  slots are decode-only and display as mycelium. Slots 4000/4400 encode the eleven new bodies without changing historical slots. Choose light or dark eyes
  using the actual shaded face color. The twelve velvet bodies use short frontal felt eyes with per-body scale; avoid applying a spherical head rotation to them. Frame each velvet body from its full alpha silhouette with 32 source pixels of padding; preserve source face anchors when changing crops. Keep explicit web velvet
  choices and the original-color option. Animate the eyes in web previews and
  honor reduced motion. Verify bot-avatar and create-bot-dialog tests.
  Empty personal chats use the selected Mico's full saved color/shape encoding
  and identity, matching its roster and dock rather than the generic brand avatar.
  Non-loading brand placeholders use AuthMushroom with the shared velvet BotAvatar; the historical mark is reserved for MycelliosLoader/loader.svg. New Mico opens with the green brand mushroom, which also starts the automatic
  avatar assignment in an empty space. Later Micos use the mycelium rotation. Web eyes use the MIT Bloub idle drift/blink math through a shared 30 fps clock, paused offscreen, on blur and under reduced motion. Verify mycelium-avatar.test.tsx.

- Mico creation lets users enter the purpose and optionally choose a connected
  model. Validate and persist the model before the intro can be queued. Keep
  appearance options available in the compact creation form and Avatar Studio.
  After account/model setup, an empty space shows the first-Mico form in
  Conversations. Create only on submit with the Space-scoped first-Mico key.
  Every Mico starts with one welcome turn (`botIntroPrompt`): a single ask_user
  card that says who it is and offers three first tasks for its role, following
  the reference app's welcome (behavior only, our own words). bots.create queues
  it at creation; profiles, spawned Micos and Micos still waiting for a model get
  it through `bots.welcome` when their untouched main chat opens. The server
  queues at most one and none after any run, user/bot message or import; spawned
  Micos get no "Created by" notice. Verify the bot intro run tests in router.test.ts.
  Suggestions fill the editable name, purpose and avatar in both creation
  layouts, preserving the selected model and waiting for explicit submission.

- The conversation header adapts to its own container width when a side panel opens. Keep action buttons from shrinking, collapse the model label, and retain narrow task navigation through its menu.

- Profile summarizes 365 civil days from the existing Space-bound usage.dashboard
  in the user's timezone. Never describe these account/Space totals as device-only
  activity, count cached token buckets twice, or turn missing usage into zero.
  Keep exact/known totals and partial coverage, account/Space async guards and
  previous data on refresh failure. Share renders a reviewed local PNG with only
  display name and aggregates, never email, identifiers or conversations; it does
  not publish. Reuse the existing name/sign-out and owned-session revocation flows.

- Keep the Mico settings overview compact. Open instructions, memory, computer,
  permissions and advanced controls in separate views within the same panel.
  Keep instruction drafts and their conflict baseline across that navigation.
  Verify bot-panel and InstructionSettings tests.

- Busy chat sends distinguish queued messages from corrections to the live task.
  Mico owner preferences use preferences.micos/updateMicos with revision-based
  conflict detection. Account defaults and nullable per-Mico inheritance stay
  separate from the device busy-message default. Bulk changes affect only owned,
  unarchived Micos in the selected Space. Models cannot edit these permissions.
  Local scripts additionally require a native host grant bound to server/account/
  Space, a private bearer key and a durable per-Mico rolling hourly quota. Keep
  the loopback listener browser-inaccessible and its fixed RPC allowlist narrow.
  Run scripts/mico-local.mjs --connection <private-file> --request <request.json>;
  requests contain action, botId and nonce (send also text; routine routineId;
  answer runId/messageId/answer; approval runId/messageId/decision allow or deny).
  Never print the connection key. Old Desktop builds and web cannot grant a host.
  start_new_chat saves encrypted handoff notes, rotates only a long personal
  chat after completion at an idle boundary, and invalidates old checkpoints.
  Keep history, queued work and manual-reset guards; never create a paid follow-up
  merely to rotate context. Plan/co-author guidance grants no action permission.
  Explicit queue entries use steering origin queued_user and are drained one per
  turn in queue order (steering_messages.position: the message seq, reordered among
  the queue's own positions; Send now goes first); a held first entry (edit) stops the
  drain until Save/Cancel and never expires; a usage-limit or sign-in failure leaves the
  queue waiting. The running turn must not claim them as steering or release a human
  takeover; only Steer now (refused during routine/own work) turns one into owner
  steering. Queue controls (specs/mico-message-queue): Steer now, Send now (stops only
  the current turn), Edit (sealed editDraft, takeover keeps it), Delete only while
  queued (removes the message, thread.message.deleted), stale-checked reorder and Move
  to a new conversation (one transaction, S1 title, bot targets only). Every action takes
  the thread lock. Verify queue-panel, queued-message, events, steering-delivery and
  runtime steering tests and `node --import tsx scripts/verify-message-queue-db.ts`.
  Steered messages reach the model behind STEERING_FRAMING_NOTE (the chat keeps only
  the person's words): Pi between steps, native engines after their next tool result;
  a running shell yields to the background (never killed) while one waits. A turn
  waiting for its own background commands shows a timed "Waiting for background work".
  Queue reads use the authenticated owned thread resolver, including side threads.
  Micos may override the device's busy-message default. A null override inherits
  the device setting. Keep group conversations and the per-message choice independent.
  Keep delivery choices inside the composer's Add menu, not in a persistent row
  beneath the field. Show the queue panel only when saved queue entries exist;
  Ask aside shares the Add menu and never sends or steers the main task.
  Repeat automatically opens an unsaved routine from the original user request;
  it never schedules an assistant result or starts a routine before Save.

- Composer retry re-reads the owned thread and targets only the saved failed user
  run. Never offer it for introductions or copy text/files to replay a request.
  Keep API effect fences and chat/Space/unmount guards; reconcile known conflicts
  without another POST. An uncertain Desktop dispatch cannot be replayed even
  when no effects were recorded. The model picker in the error notice changes
  only the Mico's model settings. Verify web/API retry-thread-run and composer tests.

- The empty routine canvas and schedule show explicitly labelled inert examples. Only Create
  opens a real draft; preview motion must pause when hidden, offscreen, on request
  or under reduced motion. Never render failed routine loading as an empty success.

- Desktop server history is private servers.json, with validated addresses and no credentials.
  Connection management stays in the trusted setup window; the connected renderer
  may only open that window with an already-saved address. Probe and mount before
  committing a switch; retain origin-partitioned sessions and rollback on failure.

- Floating chats share the active server session but pin their Space without
  writing the main window's selected Space or composer draft. Their preload is
  chat-only; do not grant local computer or account configuration authority.
  Close them on account/server changes and include every chat in update readiness.
  Dock opening mode defaults to the main window for existing profiles.
  Mobile setup QR codes contain only the current reachable server URL, never
  credentials. Session revocation uses the authenticated account's existing API
  after confirmation. Verify floating-chats, preload, rpc and MobileSessions tests.
  Keep session tokens redacted. Revoke an owned session by public ID through
  the fresh-session auth endpoint, preserving audit and device-disconnect hooks.
  A stale sign-in opens normal account confirmation instead of a generic error;
  confirm the resulting account before reloading sessions. Never disable freshness.
  After the native Desktop build, run
  `node apps/desktop/scripts/verify-floating-chats.mjs <receipt-directory>` from
  `src/agent` for the isolated real-window/session qualification on Windows.

- Continuous voice uses a flush 50px header, a scrollable body and fixed controls.
  Local model preparation is single-flight and must never start capture after
  the owning panel closes. Native ASR and TTS share a worker; stop capture before
  local synthesis. Contribution uses the existing verified-account controls and
  never implies that donating compute enables distributed speech inference.
  Local dictation and speech model files are managed independently in one shared
  Desktop cache. Only remove pinned files for the selected model while inference
  and downloads are idle. Retain per-window cancellation and keep a recording
  started in local mode on the device even if its model becomes unavailable.
  Verify local-voice, preload, TaskComposer, dictation, tts and VoiceConversation tests.
  Network spoken replies are an account-scoped opt-in in continuous voice.
  Send only reply text to the canonical Mycellios speech model with explicit
  contribution funding. Authorize the Mico and saved account connection and
  verify bounded WAV output. Do not retry or switch providers on a paid failure.
  Network dictation has a separate account-scoped opt-in. Pin the account, Space
  and Mico before recording and recheck before upload; never inherit audio consent
  across accounts. Existing device/provider dictation remains the default. Convert
  to bounded PCM on the device, with no paid retry or provider fallback. Verify
  network-transcription-isolation, dictation-network and transcription-audio tests.
  Verify mycellios-network-speech, voice and tts tests.
  Network voice errors carry only allowlisted public reason codes; rejected model
  keys are 403, never a lost-login 401. Preview requests are single-flight and
  scoped to the account/Mico/Space; cancel on output changes and ignore late results.
  Mico settings keep individual overrides in a visible searchable list. Block
  navigation while an override is being saved and retain confirmed values on failure.
  Native host admission and missing-executable failures use computer recovery,
  never a generic provider error or a blind retry. Preserve native host consent.

- Sidebar contribution is a direct contribute/pause action. The warm bottom-edge
  indicator requires a supported, connected, confirmed contributor and clears
  on errors or unmount. Animate only verified contribution-earned deltas; never
  mint display credits from timers, purchases, promotions or unconfirmed jobs.
  Verified browser work requests a wallet refresh in bounded one-second bursts;
  only authenticated wallet deltas can change the displayed earned balance.
  Preserve sanitized authority 401/403 statuses through the adapter and RPC so
  revoked sessions clear stale balances, without exposing response diagnostics.
  Contribution activation uses `motion/mini`; cancel all playback controls and
  remove the transient SVG on pause/unmount. The diffuse bottom halo follows
  confirmed connectivity, never the activation animation or an inferred credit gain.
  Local SSO is explicit: `.cache/local-sso-enabled` loads only the dedicated
  Dev OAuth client from Windows DPAPI, never inherited production credentials.
  Its registered loopback callback on 5188 forwards only the exact OAuth GET to
  local auth; preserve issuer, nonce, PKCE and explicit account-link checks.
  Keep project-preview data and password sessions during this opt-in upgrade.
  Verify `node --test scripts/project-local-env.test.mjs scripts/project-local-sso.test.mjs`.
  Browser earnings bind the live worker proof through the linked SSO session and
  canonical coordinator; never forward an OAuth token to browser compute or accept
  a client account ID. Check the same worker coordinator's public contribution
  capability before loading compute. Only confirmed payout binding activates the
  activity indicator and verified-wallet notifications. Cache only successful
  bindings; bound transient retries and abort them on pause/account changes.
  Unavailable services or permanent linking failures pause compute, preserve
  the wallet balance and offer an in-place retry with the correct failure reason.
  Keep failed payout linking visible. Settled notifications
  request bounded wallet reads, never directly increment the display.
  Browser contribution loads src/mobile/runtime only on activation, uses its signed
  identity and the same-origin /mobile/v1 transport, and stops on account changes
  or unmount. Embedded mode must not reload the chat or restore compute from a
  standalone worker's update flag. Development transport targets are fixed to
  Mycellios or loopback; never forward Agent cookies. Matrix verification is not
  evidence of a credit award. Verify BrowserContributionControl/SidebarContribution
  tests and the real local browser/coordinator activation-pause cycle separately.

- Roster hover previews use existing scoped row messages and real run states.
  Do not fetch threads or mark messages read on hover; keep clicks, context menus
  and drag reordering intact, and suppress previews on touch and during dragging.
  A Mico with open conversations gets a 700 ms card that lists only conversations already
  loaded (else the roster summary); its links open a conversation, nothing more.
  In the expanded desktop roster, place the existing Create menu beside Search;
  keep one trigger, Ctrl/Cmd-N, and the mobile/collapsed header entry intact.
  Call sections Folders in UI while preserving `botSections`/`sectionId` contracts.
  Folder parents stay within the same user/Space; scope-locked mutations enforce
  three levels and reject cycles or overflowing subtrees. Deletion promotes chats
  and child folders to the parent (or Unassigned), never deletes their contents.
  Keep path labels, ancestor collapse and closed-folder unread counts consistent.
  Verify `sidebar-folders.test.ts`, roster/grouping tests and
  `node --import tsx scripts/verify-sidebar-folders-db.ts` in its isolated database.

- Keep Tasks, the model selector and a single header tools panel toggle on the
  right of the conversation header. Mobile roster navigation opens the shared
  WorkspaceRail actions in a modal side sheet, retaining a visible strip of the
  roster. Preserve Base UI focus/dismissal, RTL and reduced motion. Navigation
  motion never delays cached messages or subscriptions. On coarse mobile pointers,
  focus-input keeps text focus tied to a field/label tap, controls in the same
  fieldset/form, or keyboard navigation; taps elsewhere dismiss it without clearing
  drafts or preventing the action. Composer drafts persist in a short batched write
  and flush on hide, send and conversation change. Verify focus-input, composer,
  MicoTaskTabs and mobile-navigation-motion browser cases.
  Put secondary actions inside the full-height resizable side panel;
  mobile Browser return focus targets the same tools trigger.
  Load selected-model metadata before opening its picker; saved Mycellios model
  IDs must already show a readable name and the Mycellios logo during discovery.
  Display fallbacks never change the saved model or admit an unavailable model.

- The chat has one Browser and computer entry. Both views share WorkAreaHeader;
  secondary library, Mico settings and voice actions stay in its More menu.
  Computer recovery and per-Mico routines remain in state-preserving disclosures.
  Keep browser documents, native preview sessions, iframe sandboxing and computer
  maintenance permissions intact when switching views.

- Native CLIs and connected API models share stable conversation-style defaults; explicit
  user/Mico formatting and silent routine rules take precedence.
  Refresh exact historical host style blocks and keep one selected style at the end
  of each run's instructions, including resumed chats; preserve owner text and spacing.
  Status replies summarize result/blocker/next action, not teammate reports or logs.
  Do not shorten output
  with post-processing or reduce model effort to simulate speed. Text progress publishes
  immediately first, then coalesces at 80 ms, with final/tool-boundary flushes retained.
  Long replies use the same disclosure for plain text and mixed blocks: over 20,000
  characters a finished reply shows its first 3,000 (cut at a line end past halfway)
  with Show full message. Classic keeps streamed answers expanded on completion;
  natural folds them. Reveal search/quote targets without losing text.

- Agent clarification uses ask_user and the inline questionnaire: up to three short
  questions, optional option descriptions and multiple selection, free text and Skip.
  API and native runtimes share the same bounded parser. Persist/redact the whole
  questionnaire and resume only via the existing scoped, fenced answer operation
  (a side conversation's card mirrored into the main chat answers through that same operation).
  Skip supplies no authorization. Credentials and protected actions keep their
  dedicated cards. Verify questionnaire, AskCard, Pi/native pause and continuation tests.
- `ask_location` follows the reference app's location request (behavior reference only, our
  own words): a pausing ask with a `location` field, offered only to person-started turns
  (never routines, webhooks, background or Mico-started work, outside chats, calls or
  call_end). Only the run's user answers, on the card, through the same fenced answer
  operation (a composer message retires the card with no text or outcome): Share location
  reads the browser position once on that click (no watch), rounded to three decimals
  (~100 m) on the device and again on the server; typing a place or declining works
  everywhere, and Desktop offers only typing. A position or place never enters the task
  prompt, the card or events: the run secret writer encrypts it under runLocationKind (local
  only; secret-store migration treats it as ephemeral), every path that ends a run deletes it
  with the run's other one-time answers, and the task keeps LOCATION_ANSWER_NOTE, which the
  executor replaces in the model prompt only. An unreadable answer gives the turn the note,
  never a failure. Run previews show the source request instead of that note. Tool labels,
  commands, output, activity notes, plans, completion errors, ask_user and approval card text
  and their notifications hide the answer through locationRedactionPatterns (case-insensitive,
  URL-encoded spaces/commas, never inside a longer word or number; places and parts under
  five letters stay visible). The model's reply, narration and helper summaries are not
  redacted, nor are other spellings. Never log the answer. The Android host grants WebView
  geolocation only to packaged chat routes, without retaining the grant; the Expo preview
  answers by typing. Verify location-request (contracts/core), location-answer, run-location,
  ask-location, runs and LocationAskCard tests and NavigationPolicyTest.

- Mycellios creation keeps the authenticated viewer pinned for quote, execute,
  status, content and checkout. Keep stable purchase keys, quote-before-confirm,
  GET-only recovery and separate checkout; no blind paid replay or personal-key
  fallback. Voice/duration use the shared selectors; transcription is converted
  locally to bounded PCM; batches/rerank/evaluation use bounded plain text.
  Verify MycelliosCreate and mycellios-media tests. Local synthetic UI results
  do not qualify live supplier inference, actual Credits or real payments.

- Desktop sidebar updates use one compact status/action row: download, progress,
  restart, retry, or postpone an accepted restart. Keep recovery text and manual
  download links in update settings, not stacked beneath the sidebar action.
  Preserve native draft/call/work guards and explicit install consent; waiting
  for those guards must not cover the chat with a full-screen update dialog.
  The one exception is a server-required release, as in the reference app (behavior reference
  only): MYCELLIOS_DESKTOP_MINIMUM_VERSION reaches Desktop through the public auth
  capabilities, reread every six hours. Below it, DesktopRequiredUpdate covers the
  app with the same guarded download/restart actions and a one-hour Not now; it
  never installs on its own. A missing or unreachable minimum requires nothing.
  Verify DesktopUpdates and API env tests.

- A PC workspace belongs to that PC, as the reference app keeps a workspace on its own host
  (behavior reference only, no copied code). Provisioning seeds the saved server copy
  only into a workspace the PC has just created (ref.fresh); never overwrite files on
  the PC. Transfers in both directions leave out `isWorkspaceTransferExcluded` paths
  (.git, node_modules, .env*, private keys, archives); a desktop checkpoint keeps the
  saved copy's own excluded paths. Files above one request move as ordered
  writeFileChunk pieces with a whole-file SHA-256, assembled outside the workspace and
  written through the contained write; hosts advertise this as environment
  chunkedWrites, and older hosts leave the file out instead of failing the copy.
  A completed host result drains until the relay closes; closing early cancels the
  operation and drops the PC's final acknowledgement. A setup failure after a turn
  reached the PC (onDesktopRunDispatched) fails with desktopSetupInterruptedMessage;
  never requeue a dispatched Desktop turn. Verify workspace-transfer, host-computer,
  computer-lifecycle, run-error-diagnostics and executor-lazy-computer tests.

- Durable native command receipts preserve identity, not an implicit one-hour timeout.
  Shell defaults retain the configured bounded budget. Recognized read-only search
  pipelines start at 45 seconds. Identified project scopes may extend only on new
  result locations, with 45 seconds idle and 180 seconds total at most. Whole-home,
  drive-root and parent-tree searches are refused before execution. Native hosts
  enforce the owned process deadline; Docker uses an image-owned Python watchdog
  inside the existing run marker. Older native hosts safely keep the initial limit.
  A timeout returns failure to the same turn.
  Narrow paths before another search, never replay an uncertain command automatically.
  Preserve explicit build/install deadlines, command journals and Credit admission.
  Verify shell-command-budget, search-progress, adaptive-search-runtime,
  shell-command-stream and native-command-recovery tests.

- The managed local server's identity.json (database password, content encryption
  key) is AES-256-GCM sealed with a 32-byte key that Desktop wraps through Electron
  safeStorage (DPAPI/Keychain/libsecret) in local-data-key.json, with an owner-only
  file fallback when no real store exists (Linux basic_text). Pass the key only in
  the utility process environment and delete it before spawning children; never
  write it to server.json. Never regenerate a key or identity while protected data
  exists, never overwrite an unreadable key record, and replace plaintext only after
  its sealed copy reads back. Missing keys fail the local server instead of starting
  an empty installation. Verify local-identity-protection and local-data-key tests;
  qualify real OS stores (including macOS prompts after unsigned updates) per platform.
