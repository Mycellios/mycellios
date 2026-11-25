# Make the PC's coding CLIs complete Mico engines

Status: proposed design. No product code changes with this spec.

`specs/local-engine-default/spec.md` decides when a Mico thinks with the PC's
signed-in CLI. This spec covers what that engine can do once chosen: signing in
and out, model settings and plan usage, installing and updating the CLI, running
several conversations at once and adding more CLIs. It does not change the
phases of that spec; phase 2 here reuses its Claude Code catalog.

## Existing behavior

- Engines are `agentEngine: pi | codex | claude | acp | opencode`
  (`packages/contracts/src/domain.ts`). Codex runs through `codex app-server`,
  Claude Code through `claude -p` with stream-json and only the Mico's MCP bridge
  (`--tools ""`, `--strict-mcp-config`), OpenCode and `acp` through ACP
  (`packages/adapters/src/native-agent-runtime.ts`). Every action goes through the
  Mico's tool catalog, approvals and receipts.
- A PC reports only `codex | claude | opencode` in its host-computer
  `environment` reply (`host-computer-server.ts`, `engines.forBot` in
  `packages/contracts/src/rpc.ts`). `acp` runs only an absolute command that the
  server operator writes in `native-agents.json`.
- Mycellios never installs or updates Codex or Claude Code; it looks for them
  on `PATH` (`findNativeCommand`). The only managed CLI is OpenCode 1.19.5 for
  Windows x64, hash-pinned (`managed-opencode.ts`). It is offered only when the
  host's `native-agents.json` sets `allowOpenCodeInstall`, through the server-host
  route `engines.installOpenCode`; a PC reached through the relay never offers it.
- #628 reports `signedIn` for Codex (`account/read`) and Claude Code
  (`claude auth status --json`), and the picker marks "Sign in required"
  (`native-signin.ts`, `chat-header-model.tsx`). The sign-in action that
  local-engine-default phase 1 describes was not shipped, nothing signs a CLI
  out, and OpenCode is not probed.
- Codex `model/list` (models, reasoning efforts, Fast tier) and
  `account/rateLimits/read` run only on a server host with an operator grant
  (`codexModels`, `codexQuota` in `apps/api/src/routes/local-capabilities.ts`).
  The picker asks for that catalog only when `engines.forBot` answers
  `computer: "server"`, so a This PC Mico gets one "Use this account" row per
  engine with the CLI's default model. Claude Code and OpenCode use their default
  everywhere. Choosing a Codex row saves `fastMode: false, thinkingLevel: null`,
  and no control turns Fast on, although `codexTurnSettings` supports it.
- The sidebar plan usage (`ProviderQuota.tsx`) covers saved OAuth accounts and
  the server host's Codex CLI, never a PC's CLI.
- `micoTurnLimit` (`packages/db/src/mico-concurrency.ts`) returns 1 for every
  native engine, main chat included. Engine sessions are already per
  conversation (`nativeConversationFolder` keys on the thread). Pi Micos run up to
  `taskConcurrency` (1-4) side conversations plus the main chat.

The reference desktop app (behavior reference only; PolyForm Noncommercial, no
copied code, prompts or text) installs and updates each CLI into a per-computer
store from the vendor's own release channel, verified against that channel's
hash. It keeps the last working copy until a new one starts, withdraws broken
versions with a list published from its main branch, and prefers the person's
own CLI when it is the same version or newer. It signs each CLI in and out from
the app, also from another device. It reads each CLI's model list (Codex with
its Fast tier), shows plan usage per provider and runs up to four task turns per
agent plus the main chat. It supports about a dozen CLIs, most of them over ACP.

## Decision

Make each engine on the PC as complete as a Pi Mico on the server, in five
phases that each ship alone. Phases 1, 2 and 4 are independent; phase 5 needs
the store from phase 3.

