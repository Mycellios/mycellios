# Accessibility-tree control of the user's PC

## Existing behavior and goal

Micos already operate server computers (Docker, Daytona, E2B) through
`computer_observe` / `computer_act`: screenshots plus bounded `xdotool` input in
`infra/sandboxes/computer/control.py`. That path is vision-driven and remains
supported.

The `desktop` provider (This PC, through the installed Desktop app) executes
commands and manages files, but its screen is a placeholder:
`DesktopSandboxProvider.observe/act` in
`src/agent/packages/adapters/src/desktop-sandbox.ts` only apply placeholder
actions. A Mico cannot operate a real application on the user's PC.

Goal: give Desktop-hosted Micos real, consented, bounded control of the user's
own desktop applications through the OS accessibility tree, using the pinned
`agent-desktop` CLI (vercel-labs/agent-desktop, Apache-2.0). It reads UI
Automation (Windows), AX (macOS) or AT-SPI (Linux) and returns JSON elements with
snapshot-scoped refs, so it works with tool-capable models that lack vision.

Non-goals: replacing screenshot tools on server computers, adding a public or
arbitrary app executor, enabling it in routines, or claiming it from runner or
fixture results.

## Phase 1: Desktop host (Windows x64)

This phase ships on Windows x64 only. macOS is a follow-up: ad-hoc signing
rewrites bundled Mach-O binaries (so a byte pin needs a different check), the
helper must sit beside the CLI, and Accessibility permission attribution must be
qualified on a physical Mac.

### Component

- Ship a pinned `agent-desktop` release per platform/architecture as a Desktop
  runtime component: content-addressed, SHA-256 verified before every launch, and
  never downloaded or updated at runtime. Retain its Apache-2.0 notice.
- Desktop main starts it on demand as its own child process, inside the existing
  Desktop process lifetime, with a bounded environment. It never inherits account
  tokens, provider credentials or the host-computer token.
- Use its CLI JSON envelope through a narrow adapter in the host-computer
  server. Only an allowlisted command subset is reachable.
- Headless ref actions only. `--headed` (physical pointer/keyboard) is not
  offered; a future grant must be separate, explicit and per run.

### Model tools

Add three builtin tools, offered only when the run's computer is the consented
Desktop host and accessibility control is enabled:

- `pc_windows`: optional `app`. Lists open windows with ids, omitting refused apps.
- `pc_snapshot`: `window_id`, optional `root` ref and `skeleton`. Read-only;
  returns the compact interactive tree with snapshot-scoped refs, or TOO_LARGE
  above 48 KiB with a hint to narrow it.
- `pc_act`: one headless action (`click`, `set_value`, `clear`, `select`,
  `toggle`, `check`, `uncheck`, `expand`, `collapse`, `scroll_to`, `focus`)
  on one ref, or `keys` pressed in `window_id`. Text goes through `--stdin`,
  never process arguments. Batching and physical input are not offered.

Rules:

- Bare or foreign-snapshot refs are rejected. `STALE_REF` and
  `AMBIGUOUS_TARGET` are returned to the model as explicit errors that require a
  new snapshot; retry only when the envelope's `error.disposition.retry` is
  `safe`. Never replay an uncertain action.
- `pc_windows` and `pc_snapshot` are read-only. `pc_act` is always an approval-
  required effect; existing approval rules (always allow / Never ask) are the
  owner's allowlist.
- Disable both in routines, isolated project runs, task-bot threads that disable
  screen tools, and whenever `computer_observe` / `computer_act` are disabled for
  the same reason (see executor tool gating).
- Snapshots, clipboard reads and screenshots may contain private desktop
  content. Keep them out of logs, diagnostics, telemetry and durable artifacts
  beyond the conversation's existing tool-result retention.

### Consent and settings

- A separate "Control apps on this PC" consent in Computer use settings, off by
  default and independent of the existing file/command host consent. Revocation
  stops the child process and rejects in-flight and later calls.
- Optional application allowlist (by executable/bundle id). An empty allowlist
  means every action needs approval.
