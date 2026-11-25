# Run each Mico on the PC's own signed-in AI by default

## Problem

A Mico created in Desktop works on This PC (`dedicated`) but thinks with a
server-owned model connection (Pi). Its commands run on the PC; its model calls
do not. A third-party program the Mico launches on the PC (for example a
scraping or API-reverse-engineering CLI that needs its own LLM) cannot borrow
that connection, because model keys and OAuth material never leave the server.
The Mico then has to ask the person which AI the program should use, even when
Claude Code or Codex is installed and signed in on the same PC.

The reference desktop app (behavior reference only; PolyForm Noncommercial, no
copied code, prompts or text) runs each agent as the signed-in CLI on the
owner's computer, so every program it launches inherits that login.

Mycellios already has native engines (`agentEngine: codex | claude | opencode`,
`packages/contracts/src/domain.ts`), but:

- discovery marks an engine available when its binary exists, without checking
  that it is signed in (`discoverNativeEngines`, `native-agent-runtime.ts`), so
  a missing login appears only after a turn fails;
- Claude Code inherits the real `HOME`/`USERPROFILE` (`nativeEnvironment`), so the
  owner's personal `~/.claude` hooks and instructions load inside the Mico
  without any visible choice;
- Claude Code has no model choice in the picker (only `default`), while Codex
  reads its catalog, effort and Fast tier;
- with the PC offline, a native-engine Mico without the operator's server grant
  keeps waiting (`offline-cloud-workspace.ts`) instead of answering from the
  server.

## Decision

Prefer the PC's signed-in CLI when the PC is online, keep the server model when
it is not, and let programs on the PC use the Mico's AI in both cases.

1. Phase 1 — real sign-in state. Discovery reports `signedIn: true | false |
   unknown` per engine from the CLI's own read-only status call (Codex
   `account/read`; Claude Code and OpenCode through their non-interactive status
   commands, confirmed against the pinned versions). The probe is bounded
   (5 s), never starts a model call, never spends, and forwards no account
   identity, email or token: only the boolean. `unknown` is never treated as
   signed in. The model picker shows "Sign in required" for a signed-out engine
   with an action that opens that CLI's own login on the PC; the Mico never types
   credentials.
2. Phase 2 — make the local engine safe to default to.
   - The CLI runs in the Mico's own native folder (the linked project when
     there is one); session and system-prompt files stay in the private
     conversation folder. Claude Code keeps sessions per working folder, so the
     folder joins the session binding and the first turn after the move carries
     the history into a fresh session.
   - Loading the owner's personal CLI configuration (`~/.claude` instructions,
     hooks, skills) is a visible switch in the chat model menu, stored as
     `Bot.nativeConfig.userSettings` and honoured only on the owner's PC (the
     Desktop host supplies `resolveNativeWorkspace`; a server never does). It is
     off by default for every Mico: existing native Micos already ran with
     `--restricted`, which ignores every settings file and CLAUDE.md. Switched
     on, the CLI uses `--setting-sources user`, never project or local files the
     Mico could write in its own folder. Login state is shared either way: only
     configuration is isolated, never the credential store.
   - Claude Code's authenticated model catalog comes from its `initialize`
     control response (no model call), cached for five minutes. The model and
     effort live in `Bot.nativeConfig` and are checked against that catalog
     again before the CLI starts (`--model`, `--effort`); Claude Code offers no
     Fast tier. Both Codex and Claude catalogs now travel with the Desktop's
     engine report, so a This PC Mico lists its PC's models too; the API keeps
     only bounded, well-formed entries of installed, signed-in engines.