1. Phase 1 — sign in and out.
   - "Sign in required" rows in the picker and the engine detail in Settings get
     Sign in. On the PC's own Desktop it starts that CLI's login there (Codex
     `account/login/start` and the system browser, Claude Code's `auth login`,
     an ACP agent's `authenticate`). The CLI receives the provider's callback
     itself; Mycellios never sees a code, token or account.
   - From another device, Sign in asks the PC for a device code where the CLI
     offers one (Codex) and shows only that code and the provider's address.
     Without one it says the engine signs in on the PC.
   - Sign out lives only in the engine detail. It runs the CLI's own sign-out
     after a confirmation saying it also signs the person out of that CLI in their
     own terminal and in every Mico on that PC.
   - OpenCode joins the probe when its pinned version can report sign-in without
     a model call. A sign-in or sign-out drops the cached probe (60 s) so the
     picker updates at once. Commands are confirmed against the pinned versions.
2. Phase 2 — settings and plan usage from the PC.
   - Desktop answers the reads that a server host answers today, over the
     existing host-computer channel and binding: Codex `model/list` and
     `account/rateLimits/read`, and Claude Code's catalog once local-engine-default
     phase 2 adds it. OpenCode reports the models its ACP session lists, when its
     pinned version lists them. Each read is bounded (10 s), cached for a minute,
     starts no model turn and returns only the allowlisted fields
     (`nativeCodexModels`, `nativeCodexQuota`).
   - `engines.forBot` returns those catalogs for `computer: "desktop"`. The
     picker then offers model rows, effort and Fast for a This PC Mico, saved in
     `Bot.nativeConfig` and validated again by the executing CLI. Fast appears only
     on a model that reports a Fast tier; off saves `fastMode: false`. An older
     Desktop answers without catalogs and keeps today's single row.
   - The sidebar plan usage adds the Codex plan of the PC that runs the Mico
     (percent and reset time). Stale readings stay visibly unavailable.
3. Phase 3 — install and update the CLIs.
   - Desktop keeps one store per PC user (`provider-runtimes/<engine>/<version>`,
     the layout managed OpenCode already uses) for Codex, Claude Code and OpenCode
     on every Desktop target the vendor builds for. Each download is verified
     against its source's own hash (GitHub release asset digest, npm
     `dist.integrity`) before it reaches its final path. The store records the
     SHA-256 of every installed file and checks it and `--version` before each
     start.
   - A lock file in the repository pins each engine's first-install version per
     target. Desktop checks the vendor channel at startup and daily. A bounded
     blocklist published from main withdraws broken versions; an active blocked
     copy is replaced by the newest unblocked one.
   - Resolution order: an absolute command in `native-agents.json`, then the newer
     of the managed copy and the CLI on `PATH` (the person's own CLI wins when it
     is the same version or newer), then the managed copy. On macOS and Linux,
     discovery also reads the login shell's `PATH`, which an app opened from
     Finder or a launcher lacks.
   - An update never replaces a CLI during a run. New turns of that engine wait
     with "Updating {engine}" while the candidate is verified and started; a
     candidate that fails is removed and the previous copy stays.
   - A missing engine shows Install in the picker and in Settings, for the PC
     owner, with its source and size. The OpenCode route (`installOpenCode`,
     `allowOpenCodeInstall`) becomes this path; server hosts keep the operator
     grant.
   - A scheduled CI canary installs each engine's newest release per target,
     verifies it, starts it and runs the protocol handshake without an account or
     a model call. A failing version reaches the blocklist through a pull request.
4. Phase 4 — several conversations at once.
   - `micoTurnLimit` uses `taskConcurrency` for native engines too, and their
     main chat becomes its own lane, as for Pi (`claimMicoRun`). Each conversation
     keeps its own session, process and per-run MCP bridge token; two runs never
     share a CLI process.
   - Computer, file and command tools keep the per-run computer lease rules of Pi
     tasks; screen and browser tools stay serialized.
   - Desktop bounds the CLI processes running at once per PC (default 6). A turn
     above the bound waits with a visible reason instead of failing, and the existing
     usage-limit hold keeps that engine's queued turns waiting until the reset.
   - An ACP agent that does not support concurrent sessions stays at one turn.
