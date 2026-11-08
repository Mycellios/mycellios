- The distributable Android host lives in apps/android and packages apps/web unchanged.
  Keep com.mycellios.android separate from the legacy Expo preview and use a durable
  release signing key, never the preview/debug certificate. Native capabilities use
  WebViewCompat messages with exact HTTPS origin, main-frame and packaged chat-route
  checks; external pages receive no microphone bridge. Preserve shared reviewed voice
  and Send nonces, foreground-only capture, permission denial and Recents replay guards.
  Do not register a service worker or use web reload updates over packaged assets.
  Build with scripts/build-android-release.sh and verify scoped web/Java tests, APK
  signature, source seal, manual update continuity and physical Quick Tap separately.

- Native Expo sign-in may share the configured HTTPS OIDC issuer origin with Agent.
  Its authorization proxy accepts only the configured issuer authorize path, client,
  callback, S256 challenge and live server-issued state/nonce. Preserve the upstream
  external-provider flow and verify packages/auth/src/oidc.test.ts for both routes.

# AGENTS.md

- The workspace selector opens Space settings independently of personal Settings.
  Bind each Space panel and its writes to the Space being edited, even when the
  open conversation belongs to another Space. Preserve account model credentials
  and per-Space inheritance for model, voice and approval preferences.
  The native OpenCode engine is opt-in per Mico and uses the server's installed
  CLI over ACP. Preserve operator account/Space grants and a private CLI home per
  conversation. Keep project config and external plugins disabled and deny native
  permissions outside the approved MCP bridge. Verify the scoped settings and
  native-agent-runtime tests. Protocol fixtures do not qualify real inference.
  Managed OpenCode installs are explicitly admitted by allowOpenCodeInstall
  in the host's native-agents.json and the same account/Space grant. Verify
  both artifact digests and preserve operator command overrides, the published
  version directory and the no-fallback model policy.

- Account-owned Desktop execution keeps the existing cloud account, conversations,
  model connections, leases and approval effects. Advertise agentExecution v1 only
  after the native host starts and authenticates remembered account consent.
  Desktop owns the Mico loop; cloud owns credential renewal, real model requests
  and producer-side credit accounting. Send only allowlisted model metadata and
  an owned inference stream to Desktop, never keys, OAuth material or endpoints.
  Keep approval judges on the server and preserve Team/task computer assignments.
  Native run receipts are account/server scoped and forbid replay after restarts.
  Keep the native session open for outstanding callback replies after the engine
  ends. Report completion only after the complete stream and acknowledgements.
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

- The installed PWA Voice shortcut uses ?dictate=1 and the existing scoped chat
  recorder. Consume each request once; start only in a visible standalone app
  after voice configuration is known, without busy work, calls, drafts or files.
  Never send on launch: shortcut dictation goes to an editable review with
  Continue/Cancel/Send. Preserve text and the nonce on refused/uncertain sends.
  Verify voice-shortcut, composer, dictation and PWA manifest tests; physical
  microphone/gesture acceptance remains separate from synthetic browser tests.

- Windows updates check the official HTTPS catalog and stage verified packages in
  the background; installation still requires the owner's explicit restart action.
  The renderer covers the app window once a release is known and renderer work is
  safe. A call may continue until the owner chooses to end it and restart.
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
  A pending restart is cancellable. The hidden same-user helper waits for normal
  exit, snapshots session/installation state, installs and reopens the same profile.
  Never force-stop another process, use Restart Manager shutdown or clear user data.
  Read PowerShell progress receipts as UTF-8 with an optional BOM; qualify the
  actual Windows PowerShell encoding in manual-update-helper tests. Start the
  worker through a hidden non-detached launcher so it survives Desktop's exit.
  Wait on the installer process handle with a deadline before checking its exit
  code and the installed version. Do not wait on the installer's entire process
  tree or roll back over an installer still running. Confirm the reopened
  window against the committed job, target version and child PID. Record failed
  relaunch separately from a failed installation.
  Keep private logs and leave Desktop open until the worker acknowledges.
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
  Windows local PostgreSQL uses bounded pg_ctl readiness and exit status with
  ignored process pipes. Keep the profile lock if shutdown fails.
  desktop-windows-release.yml builds
  release branches/manual runs without publishing. A matching integrated Desktop
  tag can publish, or desktop-windows-promote.yml can promote an already-qualified
  run from main without rebuilding. Require its exact revision/tree, checksums and
  installer receipt; never promote an older tree over newer main changes.
  Never replace an existing release. Use scripts/prepare-desktop-version.mjs for
  a new version; keep the native runtime pin and other platform channels intact.
  Operator-requested workflow_dispatch expedited releases retain the real build,
  artifact identity and packaged-startup gate, but record optional tests/installer
  timings as NOT RUN and qualifiedInstallation:false. Never claim a measured time.
  Verify desktop-release, published-desktop-release, manual-update and
  prepare-desktop-version tests; a signed-out packaged startup does not qualify
  account login, real video generation or physical multi-device inference.
