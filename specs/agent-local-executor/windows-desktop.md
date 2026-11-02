# Unified Windows Desktop

## Required product behavior

One Windows installer provides Mycellios Desktop: the existing shared Agent web
interface, authorized local project execution, and the existing contribution runtime.
The standalone runtime remains available for headless systems. Do not fork the web
UI into a separate desktop product or implement another inference engine.

The normal route is install, sign in with the existing Mycellios account, select
a project or enable contribution. No server addresses, Docker setup, API keys or
downloaded pairing files belong in this normal route. Preserve advanced self-hosting.
Contribution is independently enabled/paused and retains resource limits. Existing
runtime installations and identities must be adopted, never duplicated or replaced
with a second node for the same computer.

The native project permission remains explicit. A downloaded PWA cannot acquire
native execution simply by looking like Desktop. Shared UI uses capability checks.
Account, conversations, Spores and provider credentials remain in their existing
authorized service; no development worker may attach to the production database.

## Packaging and qualification

- Preserve established per-user application identity for upgrades and shortcuts.
- Bundle public, source-bound runtime artifacts without enrollment or account secrets.
- Keep native updates opt-in until an owned verified feed exists; qualify a local
  installer upgrade without weakening signature or hash checks.
- Validate installer install/launch, same-account sign-in, local edit/test/preview,
  contribution/pause/identity reuse, upgrade with retained data, and uninstall.
- Distinguish local laboratory acceptance from real account/production acceptance.
  An unsigned pilot installer must be described honestly as unsigned.

## Linux and shared contribution control

Linux x64 Desktop reuses the same web UI and headless `mycellios-node` service.
The unified AppImage/DEB packager requires a verified, pinned runtime DEB. Initial
contribution requests polkit elevation, preserving `/etc/mycellios/node.json` and
any existing runtime identity. Installing/removing Desktop never enrolls compute
or removes the shared service. Other distributions/architectures require separate
qualification; container packaging is not a physical Linux GPU acceptance test.

The bottom sidebar uses the linked Mycellios account session server-side to issue
an enrollment or pause/resume an owned node. Re-read the generation and durable
command state before changing it. Show pending commands as pending, not active;
never replay an uncertain command or enroll a second identity. Browser-only users
retain the existing browser contributor rather than acquiring native permissions.

Spores is the visible contribution-credit name. Preserve existing microunit ledger
amounts, historical API identifiers and distinct promotional grants. Connection
time earns nothing; refresh the server balance after verified work. This UI rename
does not mint or alter on-chain SPORE conversion quotes.

## Hosted execution transport

The earlier qualified local-project prototype uses an app-managed local API/worker
and isolated account. The new outbound relay retains the hosted account and model
keys without exposing the local bearer or opening a public port on the PC.
Native consent and folder selection stay native. Session, Space, bot ownership,
device and connection generation are checked before dispatch. Account changes,
revocation, API restart and a disconnected Desktop fail work explicitly; lost
polls never replay commands and only identical result acknowledgements retry.
Heartbeat freshness is independent of output, so a quiet long command can continue.

The operator must deploy and qualify both API and worker with
`MYCELLIOS_DESKTOP_RELAY_ENABLED=true`; `DESKTOP_RELAY_API_URL` points to the
owning API instance without load-balancing between volatile brokers. The existing
screen secret derives a purpose-specific internal key; never copy it to Desktop.
This operator rollout is separate from an end user's install, which requires no
server, token or database configuration. The production flag is still unchanged.

The runtime MSI has a separate identity/enrollment/service lifecycle. Its one-time
account grant must be handed to the native installer, not embedded in the binary.
Shipping two components inside an EXE alone does not prove the unified route.

## Shared interface and native capabilities

Desktop opens the first-party hosted Agent using the same web source and account.
The optional native bridge adds project selection, command execution and runtime
enrollment. Browser and PWA builds use the same components with capability checks;
do not maintain a second set of chats, settings, credits or model-selection forms.
The default Windows route must not launch a local API, database or inference model.

Installing Desktop does not enable contribution. The account-confirmed grant and
the Windows elevation prompt belong to the explicit Enable contribution action.
An existing runtime identity, including a newer installed runtime, prevents the
bundled MSI from replacing it. The independent runtime retains its own update,
pause and uninstall lifecycle.

Local shell commands use the developer tools installed on the PC. A bundled
Electron executable is not a complete language SDK. Qualify each promised toolchain
on clean Windows before claiming every project works without prerequisites.
Current project folder grants are session-scoped. Switching an already granted
agent to another folder requires revoking local access first; revocation clears
the native folder map and invalidates the old run generation.

Unsigned pilot installers support a verified manual installer upgrade. Native
automatic updates stay off until an owned, signed feed is qualified; preserve
the active-command update guard and all signature verification.