5. Phase 5 — more engines through ACP.
   - A PC owner adds an agent from the ACP Registry (metadata only today,
     `apps/api/src/acp-registry.ts`). When the registry entry names a distribution
     that phase 3 can verify (an npm package with integrity, or a binary with a
     published hash), Desktop installs it into the store. Otherwise the entry shows
     how to install it, and Mycellios only runs an absolute command the owner
     chooses on that PC.
   - `engines.forBot` and `Bot.nativeConfig` carry the agent id, so several ACP
     agents (for example Gemini CLI) coexist on one PC. Each signs in through
     phase 1 and lists models through phase 2 when its session does.
   - ACP file-system and terminal client capabilities stay off, as for OpenCode
     today: the agent acts only through the Mico's MCP bridge.

Web, Desktop and the Android app share the picker and these RPCs; the legacy
Expo preview keeps its current engine list.

Open decisions (defaults first):

- Sign out: in the engine detail with its warning, or left to the CLI itself.
- Managed installs: Codex, Claude Code and OpenCode from their vendors' own
  channels on request, or OpenCode only.
- Native concurrency: the Mico's `taskConcurrency`, as for Pi, under the PC
  bound of 6 processes; or a lower bound for native engines.

Rejected:

- Relaying the provider's browser callback from another device to the CLI's
  loopback listener on the PC, as the reference app's sign-in relay does. It opens
  a remote path into a local listener; device codes cover sign-in from elsewhere.
- Running a CLI's own updater or a global package manager (`npm i -g`,
  Homebrew). It changes the person's own installation, can need administrator
  rights and cannot be verified.
- Letting a CLI use its own shell, file or browser tools outside the Mico's
  catalog. Approvals, receipts, `fill_secret` and the no-replay rule rely on every
  action going through the catalog.
- One hand-written driver per CLI. ACP covers most of them with one adapter.

## Rules

- No probe, catalog read, usage read, install or sign-in starts a model turn or
  spends.
- Only allowlisted metadata leaves a CLI process: booleans, model ids, labels,
  efforts and tiers, usage percentages, reset times and versions. Never an account
  identity, email, token or the provider's sign-in callback.
- Every PC read or action requires the existing account/Space binding and that
  PC's local-access consent. Install and sign-out also require the PC owner and an
  explicit confirmation. Nothing runs on an offline PC or one bound to another
  account.
- Downloads come only from the channel named in the lock file and never run
  before verification. The store is per user and needs no administrator rights.
- The CLI keeps its own credential store; Mycellios never reads, copies or
  relays it.
- Concurrency never exceeds the Mico's `taskConcurrency`, the PC's process bound
  or the engine's capability. Run fences, receipts and the no-replay rule stay as
  they are.
- Nothing here changes a Mico's engine; defaults and migration stay in
  local-engine-default phase 3.

## Verification

- Phase 1: fixture CLIs for login start, device code, sign-out and failure;
  probe-cache invalidation; a redaction test proving no code or token reaches
  logs. Real sign-ins on Windows and macOS are reported separately.
- Phase 2: host-computer protocol tests with and without catalogs (older
  Desktop), picker tests for model, effort and Fast on a This PC Mico,
  native-codex-settings and quota allowlist tests.
- Phase 3: store tests for hash mismatch, partial download, blocked version,
  failed activation keeping the old copy, resolution order and no update during a
  run; lock-file and blocklist schema tests; the canary on hosted runners.
  Installed Desktop acceptance per platform is reported separately.
- Phase 4: `claimMicoRun` lane tests for native engines on isolated PostgreSQL,
  runtime tests with two concurrent fixture sessions and the process bound. A real
  two-conversation run on a physical PC is reported separately.
- Phase 5: registry install tests with verifiable and unverifiable fixture
  entries, contract tests for the agent id, and ACP conformance on the fixture
  agent (`fixtures/native-acp-acceptance.mjs`).