- Never control Mycellios Desktop itself, credential managers, system security
  prompts (UAC, macOS authorization dialogs) or browser password surfaces.
  Refuse those targets before invoking the CLI.
- macOS needs the Accessibility grant. Report the missing permission through the
  existing settings status and guide; never request it implicitly from a run,
  and never claim control is ready before `agent-desktop status` confirms it.
- User takeover keeps priority: an active user control lease blocks
  `pc_act` exactly like `computer_act`.

### Compatibility

- Additive capability advertised by Desktop. Old Desktop clients and servers
  keep current behavior; the server offers the tools only when the connected
  Desktop advertises the versioned capability.
- `computer_observe` / `computer_act` on server computers are unchanged.

## Phase 2 (optional): server computers

Evaluate offering `pc_snapshot` beside screenshots inside the Linux
sandbox image. Requires an AT-SPI accessibility bus in the X11 session and a
supported base image (agent-desktop requires Ubuntu 24.04+). Screenshot tools
remain the fallback for canvas, games and apps with poor accessibility. Decide
after Phase 1 qualification; not part of this change.

## Verification

- Unit: ref scoping, stale/ambiguous handling, retry disposition, output bounds,
  allowlist and forbidden-target refusal, consent revocation, tool gating in
  routines/isolated/project runs, approval of `pc_act`.
- Component: hash verification failure blocks launch; child process exits with
  Desktop and on revocation; no credentials in its environment.
- Physical, reported separately and never inferred from CI: a real Windows PC
  and a real Mac completing a consented Mico task in a common app (for example
  Notepad/TextEdit and File Explorer/Finder) with approval cards. Runner, fixture
  or simulated adapter results do not qualify this feature.

## Findings from a local Windows probe (agent-desktop 1.3.1, 2026-11-20)

Exploratory only; not qualification. Windows 11, UI Automation permission
reported granted without prompts; packaged binary hash matched its `.sha256`.

- Snapshots were fast and complete: Notepad 28 refs in ~0.8 s, Chrome 138 refs
  in ~1.1 s (~39 KB compact JSON), Mycellios Desktop (Electron) 44 refs in
  ~1.4 s. Large apps need the existing output bounds and `--skeleton`/`--root`.
- Headless `set-value` changed the text but Notepad did not register an edit
  (`application_commit: not_verified`, tab still "not modified"). Treat
  `delivery`/`application_commit` as authoritative and never report a
  `not_verified` commit as done.
- Headless `type` is refused (`POLICY_DENIED`) when it needs focus; it worked
  only with `--headed`, which takes focus and types physically.
- `press` without `--app`/`--window-id` goes to whatever window has focus.
  Keyboard actions must always be bound to the target window; reject unbound
  key combos in the adapter.
- A window-targeted `press ctrl+s` returned `delivered_unverified` and did not
  save; the semantic route (expand File menu, click Save by ref, headless)
  saved the file. Prefer menu/ref actions over shortcuts.
- `launch notepad.exe --activate` waited the full 30 s because the Windows 11
  launcher process hands off to another PID. Bound launch time and discover the
  window with `list-windows` instead of trusting the launcher PID.
- The CLI keeps state in `%USERPROFILE%\.agent-desktop`; Desktop must point it
  to an app-private directory.

## Implementation notes

- `packages/adapters/src/app-control.ts` validates requests and shapes results;
  `app-control-runner.ts` runs the CLI on Desktop. The host protocol carries a
  validated `appControl` method and reports `appControl` in the environment only
  while the opt-in is on.
- Desktop reads `resources/app-control/agent-desktop-win32-x64.exe`, copied by
  the Windows installer from the locked npm package after checking its digest.
- The CLI requires an owner-only state folder and refuses one that inherited
  broader access, so the runner lets the CLI create `<userData>/app-control`.

## Open questions

- Long-lived `agent-desktop mcp` session instead of one CLI call per action.
- Whether Linux Desktop is included in Phase 1 (X11/Wayland support differs).
- Exact pinned version and its release asset layout for packaging.