3. Phase 3 — default and migration.
   - New Micos created in Desktop on This PC take the first signed-in engine in
     the owner's order (default Claude Code, Codex, OpenCode). With none signed
     in they stay on Pi exactly as today.
     Implemented (3a): at creation the API asks the PC that runs the Mico, in
     one bounded read (4 s), which installed CLIs confirmed a sign-in (the
     Desktop reports `signedInEngines`; an unknown answer is never counted). The
     first of Claude Code, Codex becomes the engine; the general model stays the
     server fallback. A model or engine chosen in the create dialog wins,
     idempotent spawnKey creates keep what they made, and OpenCode is not chosen
     automatically until it can report a sign-in.
   - Existing This PC Micos move once, on that PC, only when an engine is signed
     in and the Mico is idle (no active, queued or parked run). The move keeps
     the saved Pi model as the server fallback, starts a fresh native session
     with the conversation history (existing engine-switch path), adds one system
     note to the main chat naming the new engine, and can be undone from the
     picker. A failed or skipped move changes nothing. The migration is recorded
     per Mico so it never repeats and never overrides a later manual choice.
   - PC offline: a fresh turn of a native-engine Mico runs on its saved Pi
     fallback model in the server workspace and says so in the chat (extends the
     #448 notice). Without a saved fallback model it keeps today's offline
     message. An admitted local run is never silently moved (existing rule).
     Implemented (3b): when the server has no native grant for the owner,
     selectOfflineCloudWorkspace moves the fresh turn only if the Mico has a
     saved Pi model or the account a main model; the turn is captured as engine
     `pi` (so a resume stays there) and the chat note names the replaced engine.
     A server with the grant still runs the CLI itself, as before.
   - Business note: subscription users spend fewer Credits on these Micos.
     Server fallback turns, Pi Micos and phase 4 keep Credit metering.
4. Phase 4 — the Mico's AI for programs on the PC. Desktop opens a loopback
   endpoint for the duration of one run, speaking the OpenAI- and Anthropic-
   compatible chat APIs, authorized by a random per-run token. Requests travel
   over the existing owned inference stream to the server, which meters them on
   the Mico's own connection with ordinary Credit admission and a per-run spend
   ceiling the owner approves once. The program receives `OPENAI_BASE_URL` /
   `ANTHROPIC_BASE_URL` and the token through the command environment, never a
   provider key. The endpoint closes with the run. Subscription sign-ins
   (ChatGPT, Claude OAuth) are never forwarded to third-party programs; for
   those the Mico uses the signed-in CLI from phases 1–3.

Rejected:

- Copying the reference app's model of "agent = local CLI only". It drops
  server execution while the PC is off, mobile continuity and Credit metering.
- Exporting the server connection's key or OAuth token to the PC. It breaks the
  rule that model credentials stay server-side.
- Probing sign-in with a tiny prompt. It spends quota and can trigger usage
  limits; status commands are read-only.

## Rules

- Discovery, migration and the picker never start inference or spend.
- Sign-in probes return only `signedIn`; no account identity, plan or token
  leaves the CLI process, and probe output is not logged.
- A migration or default never moves a Mico off Team or isolated computers,
  never touches Micos on another PC, and never overrides an explicit choice.
- Native consent, account/Space grants, approvals, run fences, receipts and
  the no-replay rule stay as they are.
- Phase 4 tokens are per run, loopback only, revoked at run end, and rejected
  for another run, Mico, account or Space.

## Phase 0 (shipped with this spec)

- The Mico's tool guidance says that a program needing its own AI cannot borrow
  the Mico's connection, so it first checks for a signed-in AI CLI on that
  computer and asks only when none is signed in (`LOCAL_TOOL_MODEL_CLAUSE`).
- Create Mico shows its model picker directly instead of nesting it inside a
  second "Model · automatic" disclosure that never updated.

## Verification

- Phase 1: native-agent-runtime discovery tests with fixture CLIs for signed
  in, signed out, timeout and malformed output; picker tests for the sign-in
  state. Fixtures do not qualify real CLI logins on Windows and macOS.
- Phase 2: native-agent-runtime launch tests (Mico folder as working
  directory, configuration switch only on the owner's PC, catalog refusal),
  native-model-catalog and Claude native-codex-settings tests, the forBot
  catalog sanitizing test and the chat-header-model picker tests.
- Phase 3: migration idempotency and idle-only tests on isolated PostgreSQL,
  offline fallback tests in offline-cloud-workspace and executor, notice tests.
- Phase 4: Desktop endpoint tests (token scope, loopback bind, closure),
  server metering and spend-ceiling tests, and a real third-party CLI run on a
  physical PC reported separately from fixtures.