- Workspace navigation uses the single rail and per-account/Space pins. Marketplace
  reuses the existing connection and skill services; preserve multi-account editors.
  Library shows chat attachments and Mico outputs from the existing artifact index.
  Preserve Space scoping, artifact deep links, version history and previews.
  Inbox entries refer to ordinary Mico task threads through taskBotId and the
  mico-task key namespace, never a parallel execution engine. Keep ?task= for
  owned task conversations and ?inbox= for the inbox selection. Archive and sends
  share the exact thread lock; uncertain sends retain their original nonce.
  Calendar and usage queries remain bounded and owner/Space scoped; unknown cost
  stays unknown. Workflow condition branches retain the existing worker semantics.
  Verify scripts/verify-workspace-sync-db.ts and verify-workspace-sync-ui.mjs;
  the browser fixture uses synthetic RPCs and does not qualify real agent execution.
- Continuous voice keeps its immutable Space/task client and stops its owned audio
  resources on close. Track the accepted turn by run and task ID so an older
  chat failure cannot stop the microphone or speak an unrelated reply.
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
  Shell overlay. Preserve the chat draft and scope. The private Video Studio v1 definition is in Desktop assets,
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
  Pi concurrency is admitted atomically per Bot and serialized per thread; native
  engines remain single-turn. Private Pi tasks reserve the existing computer lease
  before computer/file/command tools, never share it between runs. Workflows reuse
  existing Micos, owner/Space RPCs and the existing reconciler, freeze graph versions
  and persist private step runs. Stop commits cancellation and process teardown
  receipts together. Verify workflow contracts, affected wakeup/control tests and
  the synthetic PostgreSQL/browser acceptance scripts through compilar.ps1; never
  use production accounts, credentials or models in these fixtures.
  Workflow thread ownership queries project only userId/spaceId from a Run actor;
  preserve execution identity and verify scripts/verify-workflow-thread-db.ts.
  Delegation from ordinary Mico tabs uses internal work scope; explicit project
  delegation keeps its independent native project binding and admission.

- Settings uses one searchable full-viewport account/Space shell, with a fixed
  section header and independently scrolling content. General contains device UI
  preferences; Profile owns identity/security; Micos opens the existing per-Mico
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
  Reply-notification preferences are local per user/device; per-Mico switches save
  through the owned Space RPC. Hidden previews never reveal reply text or names.
  Open web clients deliver via the active service worker where available, or the
  desktop Notification API otherwise. Suppress notices while a same-account tab is
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
  The push worker uses event-specific copy and bundled notification artwork. Put
  later icons in avatarArt so installed workers with the original allowlist
  still deliver the notice with the generic mushroom. When
  previews are off it displays a generic mascot and hides conversation identity.
  Regenerate the small PNGs with `node packages/ui-tokens/scripts/export-notification-art.ts`.
  Qualify delivery and the destination on an installed PWA on a physical phone.
  Web update checks share the existing guarded tracker; they never deploy servers
  or reload through open settings/drafts/calls. Desktop uses the installed package's
  real updater policy; do not fabricate channel/automatic-install permissions.
  Qualify affected settings/security/model/voice/update tests and the isolated
  `playwright.settings.config.ts` flow. No live OAuth, paid run, payment, password
  change, account deletion, microphone permission or model download is a fixture.


- Mico task tabs bind immutable bot/thread/Space RPC clients, separate query caches
  and composer drafts. Reject snapshots for another thread; never derive task
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

- Mico work delegation uses durable parent/child Tasks, expected results, dependency
  and resource reservations, and revisioned controls. Native command receipts belong
  to the admitted host/Mico and are observed with command_status; a lost observer or
  missing exit is never success or authorization to replay. Preserve native Windows
  Job ownership, consent, Stop, bounded budgets and exact run/fence teardown. Plans
  and continuation counters are fenced Task metadata, not new instructions. Verify
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
  way OpenBot does: the BrowserWindow keeps `frame: true` and does not set
  `titleBarStyle` or `titleBarOverlay`. Caption controls sit in that bar above
  the page. Do not install a host caption strip, a transparent overlay, or page
  padding and drag regions that reserve space for those controls.
  macOS keeps `titleBarStyle: "hiddenInset"` and traffic lights over the page,
  with drag regions only on that platform. The legacy nativeWindowFrame
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
  can also change the general model in the effective account/Space scope.
  If its primary slot is empty, chat may start on the first saved backup with
  an owned connection. Preserve the backup order and the existing funding checks.
  Keep the chat picker compact by connection. Fetch compatible server catalogs
  on demand with the saved credential, and add only the model explicitly enabled.
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
- UI system. Colors live in `@rakazo/ui-tokens` as semantic tokens (background, card, muted, border, primary, destructive, ...) with one TypeScript source that generates `tokens.css`; never hardcode a product hex or use `[var(--â€¦)]` arbitrary values. Web and Electron use shadcn/ui on Base UI, vendored into `packages/ui-web` via `npm exec -- shadcn add` from the official registry only (third-party registries are a supply-chain risk); reuse those components before writing chrome by hand, and reuse `apps/web/src/components/ai/` for AI moments (loading, shimmer, success). The app is monochrome: primary is ink, status colors are destructive/success/warning, bots carry the only identity color. Mobile is native-first: Expo Router, Expo UI, native sheets, menus, alerts and pickers wherever one exists; custom surfaces (thread, composer, avatars, cards) use plain StyleSheet with the shared tokens through `apps/mobile/lib/appearance`, and system chrome stays PlatformColor via `lib/native`. Mobile may diverge from web when the native pattern is better.
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
  On mobile web and PWA, the chat opens the same review workspace full width.
  Keep the conversation mounted, put browser navigation in the bottom toolbar,
  and hide address, tabs and review tools until requested. The web history covers
  addresses opened from the toolbar. Desktop uses native page history.

- Native Desktop admission binds the owned computer before sending a turn. Generic
  project workflow is added using expectedInstructions conflict checks, retaining
  owner instructions. PROJECT.md in each private workspace stores verified local
  or SSH/live destinations and runbooks, never credentials. Projects are optional.
  Verify native-computer-execution.test.ts and native-computer-workspace.test.ts.

- Running-chat status shows a brief health label and elapsed time. Group
  consecutive actions in a short, plain-language timeline and mark errors or
  waits there. Keep raw commands, paths and
  reported execution metadata folded separately, and leave worker timestamps
  and empty metadata out of the chat. On narrow screens, keep a single activity
  row and open the timeline in a sheet on demand, even when auto-expand is enabled.
  Preserve actionable blocked/waiting states and keep observation independent
  from cancellation/retry. Verify RunActivityStatus.test.tsx and the mobile
  activity sheet case in tool-activity.spec.ts.

- Narrow chat transcripts keep message actions in a sheet opened by holding a
  message, with a focusable trigger for assistive input. Keep scroll, links and
  desktop hover actions usable. Verify message-hover-actions.spec.ts.
- Narrow workspace navigation fills the viewport and keeps search at the bottom.
  Keep account tools behind the overflow and folder expansion scoped to the
  mobile layout. Verify mobile-sidebar-swipe.spec.ts.
  On desktop, keep search visible below the expanded sidebar header. The search
  icon in the collapsed sidebar expands it and focuses the same field.
  Keep account and integration controls in the workspace rail and place credits
  and compute contribution at the foot of the chat sidebar.
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
  packaged Windows login startup restores the connection. Desktop has no tray
  icon. Launching it again reveals the existing window and File → Quit disconnects.
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

- Native image generation uses only the run owner's already admitted Desktop
  computer and that host's ChatGPT-backed Codex session. Preserve explicit
  provider choices, bounded PNG transfer, nonce/thread/turn validation and
  cancellation; never transfer account credentials or retry uncertain generations.
  Verify native-image-generation.test.ts and codex-image-worker.test.ts.

- Desktop relay queues bound both waiting requests and buffered bytes separately
  from execution slots. Claim each operation once; report only delivered IDs as
  active. Preserve owner/generation fencing, queued cancellation and distinct
  queue-pressure/disconnection errors without automatic command replay.

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
  shapes and uploaded images. The default collection uses solid animal
  silhouettes and capsule eyes based on the loader. Choose light or dark eyes
  by contrast against the silhouette's fill. Keep explicit web velvet
  choices and the original-color option. Animate the eyes in web previews and
  honor reduced motion. Verify bot-avatar and create-bot-dialog tests.
  New Mico opens with the green brand mushroom, which also starts the automatic
  avatar assignment in an empty space. Later Micos use the animal rotation.

- Mico creation lets users enter the purpose and optionally choose a connected
  model. Validate and persist the model before the intro can be queued. Keep
  appearance options available in the compact creation form and Avatar Studio.
  After account/model setup, an empty space shows the first-Mico form in
  Conversations. Create only on submit with the Space-scoped first-Mico key
  and queue a brief greeting on the configured model or admitted engine.
  Suggestions fill the editable name, purpose and avatar in both creation
  layouts, preserving the selected model and waiting for explicit submission.

- Keep the Mico settings overview compact. Open instructions, memory, computer,
  permissions and advanced controls in separate views within the same panel.
  Keep instruction drafts and their conflict baseline across that navigation.
  Verify bot-panel and InstructionSettings tests.

- Composer retry re-reads the owned thread and targets only the saved failed user
  run. Never offer it for introductions or copy text/files to replay a request.
  Keep API effect fences and chat/Space/unmount guards; reconcile known conflicts
  without another POST. An uncertain Desktop dispatch cannot be replayed even
  when no effects were recorded. The model picker in the error notice changes
  only the Mico's model settings. Verify web/API retry-thread-run and composer tests.
